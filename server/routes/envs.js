const express = require('express');
const router = express.Router();
const { Env } = require('../db');
const wrap = require('../middleware/asyncHandler');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { requireWsMember } = require('../middleware/workspaceAuth');

router.get('/workspaces/:wsId/envs', requireWsMember(), wrap(async (req, res) => {
    const envs = await Env.find({ workspaceId: req.params.wsId });
    res.json(envs);
}));

router.post('/workspaces/:wsId/envs', requireWsMember(), [
    body('name').trim().notEmpty().withMessage('Env name is required'),
    body('variables').optional().isArray().withMessage('variables must be an array'),
], validate, wrap(async (req, res) => {
    const env = new Env({ ...req.body, workspaceId: req.params.wsId });
    await env.save();
    res.json(env);
}));

module.exports = router;
