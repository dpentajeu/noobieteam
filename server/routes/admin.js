const express = require('express');
const router = express.Router();
const { User } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { requireSuperAdmin } = require('../middleware/workspaceAuth');

// --- Admin ---
// Full user records for the superadmin management terminal. vaultPin is reduced
// to a boolean so the PIN hash itself is never sent to the client.
router.get('/admin/users', requireSuperAdmin, wrap(async (req, res) => {
    const users = await User.find().select('email name method avatar avatarUrl createdAt lastLogin vaultPin systemRole banned');
    const safe = users.map(u => {
        const obj = u.toObject();
        obj.vaultPin = !!obj.vaultPin;
        return obj;
    });
    res.json(safe);
}));

router.post('/admin/users/:email/reset-pin', requireSuperAdmin, wrap(async (req, res) => {
    const user = await User.findOneAndUpdate({ email: req.params.email }, { vaultPin: null }, { new: true });
    res.json({ success: true, user });
}));

module.exports = router;
