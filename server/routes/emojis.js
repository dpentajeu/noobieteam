const express = require('express');
const router = express.Router();
const { EmojiEvent } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember, requireBulkResourceMember } = require('../middleware/workspaceAuth');

// --- Emoji Meme Events ---
router.post('/workspaces/:wsId/emojis', requireWsMember(), wrap(async (req, res) => {
    const { senderEmail, emojiType } = req.body;
    const newEmoji = new EmojiEvent({
        workspaceId: req.params.wsId,
        senderEmail,
        emojiType,
        viewedBy: [senderEmail] // the sender inherently 'saw' their own action
    });
    await newEmoji.save();
    res.status(201).json(newEmoji);
}));

// Fetch unseen emojis for a specific user in a workspace
router.get('/workspaces/:wsId/emojis/unseen', requireWsMember(), wrap(async (req, res) => {
    const userEmail = (req.user && req.user.email) || req.headers['user-email'] || req.query.email;
    if (!userEmail) return res.status(400).json({ error: "Missing user email." });

    // Find emojis in this WS that DO NOT have the userEmail in the viewedBy array
    const unseenEmojis = await EmojiEvent.find({
        workspaceId: req.params.wsId,
        viewedBy: { $ne: userEmail }
    }).sort({ createdAt: -1 }).limit(5); // ONLY ALLOW 5 LATEST ACTIONS TO AVOID SPAM

    res.json(unseenEmojis);
}));

// Mark an array of emoji IDs as viewed by a specific user
router.put('/emojis/mark-viewed', [
    body('emojiIds').isArray({ min: 1 }).withMessage('emojiIds array required'),
    body('emojiIds.*').isMongoId().withMessage('emojiIds must be valid ids'),
    body('userEmail').isEmail().withMessage('userEmail is required'),
], validate, requireBulkResourceMember(EmojiEvent, 'emojiIds'), wrap(async (req, res) => {
    const { emojiIds, userEmail } = req.body;

    // Add the user to the viewedBy array for all specified IDs
    await EmojiEvent.updateMany(
        { _id: { $in: emojiIds } },
        { $addToSet: { viewedBy: userEmail } }
    );
    res.json({ success: true });
}));

module.exports = router;
