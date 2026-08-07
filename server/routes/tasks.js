const express = require('express');
const router = express.Router();
const { Task, Workspace } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember, requireResourceMember } = require('../middleware/workspaceAuth');
const storage = require('../storage');

// Delete uploaded files a task no longer references.
//
// Attachment removal is a local edit in the card modal until the user saves, so
// the file must be deleted when the *database* stops pointing at it — not when
// the button is clicked. Removing an attachment and then closing without saving
// therefore leaves both the row and the file intact, which is what the UI implies.
//
// Always call this AFTER the task has been persisted: a failed unlink must never
// roll back a successful write. A leftover file is recoverable; a task row
// pointing at a file that no longer exists is not.
const pruneAttachmentFiles = async (previousAttachments, nextAttachments) => {
    const keyOf = (a) => (a && typeof a.path === 'string' ? a.path : '');
    // Legacy attachments are base64 in `dataUrl` with no `path`, so they have no
    // file to remove and fall out here naturally.
    const stillReferenced = new Set((nextAttachments || []).map(keyOf).filter(Boolean));
    const orphaned = (previousAttachments || []).map(keyOf).filter(Boolean).filter(k => !stillReferenced.has(k));
    await storage.removeMany(orphaned);
};

// Tells everyone watching a board that its tasks changed, so their notification scan
// runs now instead of on their next 15-20s poll.
//
// This lives on the server, not at each client call site, for two reasons: no mutation
// path can forget to announce, and a write made by a different client — or by any other
// tool hitting the API — is covered for free.
//
// The payload carries no card data on purpose. Each client re-reads and diffs against
// its own baseline, so involvement filtering, dedupe and per-user wording all stay
// client-side and no recipient list has to be computed here.
const announceTaskWrite = (req, workspaceId) => {
    if (!workspaceId) return;
    const io = req.app.get('io');
    if (!io) return;
    io.to(String(workspaceId)).emit('cards:refresh', {
        workspaceId: String(workspaceId),
        actorEmail: (req.user && req.user.email) || '',
    });
};

router.get('/workspaces/:wsId/tasks', requireWsMember(), wrap(async (req, res) => {
    const tasks = await Task.find({ workspaceId: req.params.wsId });
    res.json(tasks);
}));

router.post('/workspaces/:wsId/tasks', requireWsMember(), [
    body('title').trim().notEmpty().withMessage('Task title is required'),
    body('urgency').optional().isIn(['LOW', 'MED', 'HIGH']).withMessage('Invalid urgency'),
    body('qaStatus').optional().isIn(['NONE', 'PENDING', 'PASSED', 'FAILED']).withMessage('Invalid qaStatus'),
    body('dueDate').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('dueDate must be a valid date'),
], validate, wrap(async (req, res) => {
    const { auditEvent, ...taskData } = req.body;
    const task = new Task({ ...taskData, workspaceId: req.params.wsId });
    if (auditEvent) {
        task.auditTrail = [{ user: auditEvent.user, action: auditEvent.action, timestamp: new Date() }];
    }
    await task.save();
    announceTaskWrite(req, task.workspaceId);
    res.json(task);
}));

