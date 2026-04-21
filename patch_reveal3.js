const fs = require('fs');
let code = fs.readFileSync('client/src/components/VaultTab.jsx', 'utf8');

// The frontend should just pass the raw pin to decrypt so the backend can hash it securely using the real SHA-256 algorithm.
// Remove inHouseHash entirely to fix the HTTP/non-secure context hashing mismatch.
code = code.replace(
    /const payloadPass = await window\.inHouseHash\(revealPrompt\.pass\);/,
    `const payloadPass = revealPrompt.pass;`
);

fs.writeFileSync('client/src/components/VaultTab.jsx', code);
console.log('patched VaultTab.jsx');
