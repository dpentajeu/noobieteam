const jwt = require('jsonwebtoken');
const { User } = require('../db');

const IS_PROD = process.env.NODE_ENV === 'production';

// JWT_SECRET is mandatory in production — never fall back to a known value there.
// In non-production we allow a clearly-labelled dev secret so local login works.
const DEV_FALLBACK_SECRET = 'dev-insecure-secret-change-me';
if (!process.env.JWT_SECRET) {
    if (IS_PROD) {
        throw new Error('JWT_SECRET environment variable is required in production. Refusing to start.');
    }
    console.warn('[auth] JWT_SECRET not set — using an insecure development fallback. Do NOT use in production.');
}
const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;

// Always give tokens an expiry; without this jwt.sign throws on an undefined value.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Sign a JWT for an authenticated user.
 * Keep the payload minimal (no password/secrets).
 */
const signToken = (user) => {
    const payload = {
        sub: String(user._id || user.id || ''),
        email: user.email,
        name: user.name,
        systemRole: user.systemRole || 'USER',
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

/**
 * Express middleware. Requires a valid Bearer token, then refreshes the
 * authoritative role/ban state from the DB so a revoked/banned/promoted user
 * takes effect immediately (not only on their next login).
 */
const authRequired = async (req, res, next) => {
    try {
        const header = req.headers['authorization'] || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) {
            return res.status(401).json({ error: 'Missing authentication token' });
        }

        let claims;
        try {
            claims = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Load current role/ban state so a revoked/banned/promoted user takes effect immediately.
        const user = await User.findOne({ email: claims.email }).select('email name systemRole banned');
        if (!user) return res.status(401).json({ error: 'User no longer exists' });
        if (user.banned) return res.status(403).json({ error: 'Account is banned' });

        req.user = {
            sub: claims.sub,
            email: user.email,
            name: user.name,
            systemRole: user.systemRole || 'USER',
        };
        next();
    } catch (err) {
        next(err);
    }
};

// Verify a raw JWT string; throws if invalid/expired. Used outside Express (sockets).
const verifyToken = (token) => jwt.verify(token, JWT_SECRET);

module.exports = { signToken, authRequired, verifyToken, JWT_SECRET };
