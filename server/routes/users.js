const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { User, Workspace, Task } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body, param } = require('express-validator');
const validate = require('../middleware/validate');
const { requireSuperAdmin, requireSelfOrSuperAdmin } = require('../middleware/workspaceAuth');

// Password policy — kept in sync with window.checkPasswordRules in
// client/src/utils/helpers.js. Only applied where a password is *set*
// (register, change password); POST /auth/login stays exempt so accounts
// created under the old 4-character rule can still sign in.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a symbol`;
const passwordPolicy = (field = 'password') => body(field)
    .isString().withMessage(PASSWORD_MESSAGE).bail()
    .isLength({ min: PASSWORD_MIN_LENGTH }).withMessage(PASSWORD_MESSAGE).bail()
    .matches(/[^A-Za-z0-9]/).withMessage(PASSWORD_MESSAGE);

// Slim directory for any authenticated user (assignees, mentions, avatars).
// No sensitive fields (vaultPin, systemRole, banned, lastLogin) are exposed here —
// superadmin tooling uses GET /admin/users for the full records.
router.get('/users', wrap(async (req, res) => {
    const users = await User.find().select('email name avatar avatarUrl');
    res.json(users);
}));

router.get('/users/:email', requireSelfOrSuperAdmin('email'), wrap(async (req, res) => {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
}));

//--- Register ---
router.post('/users', [
    body('email').isEmail().withMessage('A valid email is required'),
    passwordPolicy(),
], validate, wrap(async (req, res) => {
    const email = req.body.email;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.password, salt);

    // Never let a self-registration set privilege or ban state.
    const { systemRole, banned, ...rest } = req.body;
    const userData = { ...rest, password: hashedPassword };
    const user = new User(userData);

    await user.save();
    res.json(user);
}));

router.put('/users/pin', [
    body('pin').isString().isLength({ min: 4 }).withMessage('PIN must be at least 4 characters'),
], validate, wrap(async (req, res) => {
    // Always the caller's own account — ignore any body-supplied email.
    const email = req.user && req.user.email;
    const { pin } = req.body;
    if (!email) return res.status(401).json({ error: 'Unauthenticated' });
    const hash = crypto.createHash('sha256').update(pin).digest('hex');
    let user = await User.findOneAndUpdate({ email }, { vaultPin: hash }, { new: true });
    if (!user) {
        // If user doesn't exist, seed them now
        user = new User({ email, vaultPin: hash, name: email.split('@')[0], method: 'local', password: 'seed' });
        await user.save();
    }
    res.json({ success: true, vaultPin: user.vaultPin });
}));

router.put('/users/:email/password', requireSelfOrSuperAdmin('email'), [
    param('email').isEmail().withMessage('A valid email is required'),
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    passwordPolicy(),
], validate, wrap(async (req, res) => {
    const { currentPassword, password } = req.body;
    const existingUser = await User.findOne({ email: req.params.email });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    // Verify current password against the bcrypt hash only — no plaintext compare.
    let isMatch = false;
    try {
        isMatch = await bcrypt.compare(currentPassword, existingUser.password);
    } catch (err) {
        isMatch = false; // stored value is not a valid bcrypt hash
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
}));

// Ban / unban a user — superadmin only. Body: { banned: boolean }
router.put('/users/:email/ban', requireSuperAdmin, [
    param('email').isEmail().withMessage('A valid target email is required'),
    body('banned').isBoolean().withMessage('banned (boolean) is required').toBoolean(),
], validate, wrap(async (req, res) => {
    const banned = req.body.banned;
    const target = await User.findOne({ email: req.params.email });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.systemRole === 'SUPERADMIN') return res.status(403).json({ error: 'Cannot ban a superadmin' });
    if (req.user.email === target.email) return res.status(400).json({ error: 'You cannot ban yourself' });

    target.banned = banned;
    await target.save();
    res.json({ success: true, email: target.email, banned: target.banned });
}));

