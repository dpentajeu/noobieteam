const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const { Doc, Folder } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember, requireResourceMember, requireBulkResourceMember } = require('../middleware/workspaceAuth');

// --- Folders ---
router.get('/workspaces/:wsId/folders', requireWsMember(), wrap(async (req, res) => {
    const folders = await Folder.find({ workspaceId: req.params.wsId });
    res.json(folders);
}));

// `kind` decides which public surface the folder is published on, so a bad value
// has to be a 400 the client can act on — not the 500 a raw mongoose enum error
// would produce.
const FOLDER_KINDS = ['DOCS', 'API'];

router.post('/workspaces/:wsId/folders', requireWsMember(), [
    body('name').trim().notEmpty().withMessage('Folder name is required'),
    body('kind').optional().isIn(FOLDER_KINDS).withMessage(`kind must be one of: ${FOLDER_KINDS.join(', ')}`),
], validate, wrap(async (req, res) => {
    // A brand-new folder has no id yet, so it cannot close a loop — but it can
    // be parented to a folder in another workspace, which would put it in a tree
    // its own members cannot see.
    if (req.body.parentId) {
        const parent = mongoose.isValidObjectId(req.body.parentId)
            ? await Folder.findById(req.body.parentId).select('workspaceId')
            : null;
        if (!parent || String(parent.workspaceId) !== String(req.params.wsId)) {
            return res.status(400).json({ error: 'parentId must be a folder in this workspace' });
        }
    }
    const folder = new Folder({ ...req.body, workspaceId: req.params.wsId });
    await folder.save();
    res.json(folder);
}));

/**
 * Would setting `folderId`'s parent to `parentId` close a loop?
 *
 * The clients walk the parent chain to find a collection's root — for its
 * environments, its public URL, and to render the tree. A cycle makes that walk
 * never terminate. The clients now guard against it defensively, but the data
 * should not be able to reach that state in the first place, and only the server
 * can see the whole chain.
 */
const wouldCycle = async (folderId, parentId) => {
    if (!parentId) return false;
    if (String(parentId) === String(folderId)) return true;

    const seen = new Set([String(folderId)]);
    let currentId = String(parentId);
    // Bounded by the number of folders in the workspace; the seen-set is what
    // actually terminates it, this is just belt and braces against bad data.
    for (let hops = 0; hops < 1000; hops++) {
        if (seen.has(currentId)) return true;
        seen.add(currentId);
        if (!mongoose.isValidObjectId(currentId)) return false;
        const parent = await Folder.findById(currentId).select('parentId');
        if (!parent || !parent.parentId) return false;
        currentId = String(parent.parentId);
    }
    return true;
};

// `requireResourceMember` proves membership of the workspace the resource is in
// *right now*, so a writable `workspaceId` would let a member of A move a doc or
// folder into workspace B, which they are not in — and with `kind: 'API'` and a
// known slug that plants content on someone else's public page. The identity
// fields are never a legitimate part of an update; strip them from the patch.
// `expectedUpdatedAt` is a precondition, not a field; `createdAt`/`updatedAt` are
// the server's to set.
const withoutIdentity = ({ workspaceId, _id, id, createdAt, updatedAt, expectedUpdatedAt, ...rest }) => rest;

/**
 * Update a resource, refusing the write if someone else changed it first.
 *
 * Two people can have the same endpoint open for as long as they like: nothing
 * in this app pushes a change to the other tab. Without a precondition the
 * second save silently overwrites the first — and because the client sends
 * `apiSpec` as a whole object, it overwrites *every* field, not just the one
 * that was edited. So the client sends back the `updatedAt` it last saw, and a
 * mismatch is a 409 carrying the current server copy rather than a write.
 *
 * Omitting `expectedUpdatedAt` deliberately skips the check — that is how a
 * caller says "I have seen their version and still mean this", and how older
 * clients and scripts keep working.
 */
const guardedUpdate = async (Model, id, update, expected, res, missingMessage) => {
    if (expected === undefined || expected === null || expected === '') {
        const doc = await Model.findByIdAndUpdate(id, update, { new: true });
        if (!doc) return res.status(404).json({ error: missingMessage });
        return res.json(doc);
    }

    const seen = new Date(expected);
    if (Number.isNaN(seen.getTime())) {
        return res.status(400).json({ error: 'expectedUpdatedAt must be a date' });
    }

    const doc = await Model.findOneAndUpdate({ _id: id, updatedAt: seen }, update, { new: true });
    if (doc) return res.json(doc);

    // The precondition failed. Which of the two reasons it was decides what the
    // client can offer: retry against a newer version, or stop.
    const current = await Model.findById(id);
    if (!current) return res.status(404).json({ error: missingMessage });
    return res.status(409).json({
        error: 'This was changed by someone else since you opened it',
        conflict: true,
        current,
    });
};

