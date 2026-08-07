const mongoose = require('mongoose');
const { Workspace } = require('../db');
const wrap = require('./asyncHandler');

// members are stored as [{ userId, role, ... }] but legacy rows may be plain
// email strings — support both shapes.
const memberEmails = (ws) =>
    (ws && ws.members || []).map(m => (typeof m === 'string' ? m : m && m.userId)).filter(Boolean);

const isMember = (ws, email) => memberEmails(ws).includes(email);

const isOwner = (ws, email) =>
    (ws && ws.members || []).some(m => typeof m !== 'string' && m && m.userId === email && m.role === 'OWNER');

// Superadmin governs *accounts* (ban, role, delete, PIN reset) — see
// requireSuperAdmin / requireSelfOrSuperAdmin below. It deliberately grants no
// access to workspace content: a superadmin who is not a member of a workspace
// cannot list, read or modify it, exactly like any other user. Add them as a
// member if they need in.
//
// The DB is the only source of this role. authRequired re-reads systemRole from
// the users collection on every request, so a promotion or demotion takes effect
// immediately and no token can carry a stale one. Bootstrap the first superadmin
// with server/scripts/seedSuperadmin.js <email>.
const isSuperAdmin = (req) => !!(req.user && req.user.systemRole === 'SUPERADMIN');

// Resolve membership for a given workspaceId. Sends the appropriate error
// response and returns false when access should be denied.
async function assertMember(req, res, workspaceId) {
    const email = req.user && req.user.email;
    if (!email) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
    if (!workspaceId || !mongoose.isValidObjectId(String(workspaceId))) {
        res.status(404).json({ error: 'Workspace not found' });
        return false;
    }
    const ws = await Workspace.findById(workspaceId).select('members');
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return false; }
    if (!isMember(ws, email)) { res.status(403).json({ error: 'Forbidden: not a workspace member' }); return false; }
    return true;
}

// Resolve OWNER-level access for a given workspaceId.
async function assertOwner(req, res, workspaceId) {
    const email = req.user && req.user.email;
    if (!email) { res.status(401).json({ error: 'Unauthenticated' }); return false; }
    if (!workspaceId || !mongoose.isValidObjectId(String(workspaceId))) {
        res.status(404).json({ error: 'Workspace not found' });
        return false;
    }
    const ws = await Workspace.findById(workspaceId).select('members');
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return false; }
    if (!isOwner(ws, email)) { res.status(403).json({ error: 'Forbidden: workspace owner only' }); return false; }
    return true;
}

// Workspace id taken from the route param (default :wsId).
const requireWsMember = (param = 'wsId') => wrap(async (req, res, next) => {
    if (await assertMember(req, res, req.params[param])) next();
});

// Owner-only workspace actions (default param :id, e.g. PUT/DELETE /workspaces/:id).
const requireWsOwner = (param = 'id') => wrap(async (req, res, next) => {
    if (await assertOwner(req, res, req.params[param])) next();
});

// Resource (Task/Doc/Folder/...) referenced by id; membership checked against
// the workspace that owns the resource.
const requireResourceMember = (Model, idParam = 'id') => wrap(async (req, res, next) => {
    const id = req.params[idParam];
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'Not found' });
    const doc = await Model.findById(id).select('workspaceId');
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (await assertMember(req, res, doc.workspaceId)) next();
});

// Bulk operations: every referenced resource's workspace must be one the user
// is a member of.
const requireBulkResourceMember = (Model, field) => wrap(async (req, res, next) => {
    const ids = req.body[field];
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: `${field} array required` });

    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ error: 'Unauthenticated' });

    const validIds = ids.filter(id => mongoose.isValidObjectId(id));
    const docs = await Model.find({ _id: { $in: validIds } }).select('workspaceId');
    const wsIds = [...new Set(docs.map(d => String(d.workspaceId)))];
    const workspaces = await Workspace.find({ _id: { $in: wsIds } }).select('members');
    const allowed = new Set(workspaces.filter(w => isMember(w, email)).map(w => String(w._id)));

    if (!wsIds.every(id => allowed.has(id))) {
        return res.status(403).json({ error: 'Forbidden: not a workspace member' });
    }
    next();
});

// Superadmin-only routes (e.g. banning users).
const requireSuperAdmin = (req, res, next) => {
    if (isSuperAdmin(req)) return next();
    return res.status(403).json({ error: 'Forbidden: superadmin only' });
};

// Routes that act on a specific user: allow the user themselves or a superadmin.
const requireSelfOrSuperAdmin = (param = 'email') => (req, res, next) => {
    if (isSuperAdmin(req)) return next();
    if (req.user && req.user.email === req.params[param]) return next();
    return res.status(403).json({ error: 'Forbidden: you can only modify your own account' });
};

module.exports = {
    requireWsMember,
    requireWsOwner,
    requireResourceMember,
    requireBulkResourceMember,
    requireSuperAdmin,
    requireSelfOrSuperAdmin,
    isMember,
    isOwner,
    isSuperAdmin,
    memberEmails,
};
