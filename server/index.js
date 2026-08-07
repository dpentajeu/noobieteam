const crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const path = require('path');
const { connectDB, User } = require('./db');
const apiRoutes = require('./routes/api');
const { authRequired, verifyToken } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { PORT, MEDIA_ROOT } = require('./config');
const storage = require('./storage');

const app = express();
const http = require('http');
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, { path: '/api/socket.io', cors: { origin: "*" } });
// Route handlers announce task writes over this (see routes/tasks.js), so the clients
// looking at a board hear about a change instead of waiting out their next poll.
app.set('io', io);

// Lock Registry: { [cardId]: { user: 'email', socketId: '...', expiresAt: Date.now() } }
const lockRegistry = {};

// Authenticate every socket connection via JWT before it can emit events.
// The identity is taken from the verified token, never from client-sent payloads.
io.use(async (socket, next) => {
    try {
        const raw = (socket.handshake.auth && socket.handshake.auth.token)
            || (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!raw) return next(new Error('Unauthorized: missing token'));

        const claims = verifyToken(raw);

        // Reject banned / deleted users at connect time.
        const user = await User.findOne({ email: claims.email }).select('email banned');
        if (!user) return next(new Error('Unauthorized: user no longer exists'));
        if (user.banned) return next(new Error('Forbidden: account is banned'));

        socket.data.userEmail = user.email;
        next();
    } catch (e) {
        next(new Error('Unauthorized: invalid or expired token'));
    }
});

const activeLocksFor = (workspaceId) => Object.keys(lockRegistry)
    .filter((cardId) => lockRegistry[cardId].workspaceId === workspaceId && lockRegistry[cardId].expiresAt > Date.now())
    .map((cardId) => ({ cardId, user: lockRegistry[cardId].user }));

io.on('connection', (socket) => {
    // The client emits this on connect. Without it a socket only ever joined the
    // room as a side effect of taking a lock itself, so everyone else missed every
    // card:locked / card:unlocked broadcast for the board they were looking at.
    socket.on('workspace:join', (data) => {
        const workspaceId = data && data.workspaceId;
        if (!workspaceId) return;
        socket.join(workspaceId);
        // Locks taken before this socket connected were broadcast to nobody it
        // could hear, so replay the current state on join.
        socket.emit('card:locks', { locks: activeLocksFor(workspaceId) });
    });

    socket.on('card:lock', (data) => {
        const { cardId, workspaceId } = data;
        // Identity comes from the authenticated socket, not the client payload.
        const userEmail = socket.data.userEmail;
        if (!cardId || !userEmail) return;

        // Join before the rejection check: a client that is refused the lock still
        // has the card open read-only and needs the unlock broadcast to take over.
        if (workspaceId) socket.join(workspaceId);

        const existingLock = lockRegistry[cardId];
        if (existingLock && existingLock.socketId !== socket.id && existingLock.expiresAt > Date.now()) {
            // The rejected client opens the card read-only, so it needs the holder's
            // identity, not just a message — that is what its banner names.
            socket.emit('card:lock_rejected', { cardId, user: existingLock.user, message: `Already locked by ${existingLock.user}` });
            return;
        }
        
        lockRegistry[cardId] = { user: userEmail, socketId: socket.id, expiresAt: Date.now() + 600000, workspaceId };
        io.to(workspaceId).emit('card:locked', { cardId, user: userEmail });
    });

    socket.on('card:unlock', (data) => {
        const { cardId, workspaceId } = data;
        if (!cardId) return;
        if (lockRegistry[cardId] && lockRegistry[cardId].socketId === socket.id) {
            delete lockRegistry[cardId];
            if (workspaceId) {
                io.to(workspaceId).emit('card:unlocked', { cardId });
            } else {
                io.emit('card:unlocked', { cardId }); // fallback
            }
        }
    });

    socket.on('disconnect', () => {
        for (const cardId in lockRegistry) {
            if (lockRegistry[cardId].socketId === socket.id) {
                const workspaceId = lockRegistry[cardId].workspaceId;
                delete lockRegistry[cardId];
                if (workspaceId) io.to(workspaceId).emit('card:unlocked', { cardId });
            }
        }
    });
});

// Connect to MongoDB
connectDB();

app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, user-email, Authorization");
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    next();
});

// JWT gate: protect all /api/* routes except public auth endpoints.
const PUBLIC_API = [/^\/api\/auth\//, /^\/api\/config$/, /^\/api\/socket\.io/, /^\/api\/public\//];
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    // Signup (create user) stays public.
    if (req.method === 'POST' && req.path === '/api/users') return next();
    if (PUBLIC_API.some((re) => re.test(req.path))) return next();
    return authRequired(req, res, next);
});

app.get('/api/config', (req, res) => {
    // The AI API key and base URL are intentionally NOT exposed to the client.
    // AI calls go through the server proxy at POST /api/ai/generate.
    res.json({
        // No adminEmail here: the client decides what to show from the
        // systemRole on the authenticated user, not from a shared address.
        // Media is always same-origin static files under /media/, so there is
        // no media host for the client to learn at runtime.
        aiConfig: {
            model: process.env.GEMINI_MODEL_ID || process.env.OPENAI_MODEL_ID || 'gemini-3-flash-preview',
            configured: !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY)
        }
    });
});

// Workspace deletion lives with the other workspace routes, in routes/workspaces.js.
// It used to be declared here on `app` — registered ahead of the /api router, so it
// silently shadowed anything defined there — and it deleted only the workspace row,
// orphaning every task, doc, folder, env and activity entry keyed to it.

// API routes before static files so /api/* is never swallowed
app.use('/api', apiRoutes);

// Uploaded media lives in <repo>/uploads/<category>/ and is served at /media/.
//
// User uploads must never be served as active same-origin content — an uploaded
// .html or .svg would otherwise run script in this origin — so every media folder
// is mounted with sniffing disabled and a sandbox CSP. These mounts come before
// the client static handler, which sets no such headers.
storage.CATEGORIES.forEach((category) => {
    app.use(`${storage.publicPrefix}/${category}`, express.static(path.join(MEDIA_ROOT, category), {
        setHeaders: (res) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        },
    }));
});

app.use(express.static(path.join(__dirname, '../client')));
        
app.get('/workspace/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// The client routes these two itself (see client/src/App.jsx). Without a fallback
// here a reload on either is a plain 404 — express.static finds no such file.
app.get(['/profile', '/my-tasks'], (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Dynamic Catch-All Routes for the two public surfaces: the GitBook-style docs
// site and the Postman-style API reference. Both are client-rendered, so they
// only need index.html — the data comes from /api/public/*.
//
// `/apis/` rather than `/api/` because the Express API router already owns
// `/api/*` and would swallow every one of these.
app.get('/docs/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/apis/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Central error handler — MUST be registered last, after all routes.
app.use(errorHandler);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
