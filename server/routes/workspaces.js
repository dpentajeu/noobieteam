const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { Workspace, WorkspaceActivity, Task, Doc, Folder, Env, EmojiEvent } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember, requireWsOwner } = require('../middleware/workspaceAuth');
const storage = require('../storage');

// --- Workspaces ---
// Scoped to the caller's own memberships — superadmins included. This used to
// return Workspace.find() to every authenticated user and rely on the client to
// hide the rest, which exposed every workspace's name, slug and full member email
// list to anyone with an account.
router.get('/workspaces', wrap(async (req, res) => {
    const email = req.user && req.user.email;
    if (!email) return res.status(401).json({ error: 'Unauthenticated' });

    // members is [{ userId, role }] now, but legacy rows store plain email
    // strings — matching only members.userId would hide those from their own
    // members. The string clause has to run through the raw driver: Mongoose
    // casts `{ members: email }` against the subdocument schema and throws
    // ObjectParameterError before the query is ever sent. Ids come back from the
    // uncast query, then Mongoose hydrates them so the `id` virtual the client
    // reads is still present.
    const ids = await Workspace.collection.distinct('_id', {
        $or: [{ 'members.userId': email }, { members: email }],
    });

    const workspaces = await Workspace.find({ _id: { $in: ids } });
    res.json(workspaces);
}));

router.post('/workspaces', [
    body('name').trim().notEmpty().withMessage('Workspace name is required'),
], validate, wrap(async (req, res) => {
    // Expected: { name, color, avatar, archived, createdAt, members: [email] }
    const ws = new Workspace(req.body);
    if (!ws.slug) {
        ws.slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).substr(2, 4);
    }
    // Ensure the creator is a member (OWNER) so they aren't locked out by the
    // per-workspace authorization checks.
    const creator = req.user && req.user.email;
    if (creator) {
        const already = (ws.members || []).some(m => (typeof m === 'string' ? m : m && m.userId) === creator);
        if (!already) ws.members.push({ userId: creator, role: 'OWNER' });
    }
    // Initialize default columns
    ws.columns = [{ id: 'todo', title: 'To Do', order: 0 }, { id: 'inprog', title: 'In Progress', order: 1 }, { id: 'done', title: 'Done', order: 2 }];
    await ws.save();
    res.json(ws);
}));

// `columns` is validated here rather than trusted from the client: the board UI
// hides the delete control on the last remaining stage, but that is a rendering
// decision, and this route accepts whatever array it is handed. A workspace with
// no stages has nowhere to put a task.
router.put('/workspaces/:id', requireWsOwner('id'), [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('members').optional().isArray().withMessage('members must be an array'),
    body('members.*.role').optional().isIn(['OWNER', 'MEMBER']).withMessage('Invalid member role'),
    body('columns').optional().isArray({ min: 1 }).withMessage('A workspace must keep at least one stage'),
    body('columns.*.id').optional().isString().trim().notEmpty().withMessage('Each stage needs an id'),
    body('columns.*.title').optional().isString().trim().notEmpty().withMessage('Each stage needs a title'),
], validate, wrap(async (req, res) => {
    const ws = await Workspace.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(ws);
}));

// Permanently destroy a workspace and everything scoped to it.
//
// Unlike deleting a user — where authored comments and audit history are kept
// because the surrounding workspace still exists — nothing here outlives the
// workspace. Every one of these collections is keyed by workspaceId and is
// meaningless once the parent is gone, so orphaning them would just accumulate
// unreachable rows.
//
// Archiving (PUT /workspaces/:id with { archived: true }) remains the reversible
// option; this one is not.
router.delete('/workspaces/:id', requireWsOwner('id'), wrap(async (req, res) => {
    const workspaceId = req.params.id;
    // requireWsOwner validates the id shape for ordinary members, but a superadmin
    // short-circuits that check — so an unparseable id reaches here and would make
    // findById throw a CastError (500) instead of the 404 it deserves.
    if (!mongoose.isValidObjectId(workspaceId)) {
        return res.status(404).json({ error: 'Workspace not found' });
    }
    const ws = await Workspace.findById(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });

    // Collect attachment keys before the tasks are deleted — afterwards there is
    // nothing left pointing at those files.
    const tasks = await Task.find({ workspaceId }).select('attachments');
    const mediaKeys = tasks.flatMap(t =>
        (t.attachments || []).map(a => (a && typeof a.path === 'string' ? a.path : '')).filter(Boolean)
    );

    const [taskResult, docResult, folderResult, envResult, activityResult, emojiResult] = await Promise.all([
        Task.deleteMany({ workspaceId }),
        Doc.deleteMany({ workspaceId }),
        Folder.deleteMany({ workspaceId }),
        Env.deleteMany({ workspaceId }),
        WorkspaceActivity.deleteMany({ workspaceId }),
        EmojiEvent.deleteMany({ workspaceId }),
    ]);
    // The workspace row goes last, so a failure above leaves it reachable rather
    // than stranding its children behind a deleted parent.
    await Workspace.deleteOne({ _id: workspaceId });

    // Files only after the rows are gone: a failed unlink must not abort a
    // completed cascade. removeMany logs and continues.
    const removedFiles = await storage.removeMany(mediaKeys);

    res.json({
        success: true,
        workspace: ws.name,
        deleted: {
            tasks: taskResult.deletedCount || 0,
            docs: docResult.deletedCount || 0,
            folders: folderResult.deletedCount || 0,
            environments: envResult.deletedCount || 0,
            activityEntries: activityResult.deletedCount || 0,
            emojiEvents: emojiResult.deletedCount || 0,
            mediaFiles: removedFiles.length,
        },
    });
}));

// For updating columns or members specifically, we can use PUT /workspaces/:id

// --- Workspace Activity Log ---
router.get('/workspaces/:wsId/activity', requireWsMember(), wrap(async (req, res) => {
    const logs = await WorkspaceActivity.find({ workspaceId: req.params.wsId })
        .sort({ createdAt: -1 })
        .limit(200);
    res.json(logs);
}));

router.post('/workspaces/:wsId/activity', requireWsMember(), wrap(async (req, res) => {
    const { user, action, resourceType, resourceName } = req.body;
    const log = new WorkspaceActivity({ workspaceId: req.params.wsId, user, action, resourceType, resourceName });
    await log.save();
    res.json(log);
}));

module.exports = router;
