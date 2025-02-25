require('dotenv').config();
const mongoose = require('mongoose');
const migration = require('../migrations/20240224_bartender_to_staff.cjs');

async function runMigration() {
    try {
        // Connect to MongoDB using environment variable
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fomo';
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        // Run migration
        await migration.up();
        console.log('Migration completed successfully');

        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration(); 