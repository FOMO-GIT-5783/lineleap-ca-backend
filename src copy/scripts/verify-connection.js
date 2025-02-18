require('dotenv').config({ path: '.env.development' });
const { connectDB } = require('../config/database.cjs');
const logger = require('../utils/logger.cjs');

async function verifyConnection() {
    try {
        await connectDB();
        logger.info('Successfully connected to MongoDB');
        process.exit(0);
    } catch (error) {
        logger.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

verifyConnection(); 