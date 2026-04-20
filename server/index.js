require('dotenv').config();
const express = require('express');
const path = require('path');
const { connectDB, Workspace } = require('./db');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 8000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@noobieteam.ai';

// Connect to MongoDB
connectDB();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../client')));

app.get('/api/config', (req, res) => {
    res.json({ adminEmail: ADMIN_EMAIL });
});

// RBAC: Secure workspace deletion endpoint
app.delete('/api/workspaces/:id', async (req, res) => {
    const userEmail = req.headers['user-email'] || req.body.email || req.query.email;
    if (!userEmail || userEmail !== ADMIN_EMAIL) {
        return res.status(403).json({ error: "Forbidden: Only admins can delete workspaces." });
    }
    try {
        await Workspace.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Workspace deleted successfully." });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Use other API routes
app.use('/api', apiRoutes);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
