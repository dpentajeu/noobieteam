const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcrypt');
const { User } = require('../db');
const { body } = require('express-validator');
const { signToken } = require('../middleware/auth');
const wrap = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');

// Return the user identified by the verified JWT. The client uses this to
// establish session identity on load — it must never trust localStorage for
// *who you are*, only the signed token decides that. (Protected by the JWT gate;
// path is outside /auth/* so it is not in the public allowlist.)
router.get('/me', wrap(async (req, res) => {
    const user = await User.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
}));

// --- OAuth ---
router.post('/auth/google', wrap(async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    if (!process.env.GOOGLE_CLIENT_ID) {
        console.error("GOOGLE_CLIENT_ID is not configured — cannot verify Google sign-in.");
        return res.status(500).json({ error: 'Google sign-in is not configured on the server.' });
    }
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    // Always cryptographically verify the ID token's signature and audience.
    // No unsigned-decode fallback — a forged token must never authenticate a user.
    let payload;
    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
    } catch (verifyError) {
        console.error("Google verifyIdToken failed:", verifyError.message);
        return res.status(401).json({ error: 'Invalid Google credential' });
    }

    const { email, name, picture } = payload;

    let user = await User.findOne({ email });
    if (!user) {
        user = new User({ email, name, avatar: picture, method: 'google', password: 'oauth', lastLogin: new Date() });
        await user.save();
    } else {
        if (user.banned) return res.status(403).json({ error: 'Account is banned' });
        user.lastLogin = new Date();
        await user.save();
    }
    const token = signToken(user);
    res.json({ ...user.toObject(), token });
}));

// --- Login ---
router.post('/auth/login', [
    body('email').isEmail().withMessage('A valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
], validate, wrap(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(401).json({ error: 'Credentials mismatch' });
    if (user.banned) return res.status(403).json({ error: 'Account is banned' });

    // Passwords are always stored as bcrypt hashes; any legacy plaintext values
    // were migrated to hashes. No plaintext compare.
    let isMatch = false;
    try {
        isMatch = await bcrypt.compare(password, user.password);
    } catch (err) {
        isMatch = false; // stored value is not a valid bcrypt hash
    }

    if (!isMatch) return res.status(401).json({ error: 'Credentials mismatch' });

    user.lastLogin = new Date();
    await user.save();
    const token = signToken(user);
    res.json({ ...user.toObject(), token });
}));

module.exports = router;
