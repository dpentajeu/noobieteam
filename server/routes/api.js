const crypto = require('crypto');

const express = require('express');
const router = express.Router();
const { User, Workspace, Task, Doc, Env, EmojiEvent } = require('../db');

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

router.put('/tasks/:id', async (req, res) => {
  try {
    const { auditEvent, ...updateData } = req.body;
    
    let updateQuery = {};
    if (Object.keys(updateData).length > 0) {
       updateQuery.$set = updateData;
    }
    if (auditEvent) {
       updateQuery.$push = { auditTrail: { user: auditEvent.user, action: auditEvent.action, timestamp: new Date() } };
    }
    
    // Fallback if updateQuery is empty
    if (Object.keys(updateQuery).length === 0) updateQuery = req.body;

    const task = await Task.findByIdAndUpdate(req.params.id, updateQuery, { new: true });
    res.json(task);
  } catch(e) { res.status(500).json({ error: e.message }); }
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
        // Basic JWT decode for demo (In prod: verify via google-auth-library)
        const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
        const { email, name, picture } = payload;

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ email, name, avatar: picture, method: 'google' });
            await user.save();
        }
        res.json(user);
    } catch(e) { 
        res.status(500).json({ error: e.message }); 
    }
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
    const user = new User(req.body);
    await user.save();
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:email', async (req, res) => {
    try {
      const user = await User.findOneAndUpdate({ email: req.params.email }, req.body, { new: true });
      res.json(user);
    } catch(e) { res.status(500).json({ error: e.message }); }
});



// --- Docs ---
router.get('/workspaces/:wsId/docs', async (req, res) => {
  try {
    const docs = await Doc.find({ workspaceId: req.params.wsId }).sort({ order: 1 });
    res.json(docs);
  } catch (e) {
    console.error("Fetch Docs Error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/users/pin', async (req, res) => {
    try {
        const { email, pin } = req.body;
        // In a real app, hash this. For Noobieteam we hash via frontend or backend.
        // The prompt says "hash this PIN on the user's profile".
        
        // We hash the PIN so the backend doesn't store plaintext, and this hash IS the encryption key.
        
        const hash = crypto.createHash('sha256').update(pin).digest('hex');
        const user = await User.findOneAndUpdate({ email }, { vaultPin: hash }, { new: true });
        res.json(user);
    } catch(e) { res.status(500).json({ error: e.message }); }
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
        
        const key = crypto.scryptSync(password, 'salt', 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        
        const payload = Buffer.from(JSON.stringify({ iv: iv.toString('hex'), encryptedData: encrypted, authTag: authTag })).toString('base64');
        res.json({ encrypted: payload });
    } catch (e) {
        res.status(500).json({ error: 'Encryption failed' });
    }
});

router.post('/workspaces/:wsId/vault/decrypt', async (req, res) => {
    try {
        const { cipherBase64, password } = req.body;
        if (!cipherBase64 || !password) return res.status(400).json({ error: 'Missing payload' });
        
        const payload = JSON.parse(Buffer.from(cipherBase64, 'base64').toString('utf8'));
        const key = crypto.scryptSync(password, 'salt', 32);
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
        
        let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        res.json({ decrypted });
    } catch (e) {
        // e.g. wrong password -> auth tag mismatch -> Decipher final failed
        res.status(401).json({ error: 'Incorrect password. Unable to decrypt secret.' });
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
