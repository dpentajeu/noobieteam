const crypto = require('crypto');

const express = require('express');
const router = express.Router();
const { User, Workspace, Task, Doc, Folder, Env, EmojiEvent } = require('../db');

// --- Workspaces ---
router.get('/workspaces', async (req, res) => {
  try {
    const workspaces = await Workspace.find();
    res.json(workspaces);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/workspaces', async (req, res) => {
  try {
    // Expected: { name, color, avatar, archived, createdAt, members: [email] }
    const ws = new Workspace(req.body);
    if (!ws.slug) {
        ws.slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).substr(2, 4);
    }
    // Initialize default columns
    ws.columns = [{ id: 'todo', title: 'To Do', order: 0 }, { id: 'inprog', title: 'In Progress', order: 1 }, { id: 'done', title: 'Done', order: 2 }];
    await ws.save();
    res.json(ws);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/workspaces/:id', async (req, res) => {
  try {
    const ws = await Workspace.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(ws);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// For updating columns or members specifically, we can use PUT /workspaces/:id

// --- Tasks ---
router.get('/workspaces/:wsId/tasks', async (req, res) => {
  try {
    const tasks = await Task.find({ workspaceId: req.params.wsId });
    res.json(tasks);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/workspaces/:wsId/tasks', async (req, res) => {
  try {
    const { auditEvent, ...taskData } = req.body;
    const task = new Task({ ...taskData, workspaceId: req.params.wsId });
    if (auditEvent) {
       task.auditTrail = [{ user: auditEvent.user, action: auditEvent.action, timestamp: new Date() }];
    }
    await task.save();
    res.json(task);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// --- Bulk Operations ---
router.put('/workspaces/:wsId/tasks/bulk-archive', async (req, res) => {
  try {
    const { cardIds } = req.body;
    if (!cardIds || !Array.isArray(cardIds)) return res.status(400).json({ error: 'cardIds array required' });
    await Task.updateMany({ _id: { $in: cardIds }, workspaceId: req.params.wsId }, { $set: { archived: true, expiredAlertAcknowledged: true } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/workspaces/:wsId/tasks/bulk-move', async (req, res) => {
  try {
    const { cardIds, targetColumn } = req.body;
    if (!cardIds || !Array.isArray(cardIds) || !targetColumn) return res.status(400).json({ error: 'cardIds array and targetColumn required' });
    await Task.updateMany({ _id: { $in: cardIds }, workspaceId: req.params.wsId }, { $set: { columnId: targetColumn, expiredAlertAcknowledged: true } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.put('/workspaces/:wsId/tasks/bulk-order', async (req, res) => {
  try {
    const { updates } = req.body; // updates = [{ id: 'taskId', orderIndex: 0, columnId: 'todo' }, ...]
    if (!updates || !Array.isArray(updates)) return res.status(400).json({ error: 'updates array required' });
    
    const bulkOps = updates.map(u => ({
        updateOne: {
            filter: { _id: u.id, workspaceId: req.params.wsId },
            update: { $set: { orderIndex: u.orderIndex, columnId: u.columnId } }
        }
    }));
    
    if (bulkOps.length > 0) {
        await Task.bulkWrite(bulkOps);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/tasks/:id', async (req, res) => {
  try {
    const { auditEvent, __v, ...updateData } = req.body;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Enforce optimistic concurrency by setting the version key sent from frontend
    if (__v !== undefined) {
        if (task.__v !== __v) {
            return res.status(409).json({ error: 'Conflict: This card was modified by another user. Please refresh and try again.' });
        }
    }
    

    Object.assign(task, updateData);

    if (auditEvent) {
       task.auditTrail.push({ user: auditEvent.user, action: auditEvent.action, timestamp: new Date() });
    }

    await task.save();
    res.json(task);
  } catch(e) {
    if (e.name === 'VersionError') {
        return res.status(409).json({ error: 'Conflict: This card was modified by another user. Please refresh and try again.' });
    }
    res.status(500).json({ error: e.message });
  }
});


// --- Task Comments ---
router.post('/tasks/:taskId/comments', async (req, res) => {
    try {
        const { authorEmail, text, taggedUsers } = req.body;
        if (!authorEmail || !text) return res.status(400).json({ error: "Missing required fields" });
        
        const newComment = {
            authorEmail,
            text,
            taggedUsers: taggedUsers || [],
            timestamp: new Date()
        };
        
        const task = await Task.findByIdAndUpdate(
            req.params.taskId,
            { $push: { comments: newComment } },
            { new: true }
        );
        
        res.status(201).json(task);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/tasks/:taskId/comments/:commentId', async (req, res) => {
    try {
        const task = await Task.findByIdAndUpdate(
            req.params.taskId,
            { $pull: { comments: { _id: req.params.commentId } } },
            { new: true }
        );
        res.json(task);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- Users ---

// --- OAuth ---

router.post('/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        
        let payload;
        try {
            const ticket = await client.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID,  
            });
            payload = ticket.getPayload();
        } catch (verifyError) {
            console.error("Google verifyIdToken failed, falling back to simple decode:", verifyError.message);
            // Fallback for missing GOOGLE_CLIENT_ID in some dev environments
            payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
        }

        const { email, name, picture } = payload;

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ email, name, avatar: picture, method: 'google', password: 'oauth', lastLogin: new Date() });
            await user.save();
        } else {
            user.lastLogin = new Date();
            await user.save();
        }
        res.json(user);
    } catch(e) { 
        console.error("Google Auth Fatal Error:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});


router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user) return res.status(401).json({ error: 'Credentials mismatch' });
        
        let isMatch = false;
        
        // 1. Direct plaintext fallback (legacy support for test accounts)
        if (user.password === password) {
            isMatch = true;
        } else {
            // 2. Secure bcrypt comparison (modern accounts)
            const bcrypt = require('bcrypt');
            try {
                isMatch = await bcrypt.compare(password, user.password);
            } catch(err) {
                // Not a valid bcrypt hash, fallback fails
            }
        }
        
        if (!isMatch) return res.status(401).json({ error: 'Credentials mismatch' });
        
        user.lastLogin = new Date();
        await user.save();
        res.json(user);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users', async (req, res) => {
  try {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) return res.status(400).json({ error: 'User exists' });
    
    const bcrypt = require('bcrypt');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);
    
    const userData = { ...req.body, password: hashedPassword };
    const user = new User(userData);
    
    await user.save();
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/pin', async (req, res) => {
    try {
        const { email, pin } = req.body;
        if (!email || !pin) return res.status(400).json({ error: 'Email and pin required' });
        const hash = crypto.createHash('sha256').update(pin).digest('hex');
        let user = await User.findOneAndUpdate({ email }, { vaultPin: hash }, { new: true });
        if (!user) {
            // If user doesn't exist, seed them now
            user = new User({ email, vaultPin: hash, name: email.split('@')[0], method: 'local', password: 'seed' });
            await user.save();
        }
        res.json({ success: true, vaultPin: user.vaultPin });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:email', async (req, res) => {
    try {
      const user = await User.findOneAndUpdate({ email: req.params.email }, req.body, { new: true });
      res.json(user);
    } catch(e) { res.status(500).json({ error: e.message }); }
});


// --- Folders ---
router.get('/workspaces/:wsId/folders', async (req, res) => {
  try {
    const folders = await Folder.find({ workspaceId: req.params.wsId });
    res.json(folders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/workspaces/:wsId/folders', async (req, res) => {
  try {
    const folder = new Folder({ ...req.body, workspaceId: req.params.wsId });
    await folder.save();
    res.json(folder);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/folders/:id', async (req, res) => {
  try {
    const folder = await Folder.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(folder);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/folders/:id', async (req, res) => {
  try {
    await Folder.findByIdAndDelete(req.params.id);
    await Doc.updateMany({ folderId: req.params.id }, { $unset: { folderId: 1 } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/workspaces/:wsId/docs', async (req, res) => {
  try {
    const docs = await Doc.find({ workspaceId: req.params.wsId });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/workspaces/:wsId/docs', async (req, res) => {
  try {
    const doc = new Doc({ ...req.body, workspaceId: req.params.wsId });
    await doc.save();
    res.json(doc);
  } catch (e) {
    console.error("Create Doc Error:", e);
    res.status(500).json({ error: e.message });
  }
});
router.delete('/docs/bulk', async (req, res) => {
  try {
    const { docIds } = req.body;
    if (!docIds || !Array.isArray(docIds)) return res.status(400).json({ error: 'docIds array required' });
    await Doc.deleteMany({ _id: { $in: docIds } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/docs/bulk-move', async (req, res) => {
  try {
    const { docIds, folderId } = req.body;
    if (!docIds || !Array.isArray(docIds)) return res.status(400).json({ error: 'docIds array required' });
    await Doc.updateMany({ _id: { $in: docIds } }, folderId ? { $set: { folderId } } : { $unset: { folderId: 1 } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/docs/:id', async (req, res) => {
  try {
    const doc = await Doc.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/docs/:id', async (req, res) => {
  try {
    await Doc.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Envs ---
router.get('/workspaces/:wsId/envs', async (req, res) => {
  const envs = await Env.find({ workspaceId: req.params.wsId });
  res.json(envs);
});
router.post('/workspaces/:wsId/envs', async (req, res) => {
  const env = new Env({ ...req.body, workspaceId: req.params.wsId });
  await env.save();
  res.json(env);
});


// --- Vault (AES-GCM Encryption endpoints) ---

const ALGORITHM = 'aes-256-gcm';

router.post('/workspaces/:wsId/vault/encrypt', async (req, res) => {
    try {
        const { text, password } = req.body;
        if (!text || !password) return res.status(400).json({ error: 'Missing payload' });
        
        let safePassword = String(password);
        // Consistent hashing for keys < 64 chars
        if (safePassword.length < 64) {
            safePassword = crypto.createHash('sha256').update(safePassword).digest('hex');
        }

        const key = crypto.scryptSync(safePassword, 'salt', 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        
        const payload = Buffer.from(JSON.stringify({ iv: iv.toString('hex'), encryptedData: encrypted, authTag: authTag })).toString('base64');
        res.json({ encrypted: payload });
    } catch (e) {
        res.status(500).json({ error: 'Encryption failed: ' + e.message });
    }
});

router.post('/workspaces/:wsId/vault/decrypt', async (req, res) => {
    try {
        const { cipherBase64, password } = req.body;
        if (!cipherBase64 || !password) return res.status(400).json({ error: 'Missing payload' });
        
        let safePassword = String(password);
        if (safePassword.length < 64) {
            safePassword = crypto.createHash('sha256').update(safePassword).digest('hex');
        }
        const payload = JSON.parse(Buffer.from(cipherBase64, 'base64').toString('utf8'));
        const key = crypto.scryptSync(safePassword, 'salt', 32);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
        
        let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        res.json({ decrypted });
    } catch (e) {
        res.status(401).json({ error: 'Incorrect password. Unable to decrypt secret.' });
    }
});

// --- Admin ---
router.post('/admin/users/:email/reset-pin', async (req, res) => {
    try {
        const user = await User.findOneAndUpdate({ email: req.params.email }, { vaultPin: null }, { new: true });
        res.json({ success: true, user });
    } catch(e) { res.status(500).json({ error: e.message }); }
});


// --- Public Docs ---
router.get('/public/docs/:wsId/:folderSlug', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    let wsQuery = [];
    if (mongoose.Types.ObjectId.isValid(req.params.wsId) && String(req.params.wsId).length === 24) {
        wsQuery.push({ _id: req.params.wsId });
    }
    // We don't have slug on workspace yet, but let's assume wsId is always ID for now or we match by name if we add slug.
    // If it's an ID, we use _id. If not, maybe we just fallback to name? Or return 404.
    let finalWsQuery = { name: req.params.wsId };
    if (wsQuery.length) {
        finalWsQuery = { $or: [{ name: req.params.wsId }, ...wsQuery] };
    }
    const workspace = await Workspace.findOne(finalWsQuery);
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    
    // Find folder by slug or ID
    const slug = req.params.folderSlug;
    const query = [{ slug }];
    if (mongoose.Types.ObjectId.isValid(slug) && String(slug).length === 24) {
        query.push({ _id: slug });
    }
    
    const folder = await Folder.findOne({ $or: query, workspaceId: workspace._id.toString() });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    
    // Support 1-level deep subfolders
    const subfolders = await Folder.find({ workspaceId: workspace._id.toString(), parentId: folder._id.toString() });
    const subfolderIds = subfolders.map(f => f._id.toString());
    
    // Fetch docs in root folder AND subfolders
    const docs = await Doc.find({ workspaceId: workspace._id.toString(), folderId: { $in: [folder._id.toString(), ...subfolderIds] } }).sort({ order: 1, createdAt: 1 });
    
    res.json({ 
        workspace: { id: workspace._id, name: workspace.name }, 
        folder: { id: folder._id, name: folder.name, slug: folder.slug, description: folder.description, environments: folder.environments }, 
        subfolders: subfolders.map(f => ({ id: f._id, name: f.name, parentId: f.parentId, description: f.description, environments: f.environments })),
        docs 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;



// --- Emoji Meme Events ---
router.post('/workspaces/:wsId/emojis', async (req, res) => {
    try {
        const { senderEmail, emojiType } = req.body;
        const newEmoji = new EmojiEvent({
            workspaceId: req.params.wsId,
            senderEmail,
            emojiType,
            viewedBy: [senderEmail] // the sender inherently 'saw' their own action
        });
        await newEmoji.save();
        res.status(201).json(newEmoji);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Fetch unseen emojis for a specific user in a workspace
router.get('/workspaces/:wsId/emojis/unseen', async (req, res) => {
    try {
        const userEmail = req.headers['user-email'] || req.query.email;
        if (!userEmail) return res.status(400).json({ error: "Missing user email." });
        
        // Find emojis in this WS that DO NOT have the userEmail in the viewedBy array
        const unseenEmojis = await EmojiEvent.find({
            workspaceId: req.params.wsId,
            viewedBy: { $ne: userEmail }
        }).sort({ createdAt: -1 }).limit(5); // ONLY ALLOW 5 LATEST ACTIONS TO AVOID SPAM
        
        res.json(unseenEmojis);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Mark an array of emoji IDs as viewed by a specific user
router.put('/emojis/mark-viewed', async (req, res) => {
    try {
        const { emojiIds, userEmail } = req.body;
        if (!emojiIds || !userEmail) return res.status(400).json({ error: "Missing payload." });
        
        // Add the user to the viewedBy array for all specified IDs
        await EmojiEvent.updateMany(
            { _id: { $in: emojiIds } },
            { $addToSet: { viewedBy: userEmail } }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
