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
        console.error("Encryption Failure:", e.message);
        throw new Error("Encryption failed.");
    }
};

/**
 * Decrypts AES-256-GCM ciphertext. Throws an error if authentication fails (wrong password or tampered data).
 * @returns {string} The decrypted plaintext.
 */
const decryptVaultSecret = (encryptedHex, ivHex, authTagHex, password) => {
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
        // e.message will typically be 'Unsupported state or unable to authenticate data' for a wrong password in GCM mode.
        throw new Error('Authentication Failed. Invalid password or corrupted data.');
    }
};

module.exports = { encryptVaultSecret, decryptVaultSecret };
