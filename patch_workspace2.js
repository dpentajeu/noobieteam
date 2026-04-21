const fs = require('fs');
let code = fs.readFileSync('client/src/components/WorkspaceView.jsx', 'utf8');

// The `columns` variable might not be available right there during the fetch since `setColumns` happens independently or they are fetched together?
// Let's check where `columns` comes from.
