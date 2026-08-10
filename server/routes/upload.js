const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = require('../storage');
const { MAX_UPLOAD_BYTES } = require('../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const acceptFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      const limit = MAX_UPLOAD_BYTES >= 1024 * 1024
        ? `${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`
        : `${Math.round(MAX_UPLOAD_BYTES / 1024)}KB`;
      return res.status(413).json({ error: `File exceeds the ${limit} limit.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
};

router.post('/upload', acceptFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    const category = (req.body && req.body.category) || req.query.category;
    if (!storage.CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Expected one of: ${storage.CATEGORIES.join(', ')}.`,
      });
    }
    const key = storage.buildKey(category, req.file.originalname);
    await storage.put(key, req.file.buffer, req.file.mimetype);
    res.json({ path: key });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed.' });
  }
});

module.exports = router;
