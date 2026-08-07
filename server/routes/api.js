const express = require('express');
const router = express.Router();

// Domain route modules. Each declares full paths, mounted at root so the
// public API surface is unchanged from when everything lived in this file.
router.use(require('./workspaces'));
router.use(require('./tasks'));
router.use(require('./auth'));
router.use(require('./users'));
router.use(require('./docs'));
router.use(require('./envs'));
router.use(require('./vault'));
router.use(require('./admin'));
router.use(require('./public'));
router.use(require('./emojis'));
router.use(require('./ai'));
router.use(require('./upload'));
router.use(require('./proxy'));

module.exports = router;