// --- Aggregated "My Tasks" across all boards ---
router.get('/my-tasks', wrap(async (req, res) => {
    // Identity from the verified JWT; header/query only as a legacy fallback.
    const userEmail = (req.user && req.user.email) || req.headers['user-email'] || req.query.email;
    if (!userEmail) return res.status(400).json({ error: 'Missing user email' });

    const allWorkspaces = await Workspace.find({ archived: { $ne: true } });

    // Membership is the only thing that makes a workspace visible here, for
    // everyone. A superadmin governs accounts, not workspace content — see the
    // policy note in middleware/workspaceAuth.js — so they see their own tasks
    // like any other user, and must be added as a member to see a board's.
    const visibleWorkspaces = allWorkspaces.filter(w => {
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
}));

// --- Bulk Operations ---
router.put('/workspaces/:wsId/tasks/bulk-archive', requireWsMember(), [
    body('cardIds').isArray({ min: 1 }).withMessage('cardIds array required'),
    body('cardIds.*').isMongoId().withMessage('cardIds must be valid ids'),
], validate, wrap(async (req, res) => {
    const { cardIds } = req.body;
    await Task.updateMany({ _id: { $in: cardIds }, workspaceId: req.params.wsId }, { $set: { archived: true, expiredAlertAcknowledged: true } });
    announceTaskWrite(req, req.params.wsId);
    res.json({ success: true });
}));

router.put('/workspaces/:wsId/tasks/bulk-move', requireWsMember(), [
    body('cardIds').isArray({ min: 1 }).withMessage('cardIds array required'),
    body('cardIds.*').isMongoId().withMessage('cardIds must be valid ids'),
    body('targetColumn').notEmpty().withMessage('targetColumn is required'),
], validate, wrap(async (req, res) => {
    const { cardIds, targetColumn } = req.body;
    await Task.updateMany({ _id: { $in: cardIds }, workspaceId: req.params.wsId }, { $set: { columnId: targetColumn, expiredAlertAcknowledged: true } });
    announceTaskWrite(req, req.params.wsId);
    res.json({ success: true });
}));

router.put('/workspaces/:wsId/tasks/bulk-order', requireWsMember(), [
    body('updates').isArray({ min: 1 }).withMessage('updates array required'),
    body('updates.*.id').isMongoId().withMessage('each update needs a valid id'),
], validate, wrap(async (req, res) => {
    const { updates } = req.body; // updates = [{ id: 'taskId', orderIndex: 0, columnId: 'todo' }, ...]

    const bulkOps = updates.map(u => ({
        updateOne: {
            filter: { _id: u.id, workspaceId: req.params.wsId },
            update: { $set: { orderIndex: u.orderIndex, columnId: u.columnId } }
        }
    }));

    if (bulkOps.length > 0) {
        await Task.bulkWrite(bulkOps);
        // Reorders within a column produce no notification, but a drag across columns
        // comes through here too and must not wait for a poll.
        announceTaskWrite(req, req.params.wsId);
    }
    res.json({ success: true });
}));

router.put('/tasks/:id', requireResourceMember(Task, 'id'), wrap(async (req, res) => {
    const { auditEvent, __v, ...updateData } = req.body;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Snapshot before Object.assign replaces the array, so the saved task can be
    // diffed against what it used to reference.
    const previousAttachments = (task.attachments || []).map(a => ({ path: a && a.path }));

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

    // A concurrent save bumping __v throws VersionError -> handled centrally as 409.
    await task.save();

    // Only prune when the request actually carried an attachments array; any other
    // update leaves the list untouched and has nothing to clean up.
    if (Object.prototype.hasOwnProperty.call(updateData, 'attachments')) {
        await pruneAttachmentFiles(previousAttachments, task.attachments);
    }

    announceTaskWrite(req, task.workspaceId);
    res.json(task);
}));

// --- Task Comments ---
router.post('/tasks/:taskId/comments', requireResourceMember(Task, 'taskId'), [
    body('authorEmail').isEmail().withMessage('A valid authorEmail is required'),
    body('text').trim().notEmpty().withMessage('Comment text is required'),
    body('taggedUsers').optional().isArray().withMessage('taggedUsers must be an array'),
    body('taggedUsers.*').optional().isEmail().withMessage('taggedUsers must be emails'),
], validate, wrap(async (req, res) => {
    const { authorEmail, text, taggedUsers } = req.body;

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

    // Carries the @mention that was just added, so the mention notification is the
    // fastest one in the system rather than the slowest.
    if (task) announceTaskWrite(req, task.workspaceId);
    res.status(201).json(task);
}));

router.delete('/tasks/:taskId/comments/:commentId', requireResourceMember(Task, 'taskId'), wrap(async (req, res) => {
    const task = await Task.findByIdAndUpdate(
        req.params.taskId,
        { $pull: { comments: { _id: req.params.commentId } } },
        { new: true }
    );
    if (task) announceTaskWrite(req, task.workspaceId);
    res.json(task);
}));

router.delete('/tasks/:id', requireResourceMember(Task, 'id'), wrap(async (req, res) => {
    const task = await Task.findByIdAndDelete(req.params.id);
    // The row is gone, so every file it referenced is now unreachable.
    if (task) {
        await pruneAttachmentFiles(task.attachments, []);
        announceTaskWrite(req, task.workspaceId);
    }
    res.json({ success: true });
}));

module.exports = router;