router.put('/folders/:id', requireResourceMember(Folder, 'id'), [
    body('kind').optional().isIn(FOLDER_KINDS).withMessage(`kind must be one of: ${FOLDER_KINDS.join(', ')}`),
    body('published').optional().isBoolean().withMessage('published must be a boolean'),
    body('expectedUpdatedAt').optional({ nullable: true }).isISO8601().withMessage('expectedUpdatedAt must be an ISO date'),
], validate, wrap(async (req, res) => {
    if (Object.prototype.hasOwnProperty.call(req.body, 'parentId')
        && await wouldCycle(req.params.id, req.body.parentId)) {
        return res.status(400).json({ error: 'A folder cannot be nested inside itself or its own descendant' });
    }
    // A collection's `environments` are written as one array, so a stale save
    // does not merely lose the edit being made — it restores every variable the
    // other person just changed.
    await guardedUpdate(
        Folder, req.params.id, withoutIdentity(req.body), req.body.expectedUpdatedAt, res,
        'Collection no longer exists',
    );
}));

router.delete('/folders/:id', requireResourceMember(Folder, 'id'), wrap(async (req, res) => {
    await Folder.findByIdAndDelete(req.params.id);
    await Doc.updateMany({ folderId: req.params.id }, { $unset: { folderId: 1 } });
    res.json({ success: true });
}));

// --- Docs ---
router.get('/workspaces/:wsId/docs', requireWsMember(), wrap(async (req, res) => {
    const docs = await Doc.find({ workspaceId: req.params.wsId });
    res.json(docs);
}));

router.post('/workspaces/:wsId/docs', requireWsMember(), [
    body('title').trim().notEmpty().withMessage('Doc title is required'),
    body('type').optional().isIn(['TEXT', 'API']).withMessage('Invalid doc type'),
    body('apiSpec.method').optional().isIn(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).withMessage('Invalid API method'),
], validate, wrap(async (req, res) => {
    const doc = new Doc({ ...req.body, workspaceId: req.params.wsId });
    await doc.save();
    res.json(doc);
}));

router.delete('/docs/bulk', [
    body('docIds').isArray({ min: 1 }).withMessage('docIds array required'),
    body('docIds.*').isMongoId().withMessage('docIds must be valid ids'),
], validate, requireBulkResourceMember(Doc, 'docIds'), wrap(async (req, res) => {
    const { docIds } = req.body;
    await Doc.deleteMany({ _id: { $in: docIds } });
    res.json({ success: true });
}));

router.put('/docs/bulk-move', [
    body('docIds').isArray({ min: 1 }).withMessage('docIds array required'),
    body('docIds.*').isMongoId().withMessage('docIds must be valid ids'),
], validate, requireBulkResourceMember(Doc, 'docIds'), wrap(async (req, res) => {
    const { docIds, folderId } = req.body;
    await Doc.updateMany({ _id: { $in: docIds } }, folderId ? { $set: { folderId } } : { $unset: { folderId: 1 } });
    res.json({ success: true });
}));

router.put('/docs/:id', requireResourceMember(Doc, 'id'), [
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('type').optional().isIn(['TEXT', 'API']).withMessage('Invalid doc type'),
    body('expectedUpdatedAt').optional({ nullable: true }).isISO8601().withMessage('expectedUpdatedAt must be an ISO date'),
], validate, wrap(async (req, res) => {
    // Extract the share `password` so it is never persisted in plaintext, and
    // `passwordHash` so a caller cannot set one directly.
    const { password, passwordHash, ...update } = withoutIdentity(req.body);
    if (password !== undefined) {
        if (password === null || password === '') {
            update.passwordProtected = false;
            update.passwordHash = null;
        } else {
            // bcrypt, not a bare SHA-256: a share password is short and human-
            // chosen, so an unsalted single-round digest falls to a wordlist the
            // moment the collection leaks. Legacy hashes still verify — see
            // `sharePasswordMatches` in routes/public.js.
            update.passwordHash = await bcrypt.hash(String(password), 10);
            update.passwordProtected = true;
        }
    }
    await guardedUpdate(
        Doc, req.params.id, update, req.body.expectedUpdatedAt, res,
        'Document no longer exists',
    );
}));

router.delete('/docs/:id', requireResourceMember(Doc, 'id'), wrap(async (req, res) => {
    await Doc.findByIdAndDelete(req.params.id);
    res.json({ success: true });
}));

module.exports = router;
