/**
 * One-time: promote a user to SUPERADMIN.
 *
 * This is the only way to create the first superadmin: SUPERADMIN lives solely
 * in the users collection, and the app refuses to demote, ban or delete the last
 * one, so there is no path back in from the UI once none exists.
 *
 * Usage:
 *   node server/scripts/seedSuperadmin.js boss@example.com
 */
const mongoose = require('mongoose');
const { connectDB, User } = require('../db');

(async () => {
    const email = process.argv[2];
    if (!email) {
        console.error('Provide an email: node server/scripts/seedSuperadmin.js <email>');
        process.exit(1);
    }

    await connectDB();
    const user = await User.findOne({ email });
    if (!user) {
        console.error(`No user found with email ${email}. They must sign up first.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    user.systemRole = 'SUPERADMIN';
    user.banned = false;
    await user.save();
    console.log(`✓ ${email} is now SUPERADMIN.`);

    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
});
