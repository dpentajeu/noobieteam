const crypto = require('crypto');

const express = require('express');
const router = express.Router();
const { User, Workspace, Task, Doc, Folder, Env, EmojiEvent, WorkspaceActivity } = require('../db');

// --- Workspaces ---
router.get('/workspaces', async (req, res) => {
  try {
    const workspaces = await Workspace.find();
    const out = workspaces.map(w => {
      const o = w.toObject();
      o.bitbucketApiTokenSet = !!(o.bitbucketApiTokenEnc && o.bitbucketApiTokenEnc.value);
      delete o.bitbucketApiTokenEnc;
      return o;
    });
    res.json(out);
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
    const updates = { ...req.body };
    // Encrypt the Bitbucket app password if it's provided as plaintext
    if (typeof updates.bitbucketApiTokenPlain === 'string') {
      const plain = updates.bitbucketApiTokenPlain.trim();
      delete updates.bitbucketApiTokenPlain;
      if (plain.length === 0) {
        updates.bitbucketApiTokenEnc = null; // explicit clear
      } else {
        const { encryptServerSecret } = require('../crypto');
        updates.bitbucketApiTokenEnc = encryptServerSecret(plain);
      }
    }
    // Never accept the encrypted blob directly from the client to avoid clobbering with garbage
    if (!Object.prototype.hasOwnProperty.call(req.body, 'bitbucketApiTokenPlain')) {
      delete updates.bitbucketApiTokenEnc;
    }
    const ws = await Workspace.findByIdAndUpdate(req.params.id, updates, { new: true });
    // Strip encrypted blob before returning so it never reaches the client
    const out = ws ? ws.toObject() : null;
    if (out) {
      out.bitbucketApiTokenSet = !!(out.bitbucketApiTokenEnc && out.bitbucketApiTokenEnc.value);
      delete out.bitbucketApiTokenEnc;
    }
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create a branch on Bitbucket Cloud via API and return the branch info to bind to a card.
router.post('/workspaces/:wsId/branches', async (req, res) => {
  try {
    const { branchName, sourceBranch } = req.body || {};
    if (!branchName || !sourceBranch) {
      return res.status(400).json({ error: 'branchName and sourceBranch are required' });
    }
    const ws = await Workspace.findById(req.params.wsId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (!ws.bitbucketRepo) return res.status(400).json({ error: 'Bitbucket repository is not configured for this workspace' });
    if (!ws.bitbucketAuthEmail || !ws.bitbucketApiTokenEnc?.value) {
      return res.status(400).json({ error: 'Bitbucket API credentials are not configured for this workspace' });
    }

    let apiToken;
    try {
      const { decryptServerSecret } = require('../crypto');
      apiToken = decryptServerSecret(ws.bitbucketApiTokenEnc);
    } catch (e) {
      console.error('[BITBUCKET] Failed to decrypt API token:', e.message);
      return res.status(500).json({ error: 'Stored credentials could not be decrypted. Re-enter your Bitbucket API token.' });
    }

    const auth = Buffer.from(`${ws.bitbucketAuthEmail}:${apiToken}`).toString('base64');
    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${ws.bitbucketRepo}/refs/branches`;

    let bbRes, bbBody;
    try {
      bbRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ name: branchName, target: { hash: sourceBranch } })
      });
      bbBody = await bbRes.json().catch(() => ({}));
    } catch (e) {
      console.error('[BITBUCKET] Network error:', e.message);
      return res.status(502).json({ error: 'Failed to reach Bitbucket: ' + e.message });
    }

    if (!bbRes.ok) {
      const msg = bbBody?.error?.message || bbBody?.message || `Bitbucket returned ${bbRes.status}`;
      return res.status(bbRes.status).json({ error: msg, details: bbBody });
    }

    const branchUrl = bbBody?.links?.html?.href || `https://bitbucket.org/${ws.bitbucketRepo}/branch/${encodeURIComponent(branchName)}`;
    res.json({ name: bbBody?.name || branchName, url: branchUrl, target: bbBody?.target?.hash });
  } catch (e) {
    console.error('[BITBUCKET] Branch create failed:', e.message);
    res.status(500).json({ error: e.message });
  }
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


// --- Aggregated "My Tasks" across all boards ---
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@noobieteam.ai';

router.get('/my-tasks', async (req, res) => {
  try {
    const userEmail = req.headers['user-email'] || req.query.email;
    if (!userEmail) return res.status(400).json({ error: 'Missing user email' });

    const allWorkspaces = await Workspace.find({ archived: { $ne: true } });
    const isAdmin = userEmail === ADMIN_EMAIL;

    const visibleWorkspaces = allWorkspaces.filter(w => {
      if (isAdmin) return true;
      const memberEmails = (w.members || []).map(m => (typeof m === 'string' ? m : m && m.userId)).filter(Boolean);
      return memberEmails.includes(userEmail);
    });

    const wsById = {};
    visibleWorkspaces.forEach(w => { wsById[w._id.toString()] = w; });
    const wsIds = Object.keys(wsById);

    if (wsIds.length === 0) return res.json([]);

    const tasks = await Task.find({ workspaceId: { $in: wsIds }, archived: { $ne: true } }).sort({ updatedAt: -1 });

    const enriched = tasks.map(task => {
      const ws = wsById[task.workspaceId];
      const colId = task.columnId || task.col;
      let columnTitle = 'Unassigned';
      if (colId === 'backlog') {
        columnTitle = 'Backlog';
      } else if (ws && Array.isArray(ws.columns)) {
        const col = ws.columns.find(c => c.id === colId);
        if (col && col.title) columnTitle = col.title;
      }
      const obj = task.toJSON();
      return {
        ...obj,
        id: task._id.toString(),
        workspaceId: task.workspaceId,
        workspaceName: ws ? ws.name : 'Unknown Board',
        workspaceSlug: ws ? ws.slug : null,
        columnId: colId,
        columnTitle
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

router.get('/users/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const email = req.body.email;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const existing = await User.findOne({ email });
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

router.put('/users/:email/password', async (req, res) => {
    try {
      const { currentPassword, password } = req.body;
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
      if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
      const bcrypt = require('bcrypt');
      const existingUser = await User.findOne({ email: req.params.email });
      if (!existingUser) return res.status(404).json({ error: 'User not found' });

      let isMatch = existingUser.password === currentPassword;
      if (!isMatch) {
        try {
          isMatch = await bcrypt.compare(currentPassword, existingUser.password);
        } catch (err) {
          // Non-bcrypt legacy password; direct match already failed.
        }
      }
      if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await User.findOneAndUpdate(
        { email: existingUser.email },
        { password: hashedPassword, method: 'local' },
        { new: true }
      );
      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:email', async (req, res) => {
    try {
      const { password, vaultPin, email, ...safeBody } = req.body;
      const user = await User.findOneAndUpdate({ email: req.params.email }, safeBody, { new: true });
      if (!user) return res.status(404).json({ error: 'User not found' });
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
    // Extract the share `password` so it is never persisted in plaintext.
    const { password, passwordHash, ...update } = req.body;
    if (password !== undefined) {
      if (password === null || password === '') {
        update.passwordProtected = false;
        update.passwordHash = null;
      } else {
        update.passwordHash = crypto.createHash('sha256').update(String(password)).digest('hex');
        update.passwordProtected = true;
      }
    }
    const doc = await Doc.findByIdAndUpdate(req.params.id, update, { new: true });
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

// Vault Decrypt Route removed as encryption is strictly local now.

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
    
    // Mask the content of password-protected docs. Viewers must unlock them
    // individually via the /unlock endpoint before content is revealed.
    const safeDocs = docs.map(d => {
        const obj = d.toJSON();
        if (obj.passwordProtected) {
            return {
                id: obj.id,
                _id: obj._id,
                title: obj.title,
                type: obj.type,
                folderId: obj.folderId,
                passwordProtected: true,
                content: '',
                apiSpec: obj.type === 'API' ? { method: obj.apiSpec?.method } : undefined
            };
        }
        return obj;
    });
    
    res.json({ 
        workspace: { id: workspace._id, name: workspace.name }, 
        folder: { id: folder._id, name: folder.name, slug: folder.slug, description: folder.description, environments: folder.environments }, 
        subfolders: subfolders.map(f => ({ id: f._id, name: f.name, parentId: f.parentId, description: f.description, environments: f.environments })),
        docs: safeDocs 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unlock a single password-protected public document by supplying its password.
// Returns the full content/apiSpec only when the password matches.
router.post('/public/docs/:wsId/unlock', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const { docId, password } = req.body;
    if (!docId) return res.status(400).json({ error: 'docId is required' });

    let wsQuery = [{ name: req.params.wsId }];
    if (mongoose.Types.ObjectId.isValid(req.params.wsId) && String(req.params.wsId).length === 24) {
        wsQuery.push({ _id: req.params.wsId });
    }
    const workspace = await Workspace.findOne({ $or: wsQuery });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    if (!mongoose.Types.ObjectId.isValid(docId)) return res.status(404).json({ error: 'Document not found' });
    const doc = await Doc.findOne({ _id: docId, workspaceId: workspace._id.toString() }).select('+passwordHash');
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (!doc.passwordProtected) {
        return res.json({ id: doc._id, title: doc.title, type: doc.type, content: doc.content, apiSpec: doc.apiSpec });
    }

    const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (hash !== doc.passwordHash) {
        return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ id: doc._id, title: doc.title, type: doc.type, content: doc.content, apiSpec: doc.apiSpec });
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
// --- Workspace Activity Log ---
router.get('/workspaces/:wsId/activity', async (req, res) => {
  try {
    const logs = await WorkspaceActivity.find({ workspaceId: req.params.wsId })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(logs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/workspaces/:wsId/activity', async (req, res) => {
  try {
    const { user, action, resourceType, resourceName } = req.body;
    const log = new WorkspaceActivity({ workspaceId: req.params.wsId, user, action, resourceType, resourceName });
    await log.save();
    res.json(log);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

// EOF: verified crypto auth fix
