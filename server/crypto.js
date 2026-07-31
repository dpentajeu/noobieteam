const crypto = require('crypto');

// AES-256-GCM configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV standard for GCM
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const ITERATIONS = 100000;

/**
 * Derives a consistent 256-bit key from the user's password and a deterministic salt.
 * In a real production system, the salt should be randomly generated and stored in the DB alongside the user profile.
 * For this implementation, we use a deterministic PBKDF2 derivative to align with the stateless front-end nature.
 */
const deriveKey = (password) => {
    // Generate a deterministic 16-byte salt from the password itself for demonstration
    // (This ensures decryption works across sessions without altering the User schema, though a unique DB salt is preferred).
    if (typeof password !== 'string') {
        console.error("[VAULT ERROR] deriveKey received a non-string password payload. Type:", typeof password, "Value:", password);
        password = password ? String(password) : ""; 
    }
    const salt = crypto.createHash('sha256').update(password + '_nt_salt').digest().slice(0, SALT_LENGTH);
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
};

/**
 * Encrypts a plaintext string (JSON or raw secret) using AES-256-GCM.
 * @param {string} plaintext - Data to encrypt.
 * @param {string} password - The user's master password.
 * @returns {object} { iv (hex), authTag (hex), encryptedHex (hex) }
 */
const encryptVaultSecret = (plaintext, password) => {
    if (!plaintext) {
        console.error("[VAULT ERROR] Plaintext payload is missing. Cannot encrypt empty data.");
        throw new Error("Payload is required for encryption.");
    }
    if (!password) {
        console.error("[VAULT ERROR] No password/key provided for encryption! This usually happens if you signed in with Google OAuth but haven't set up a Master Vault PIN yet. Please go to your Profile Menu -> 'Create Master PIN'.");
        throw new Error("Encryption failed: Missing authentication key or Master PIN.");
    }
    
    try {
        const key = deriveKey(password);
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encryptedHex = cipher.update(plaintext, 'utf8', 'hex');
        encryptedHex += cipher.final('hex');
        const authTagHex = cipher.getAuthTag().toString('hex');
        
        return {
            iv: iv.toString('hex'),
            authTag: authTagHex,
            value: encryptedHex
        };
    } catch (e) {
        console.error("[VAULT ERROR] Encryption Failure:", e.message);
        throw new Error("Encryption failed.");
    }
};

/**
 * Decrypts AES-256-GCM ciphertext. Throws an error if authentication fails (wrong password or tampered data).
 * @returns {string} The decrypted plaintext.
 */
const decryptVaultSecret = (encryptedHex, ivHex, authTagHex, password) => {
    if (!password) {
        console.error("[VAULT ERROR] No password/key provided for decryption! If using Google OAuth, ensure your Master Vault PIN is configured.");
        throw new Error("Decryption failed: Missing authentication key or Master PIN.");
    }
    try {
        const key = deriveKey(password);
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e) {
        console.error("[VAULT ERROR] Decryption Authentication Failed. Invalid password or corrupted data. Original error:", e.message);
        throw new Error('Authentication Failed. Invalid password or corrupted data.');
    }
};

// --- Server-managed secret encryption (no user PIN needed) ---
// Used for credentials the server itself must use without user interaction (e.g. Bitbucket app password).
// Key comes from env var NOOBIE_SERVER_KEY, with a deterministic dev fallback so re-encryption isn't needed across restarts.
const SERVER_KEY = (() => {
    const fromEnv = process.env.NOOBIE_SERVER_KEY;
    if (typeof fromEnv === 'string' && fromEnv.length >= 32) {
        return crypto.createHash('sha256').update(fromEnv).digest();
    }
    return crypto.createHash('sha256').update('noobieteam-dev-server-key-do-not-use-in-prod').digest();
})();

const encryptServerSecret = (plaintext) => {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('encryptServerSecret: plaintext is required');
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, SERVER_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return {
        iv: iv.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex'),
        value: encrypted
    };
};

const decryptServerSecret = ({ iv, authTag, value }) => {
    if (!iv || !authTag || !value) throw new Error('decryptServerSecret: incomplete payload');
    const decipher = crypto.createDecipheriv(ALGORITHM, SERVER_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(value, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

module.exports = { encryptVaultSecret, decryptVaultSecret, encryptServerSecret, decryptServerSecret };
