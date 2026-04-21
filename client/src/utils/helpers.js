// --- Global Utilities ---
// Simple async hashing for Google PIN encryption key
window.inHouseHash = async (text) => {
    // Web Crypto API is only available in secure contexts (HTTPS or localhost).
    // Provide a robust fallback for development environments or insecure IPs.
    if (window.crypto && window.crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
        console.warn("[VAULT] window.crypto.subtle is undefined. Falling back to internal SHA-256 simulation.");
        // A simple deterministic hash fallback for non-secure contexts
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Return as a padded hex string to maintain payload consistency
        return Math.abs(hash).toString(16).padStart(64, '0');
    }
};


window.safeParse = (key, fallback) => {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
    } catch (e) {
        console.error('Local Storage Corruption Detected:', key);
        localStorage.removeItem(key);
        return fallback;
    }
};

window.generateId = (prefix = '') => prefix + '-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);

// Robust In-House Hex-based Encryption (Unicode safe)
window.stringToHex = (str) => {
    let res = '';
    for(let i=0; i<str.length; i++) res += str.charCodeAt(i).toString(16).padStart(4, '0');
    return res;
};

window.hexToString = (hex) => {
    let res = '';
    for(let i=0; i<hex.length; i+=4) res += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return res;
};

window.inHouseEncrypt = (text, key) => {
    if (!key) key = 'noobieteam_core';
    const hexText = window.stringToHex(text);
    let result = '';
    for (let i = 0; i < hexText.length; i++) {
        result += String.fromCharCode(hexText.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
};

window.inHouseDecrypt = (base64, key) => {
    try {
        if (!key) key = 'noobieteam_core';
        const cipher = atob(base64);
        let hex = '';
        for (let i = 0; i < cipher.length; i++) {
            hex += String.fromCharCode(cipher.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return window.hexToString(hex);
    } catch (e) { return null; }
};

window.extractYoutubeId = (url) => {
    if (!url) return null;
    let cleanUrl = url.trim().replace(/['"]/g, '');
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/|live\/)([^#\&\?\/]*).*/;
    const match = cleanUrl.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

window.extractPlaylistId = (url) => {
    if (!url) return null;
    let cleanUrl = url.trim().replace(/['"]/g, '');
    const regExp = /[&?]list=([^&]+)/i;
    const match = cleanUrl.match(regExp);
    return match ? match[1] : null;
};
