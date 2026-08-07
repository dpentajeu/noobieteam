const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember } = require('../middleware/workspaceAuth');

// --- Vault (AES-GCM Encryption endpoints) ---
const ALGORITHM = 'aes-256-gcm';

router.post('/workspaces/:wsId/vault/encrypt', requireWsMember(), [
    body('text').notEmpty().withMessage('text is required'),
    body('password').notEmpty().withMessage('password is required'),
], validate, wrap(async (req, res) => {
    const { text, password } = req.body;

    try {
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
        // Preserve the domain-specific error message for the central handler.
        throw new Error('Encryption failed: ' + e.message);
    }
}));

// Vault Decrypt Route removed as encryption is strictly local now.

module.exports = router;
