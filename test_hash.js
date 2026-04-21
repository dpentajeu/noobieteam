const crypto = require('crypto');
function fallbackHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Return as a padded hex string to maintain payload consistency
        return Math.abs(hash).toString(16).padStart(64, '0');
}
console.log('Real SHA256:', crypto.createHash('sha256').update('123456').digest('hex'));
console.log('Fallback:', fallbackHash('123456'));
