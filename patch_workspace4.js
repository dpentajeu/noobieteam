const fs = require('fs');
let code = fs.readFileSync('client/src/components/WorkspaceView.jsx', 'utf8');

code = code.replace(
    /if \(parentCol && parentCol\.title && parentCol\.title\.toLowerCase\(\)\.includes\('done'\)\) return false;/,
    `if (c.columnId === 'done' || (parentCol && parentCol.title && parentCol.title.toLowerCase().includes('done'))) return false;`
);

fs.writeFileSync('client/src/components/WorkspaceView.jsx', code);
console.log('patched WorkspaceView.jsx correctly');
