const fs = require('fs');
let code = fs.readFileSync('server/routes/api.js', 'utf8');

if (!code.includes('crypto.createHash(')) {
   // wait, it is in api.js
}
code = code.replace(
    /const safePassword = String\(password\);(\s+)const payload = JSON\.parse/,
    `let safePassword = String(password);
        if (safePassword.length < 64) {
            safePassword = crypto.createHash('sha256').update(safePassword).digest('hex');
        }$1const payload = JSON.parse`
);

fs.writeFileSync('server/routes/api.js', code);
console.log('patched api.js');
