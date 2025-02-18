const mongoose = require('mongoose');
const Pass = require('../models/Pass.cjs');
const Order = require('../models/Order.cjs');
const logger = require('../utils/logger.cjs');

async function migratePaymentModels() {
    try {
        logger.info('Starting payment models migration');

        // Migrate Pass documents
        const passes = await Pass.find({});
        let passesUpdated = 0;

        for (const pass of passes) {
            // Only update if needed
            if (!pass.metadata || !pass.transactionId) {
                pass.metadata = pass.metadata || new Map();
                pass.transactionId = pass.transactionId || `migrated_${pass.paymentIntentId}`;
                
                // Ensure status history has metadata
                pass.statusHistory = pass.statusHistory.map(history => ({
                    ...history,
                    metadata: history.metadata || new Map()
                }));

                await pass.save();
                passesUpdated++;
            }
        }

        // Migrate Order documents
        const orders = await Order.find({});
        let ordersUpdated = 0;

        for (const order of orders) {
            // Only update if needed
            if (!order.metadata || !order.transactionId || !order.idempotencyKey) {
                order.metadata = order.metadata || new Map();
                order.transactionId = order.transactionId || `migrated_${order._id}`;
                order.idempotencyKey = order.idempotencyKey || `migrated_${order._id}`;
                
                // Add status history if not present
                if (!order.statusHistory) {
                    order.statusHistory = [{
                        status: order.status,
                        timestamp: order.createdAt,
                        metadata: new Map()
                    }];
                }

                await order.save();
                ordersUpdated++;
            }
        }

        logger.info('Migration completed', {
            passesUpdated,
            ordersUpdated,
            totalPasses: passes.length,
            totalOrders: orders.length
        });

    } catch (error) {
        logger.error('Migration failed', {
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Run migration if called directly
if (require.main === module) {
    const { config } = require('../config/environment.cjs');
    
    mongoose.connect(config.database.url, config.database.options)
        .then(() => migratePaymentModels())
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = migratePaymentModels; 