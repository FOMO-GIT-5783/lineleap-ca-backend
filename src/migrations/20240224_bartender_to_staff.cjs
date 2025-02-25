const mongoose = require('mongoose');
const User = require('../models/User.cjs');
const Pass = require('../models/Pass.cjs');
const logger = require('../utils/logger.cjs');

const migrationLogger = logger.child({
    context: 'migration',
    migration: 'bartender-to-staff'
});

async function up() {
    try {
        // Update all users with bartender role to staff
        await User.updateMany(
            { role: 'bartender' },
            { $set: { role: 'staff' } }
        );

        // Update pass verifications
        await Pass.updateMany(
            { 'redemptionStatus.verifiedBy': 'bartender' },
            { $set: { 'redemptionStatus.verifiedBy': 'staff' } }
        );

        migrationLogger.info('Successfully migrated bartender roles to staff');
    } catch (error) {
        migrationLogger.error('Migration failed:', error);
        throw error;
    }
}

async function down() {
    try {
        // Revert staff roles back to bartender
        await User.updateMany(
            { role: 'staff' },
            { $set: { role: 'bartender' } }
        );

        // Revert pass verifications
        await Pass.updateMany(
            { 'redemptionStatus.verifiedBy': 'staff' },
            { $set: { 'redemptionStatus.verifiedBy': 'bartender' } }
        );

        migrationLogger.info('Successfully reverted staff roles to bartender');
    } catch (error) {
        migrationLogger.error('Migration rollback failed:', error);
        throw error;
    }
}

module.exports = {
    up,
    down
}; 