// Promote / demote a user's global role — superadmin only. Body: { systemRole }
// This is the only write path for systemRole; the generic PUT /users/:email
// strips it, and self-registration strips it too.
router.put('/users/:email/role', requireSuperAdmin, [
    param('email').isEmail().withMessage('A valid target email is required'),
    body('systemRole').isIn(['SUPERADMIN', 'USER']).withMessage("systemRole must be 'SUPERADMIN' or 'USER'"),
], validate, wrap(async (req, res) => {
    const { systemRole } = req.body;
    const target = await User.findOne({ email: req.params.email });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Changing your own role is how you accidentally lock yourself out.
    if (req.user.email === target.email) return res.status(400).json({ error: 'You cannot change your own role' });

    // Never leave the system with no superadmin in the database. The DB is the
    // only source of this role — there is no env-var fallback — so demoting the
    // last one locks everyone out of the admin surfaces until someone with shell
    // access runs server/scripts/seedSuperadmin.js.
    if (target.systemRole === 'SUPERADMIN' && systemRole !== 'SUPERADMIN') {
        const superadmins = await User.countDocuments({ systemRole: 'SUPERADMIN' });
        if (superadmins <= 1) {
            return res.status(400).json({ error: 'Cannot demote the last superadmin. Promote another user first.' });
        }
    }

    target.systemRole = systemRole;
    await target.save();
    res.json({ success: true, email: target.email, systemRole: target.systemRole });
}));

// Delete a user — superadmin only.
//
// Deletion revokes access; it does not erase history. The account, its workspace
// memberships, its task assignments and any pending @-mentions of it are removed.
// Authored content (comments, audit trail, activity log, doc/folder createdBy) is
// deliberately KEPT: the email is the only identity recorded there, so wiping it
// would destroy the provenance of work that still exists.
//
// Takes effect immediately: authRequired (middleware/auth.js) re-reads the user on
// every request and 401s once the row is gone, so an outstanding JWT is not usable.
// The one exception is a socket that is already connected — io.use only checks at
// handshake time (index.js) — so a live connection survives until it drops.
router.delete('/users/:email', requireSuperAdmin, [
    param('email').isEmail().withMessage('A valid target email is required'),
], validate, wrap(async (req, res) => {
    const email = req.params.email;
    const target = await User.findOne({ email });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.email === target.email) return res.status(400).json({ error: 'You cannot delete yourself' });
    if (target.systemRole === 'SUPERADMIN') return res.status(403).json({ error: 'Cannot delete a superadmin. Demote them first.' });

    // Workspaces this user solely owns would be left with no OWNER. Not a reason
    // to block the delete, but the caller needs to know so they can reassign.
    const ownedWorkspaces = await Workspace.find({ members: { $elemMatch: { userId: email, role: 'OWNER' } } }).select('name members');
    const orphanedWorkspaces = ownedWorkspaces
        .filter(ws => (ws.members || []).filter(m => m && m.role === 'OWNER').length <= 1)
        .map(ws => ws.name);

    const membershipResult = await Workspace.updateMany({}, { $pull: { members: { userId: email } } });
    const assignmentResult = await Task.updateMany({}, { $pull: { assignees: email } });
    // Nested array inside an array element — $[] applies the pull to every comment.
    await Task.updateMany({}, { $pull: { 'comments.$[].taggedUsers': email } });
    await User.deleteOne({ email });

    res.json({
        success: true,
        email,
        workspacesUpdated: membershipResult.modifiedCount || 0,
        tasksUnassigned: assignmentResult.modifiedCount || 0,
        orphanedWorkspaces,
    });
}));

router.put('/users/:email', requireSelfOrSuperAdmin('email'), [
    param('email').isEmail().withMessage('A valid email is required'),
    body('name').optional().isString().isLength({ max: 200 }).withMessage('Name too long'),
], validate, wrap(async (req, res) => {
    // Never allow privilege or ban state to be changed through the generic update —
    // those go through /users/:email/ban and admin tooling only.
    const { password, vaultPin, email, systemRole, banned, ...safeBody } = req.body;
    const user = await User.findOneAndUpdate({ email: req.params.email }, safeBody, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
}));

module.exports = router;
