const mongoose = require('mongoose');

async function check() {
    await mongoose.connect('mongodb://127.0.0.1:36401/noobieteam');
    const db = mongoose.connection.db;
    const workspaces = await db.collection('workspaces').find({}).toArray();
    console.log('Workspaces in noobieteam:', workspaces);
    
    await mongoose.disconnect();
}

check();
