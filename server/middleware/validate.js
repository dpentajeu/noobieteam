const { validationResult } = require('express-validator');

// Runs after a set of express-validator chains. If any failed, forwards a 400
// to the central error handler with the collected field errors; otherwise
// passes control on to the route handler.
const validate = (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();

    const err = new Error('Validation failed');
    err.status = 400;
    err.errors = result.array().map(e => ({ field: e.path, message: e.msg }));
    next(err);
};

module.exports = validate;
