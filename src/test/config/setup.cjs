const mongoose = require('mongoose');
const logger = require('../../utils/logger.cjs');

// Cleanup function to ensure we don't have hanging connections
const cleanup = async () => {
    try {
        await mongoose.disconnect();
    } catch (err) {
        console.error('Cleanup error:', err);
    }
};

// Clear all collections in the test database
const clearDatabase = async () => {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('clearDatabase can only be run in test environment');
    }
    
    try {
        const collections = Object.values(mongoose.connection.collections);
        for (const collection of collections) {
            await collection.deleteMany({});
        }
    } catch (err) {
        logger.error('Failed to clear database:', err);
        throw err;
    }
};

// Simple setup that just ensures we're disconnected before tests
module.exports = async () => {
    await cleanup();
};

// Export functions for use in tests
module.exports.teardown = cleanup;
module.exports.clearDatabase = clearDatabase;

// No need for clearDatabase since we're not using in-memory DB anymore 