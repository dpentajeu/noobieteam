// Wrap an async route handler so any thrown error / rejected promise is
// forwarded to Express's error-handling middleware instead of hanging the request.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = wrap;
