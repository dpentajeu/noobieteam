const fs = require('fs');
let code = fs.readFileSync('client/src/components/VaultTab.jsx', 'utf8');

if (code.includes('await window.inHouseHash(revealPrompt.pass)')) {
    // If the local user uses `user.password` for encryption, that is NOT hashed! It's just the plaintext password.
    // Wait, earlier the prompt said: "Okay, why not we extend vault pin to even local user, those with email and password login, will be same as Oauth need to create vault pin and unlock credentail with pin to reveal credential."
    // So now EVERYONE uses the vault pin.
    // If everyone uses the vault pin, then `password: user?.vaultPin || user?.password` in `encrypt` will prioritize `user?.vaultPin` (which is a SHA256 hex).
    // `processReveal` uses `await window.inHouseHash(revealPrompt.pass)` which generates a SHA256 hex.
    
    // BUT what if `window.crypto.subtle` is undefined because of HTTP?
    // `inHouseHash` falls back to `console.warn("[VAULT] window.crypto.subtle is undefined...")` and what does it return?
}
