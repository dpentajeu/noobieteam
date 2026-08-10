// Central Express error handler. Must be registered LAST (after all routes)
// and must keep the 4-argument signature — Express detects error middleware by arity.
const errorHandler = (err, req, res, next) => {
    // Mongoose optimistic-concurrency conflict.
    if (err.name === 'VersionError') {
        return res.status(409).json({ error: 'Conflict: This card was modified by another user. Please refresh and try again.' });
    }

    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const body = { error: err.message || 'Internal Server Error' };
    // Field-level details from express-validator (see middleware/validate.js).
    if (Array.isArray(err.errors)) body.errors = err.errors;
    res.status(status).json(body);
};

module.exports = errorHandler;
