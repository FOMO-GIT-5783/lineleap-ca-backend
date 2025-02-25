const mongoose = require('mongoose');
const { ORDER_EVENTS } = require('../utils/constants.cjs');
const OrderMetrics = require('../models/OrderMetrics.cjs');
const ExcelJS = require('exceljs');
const { Order } = require('../models/Order.cjs');
const { FOMO_METRIC_TYPES } = require('../schemas/metrics.cjs');
const { metricProxy } = require('../middleware/metricsProxy.cjs');
const logger = require('../utils/logger.cjs');

class OrderMetricsService {
    // Track order creation
    static async trackOrderCreation(order) {
        return {
            orderId: order._id,
            venueId: order.venueId,
            userId: order.userId,
            eventType: 'creation',
            orderType: 'drink',
            processingTime: 0,
            revenue: {
                subtotal: order.subtotal,
                tipAmount: order.tip,
                total: order.total
            },
            metadata: {
                items: order.items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price
                }))
            }
        };
    }

    // Track status change
    static async trackStatusChange(order, oldStatus) {
        const processingTime = order.completedAt 
            ? order.completedAt - order.createdAt 
            : Date.now() - order.createdAt;

        return OrderMetrics.create({
            orderId: order._id,
            venueId: order.venueId,
            userId: order.userId,
            eventType: 'status_change',
            orderType: 'drink',
            processingTime,
            metadata: {
                oldStatus,
                newStatus: order.status,
                updatedBy: order.bartenderId
            }
        });
    }

    // Track verification
    static async trackVerification(order, success) {
        return OrderMetrics.create({
            orderId: order._id,
            venueId: order.venueId,
            userId: order.userId,
            eventType: 'verification',
            orderType: 'drink',
            metadata: {
                success,
                verifiedBy: order.staffVerification?.staffId
            }
        });
    }

    // Track pass purchase
    static async trackPassPurchase(pass) {
        return {
            orderId: pass._id,
            venueId: pass.venueId,
            userId: pass.userId,
            eventType: 'creation',
            orderType: 'pass',
            processingTime: 0,
            revenue: {
                amount: pass.price,
                serviceFee: pass.serviceFee,
                total: pass.price + pass.serviceFee
            },
            metadata: {
                passType: pass.type
            }
        };
    }

    // Track pass redemption
    static async trackPassRedemption(pass, success) {
        const processingTime = pass.purchaseDate 
            ? Date.now() - new Date(pass.purchaseDate).getTime() 
            : 0;

        return OrderMetrics.create({
            orderId: pass._id,
            venueId: pass.venueId,
            userId: pass.userId,
            eventType: 'pass_redemption',
            orderType: 'pass',
            processingTime,
            metadata: {
                success,
                passType: pass.type,
                redeemedBy: pass.redemptionStatus?.redeemedBy
            }
        });
    }

    // Get venue metrics
    static async getVenueMetrics(venueId, { startDate, endDate }) {
        const metrics = await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    timestamp: {
                        $gte: new Date(startDate),
                        $lte: new Date(endDate)
                    }
                }
            },
            {
                $group: {
                    _id: {
                        eventType: '$eventType',
                        orderType: '$orderType'
                    },
                    count: { $sum: 1 },
                    revenue: {
                        $sum: {
                            $cond: [
                                { $in: ['$eventType', ['creation', 'pass_purchase']] },
                                { $ifNull: ['$revenue.total', 0] },
                                0
                            ]
                        }
                    },
                    tipAmount: {
                        $sum: {
                            $cond: [
                                { $eq: ['$eventType', 'creation'] },
                                { $ifNull: ['$revenue.tipAmount', 0] },
                                0
                            ]
                        }
                    },
                    serviceFees: {
                        $sum: { $ifNull: ['$revenue.serviceFee', 0] }
                    },
                    averageProcessingTime: {
                        $avg: '$processingTime'
                    }
                }
            }
        ]);

        return metrics.reduce((acc, metric) => {
            const key = `${metric._id.orderType}_${metric._id.eventType}`;
            acc[key] = {
                count: metric.count,
                revenue: metric.revenue,
                tipAmount: metric.tipAmount,
                serviceFees: metric.serviceFees,
                averageProcessingTime: metric.averageProcessingTime
            };
            return acc;
        }, {});
    }

    // Track pass tier metrics
    static async trackPassTierMetrics(orderId, passTier, amount) {
        const order = await Order.findById(orderId);
        if (!order) return;

        await OrderMetrics.create({
            orderId,
            venueId: order.venueId,
            eventType: 'creation',
            orderType: 'pass',
            processingTime: 0,
            revenue: {
                amount,
                currency: 'USD',
                total: amount
            },
            metadata: {
                passTier: {
                    name: passTier.name,
                    price: amount
                }
            }
        });
    }

    // Calculate peak hours
    static async calculatePeakHours(venueId, days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    timestamp: { $gte: startDate },
                    eventType: 'creation'
                }
            },
            {
                $group: {
                    _id: {
                        hour: { $hour: '$timestamp' },
                        dayOfWeek: { $dayOfWeek: '$timestamp' }
                    },
                    orderCount: { $sum: 1 },
                    totalRevenue: { $sum: '$revenue.total' },
                    avgProcessingTime: { $avg: '$processingTime' }
                }
            },
            {
                $group: {
                    _id: '$_id.hour',
                    byDayOfWeek: {
                        $push: {
                            day: '$_id.dayOfWeek',
                            orders: '$orderCount',
                            revenue: '$totalRevenue',
                            processingTime: '$avgProcessingTime'
                        }
                    },
                    totalOrders: { $sum: '$orderCount' },
                    totalRevenue: { $sum: '$totalRevenue' }
                }
            },
            {
                $project: {
                    hour: '$_id',
                    byDayOfWeek: 1,
                    totalOrders: 1,
                    totalRevenue: 1,
                    isPeak: {
                        $gte: ['$totalOrders', {
                            $multiply: [
                                { $avg: '$byDayOfWeek.orders' },
                                1.5 // 50% above average threshold for peak hours
                            ]
                        }]
                    }
                }
            },
            { $sort: { hour: 1 } }
        ]);
    }

    // Enhanced real-time metrics
    static async getRealTimeMetrics(venueId) {
        const now = new Date();
        const hourAgo = new Date(now - 60 * 60 * 1000);

        const [realtimeStats, currentSales, peakHours] = await Promise.all([
            // Existing realtime stats
            OrderMetrics.aggregate([
                {
                    $match: {
                        venueId: new mongoose.Types.ObjectId(venueId),
                        timestamp: { $gte: hourAgo }
                    }
                },
                {
                    $group: {
                        _id: '$eventType',
                        count: { $sum: 1 },
                        avgProcessingTime: { $avg: '$processingTime' }
                    }
                }
            ]),

            // Enhanced realtime sales metrics
            OrderMetrics.aggregate([
                {
                    $match: {
                        venueId: new mongoose.Types.ObjectId(venueId),
                        timestamp: { $gte: hourAgo }
                    }
                },
                {
                    $facet: {
                        drinks: [
                            { $match: { orderType: 'drink' } },
                            { $unwind: '$metadata.drinkTypes' },
                            {
                                $group: {
                                    _id: '$metadata.drinkTypes.category',
                                    count: { $sum: '$metadata.drinkTypes.count' },
                                    revenue: { $sum: '$metadata.drinkTypes.revenue' },
                                    serviceFees: { $sum: '$revenue.serviceFee' },
                                    tips: { $sum: '$revenue.tipAmount' }
                                }
                            }
                        ],
                        passes: [
                            { $match: { orderType: 'pass' } },
                            {
                                $group: {
                                    _id: '$metadata.passTier.name',
                                    count: { $sum: 1 },
                                    revenue: { $sum: '$metadata.passTier.price' },
                                    serviceFees: { $sum: '$revenue.serviceFee' }
                                }
                            }
                        ],
                        totalRevenue: [
                            {
                                $group: {
                                    _id: null,
                                    amount: { $sum: '$revenue.total' },
                                    serviceFees: { $sum: '$revenue.serviceFee' },
                                    tips: { $sum: '$revenue.tipAmount' }
                                }
                            }
                        ]
                    }
                }
            ]),

            // Get current hour peak status
            this.calculatePeakHours(venueId, 30)
        ]);

        const currentHour = new Date().getHours();
        const isPeakHour = peakHours.find(h => h.hour === currentHour)?.isPeak || false;

        return {
            currentHour: realtimeStats,
            sales: currentSales[0],
            isPeakHour,
            peakHourFactor: isPeakHour ? 1.5 : 1,
            timestamp: now
        };
    }

    // Add method to calculate averages
    static async calculateAverages(venueId, startDate, endDate) {
        return await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    avgOrderValue: { $avg: '$revenue.amount' },
                    avgTipPercentage: { $avg: '$metadata.tipPercentage' },
                    avgProcessingTime: { $avg: '$processingTime' }
                }
            }
        ]);
    }

    // Add method to get top performing items
    static async getTopItems(venueId, limit = 5) {
        return await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    orderType: 'drink'
                }
            },
            { $unwind: '$items' },
            {
                $group: {
                    _id: '$items.name',
                    totalQuantity: { $sum: '$items.quantity' },
                    totalRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
                    avgPrice: { $avg: '$items.price' }
                }
            },
            { $sort: { totalRevenue: -1 } },
            { $limit: limit }
        ]);
    }

    // Calendar data with enhanced metrics
    static async getCalendarData(venueId, month, year) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        return await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                        type: '$orderType'
                    },
                    sold: { $sum: 1 },
                    revenue: { $sum: '$revenue.amount' },
                    serviceFees: { $sum: '$revenue.serviceFee' },
                    tips: { $sum: '$revenue.tipAmount' }
                }
            },
            {
                $group: {
                    _id: '$_id.date',
                    metrics: {
                        $push: {
                            type: '$_id.type',
                            sold: '$sold',
                            revenue: '$revenue',
                            serviceFees: '$serviceFees',
                            tips: '$tips',
                            total: { $add: ['$revenue', '$serviceFees', '$tips'] }
                        }
                    }
                }
            }
        ]);
    }

    // Enhanced transaction data
    static async getTransactionData(venueId, startDate, endDate, options = {}) {
        const match = {
            venueId: new mongoose.Types.ObjectId(venueId),
            timestamp: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            }
        };

        if (options.orderType) {
            match.orderType = options.orderType;
        }

        return await OrderMetrics.aggregate([
            { $match: match },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $project: {
                    timestamp: 1,
                    customer: { $arrayElemAt: ['$user.email', 0] },
                    orderType: 1,
                    items: 1,
                    revenue: 1,
                    metadata: 1,
                    status: 1
                }
            },
            { $sort: { timestamp: -1 } }
        ]);
    }

    // Export utilities
    static async exportTransactions(venueId, startDate, endDate, format = 'excel') {
        const transactions = await this.getTransactionData(venueId, startDate, endDate);
        
        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Transactions');
            
            worksheet.columns = [
                { header: 'Date', key: 'date', width: 20 },
                { header: 'Type', key: 'type', width: 15 },
                { header: 'Items', key: 'items', width: 30 },
                { header: 'Subtotal', key: 'subtotal', width: 15 },
                { header: 'Service Fee', key: 'serviceFee', width: 15 },
                { header: 'Tip', key: 'tip', width: 15 },
                { header: 'Total', key: 'total', width: 15 }
            ];

            transactions.forEach(t => {
                worksheet.addRow({
                    date: new Date(t.timestamp).toLocaleString(),
                    type: t.orderType,
                    items: t.items.map(i => `${i.name} (${i.quantity})`).join(', '),
                    subtotal: t.revenue.amount,
                    serviceFee: t.revenue.serviceFee,
                    tip: t.revenue.tipAmount,
                    total: t.revenue.amount + t.revenue.serviceFee + t.revenue.tipAmount
                });
            });

            return workbook;
        }

        // Return raw data for other formats
        return transactions;
    }

    // Track payment failure
    static async trackPaymentFailure(venueId, error) {
        return {
            venueId,
            eventType: 'payment_failure',
            timestamp: new Date(),
            metadata: {
                errorType: error.type || 'unknown',
                errorMessage: error.message
            }
        };
    }
}

// Apply proxies to critical functions
OrderMetricsService.trackOrderCreation = metricProxy(
    OrderMetricsService.trackOrderCreation,
    FOMO_METRIC_TYPES.REVENUE.DRINK
);

OrderMetricsService.trackPassPurchase = metricProxy(
    OrderMetricsService.trackPassPurchase,
    FOMO_METRIC_TYPES.REVENUE.PASS
);

OrderMetricsService.trackPaymentFailure = metricProxy(
    OrderMetricsService.trackPaymentFailure,
    FOMO_METRIC_TYPES.OPERATIONS.PAYMENT_FAILURES
);

class MetricsCollector {
    constructor(config) {
        this.config = {
            errorThreshold: config.errorThreshold || 0.01,
            latencyThreshold: config.latencyThreshold || 2000,
            ...config
        };
        
        this.metrics = {
            operations: new Map(),
            batches: new Map(),
            errors: [],
            startTime: Date.now()
        };
    }

    startOperation(name) {
        if (!this.metrics.operations.has(name)) {
            this.metrics.operations.set(name, []);
        }
        
        const operation = {
            startTime: Date.now(),
            errors: [],
            completed: false
        };
        
        this.metrics.operations.get(name).push(operation);
        return operation;
    }

    endOperation(name, error = null) {
        const operations = this.metrics.operations.get(name);
        if (!operations || operations.length === 0) {
            throw new Error(`No operation "${name}" in progress`);
        }

        const operation = operations[operations.length - 1];
        operation.endTime = Date.now();
        operation.duration = operation.endTime - operation.startTime;
        operation.completed = true;
        
        if (error) {
            operation.error = error;
            this.metrics.errors.push({
                operation: name,
                error,
                timestamp: Date.now()
            });
        }

        // Check thresholds
        if (operation.duration > this.config.latencyThreshold) {
            console.warn(`Operation "${name}" exceeded latency threshold: ${operation.duration}ms`);
        }
    }

    startBatch(name) {
        const batch = {
            startTime: Date.now(),
            operations: [],
            errors: []
        };
        
        this.metrics.batches.set(name, batch);
        return batch;
    }

    endBatch(name) {
        const batch = this.metrics.batches.get(name);
        if (!batch) {
            throw new Error(`No batch "${name}" found`);
        }

        batch.endTime = Date.now();
        batch.duration = batch.endTime - batch.startTime;
        
        // Calculate batch metrics
        const operations = batch.operations;
        batch.metrics = {
            total: operations.length,
            successful: operations.filter(op => op.completed && !op.error).length,
            failed: operations.filter(op => op.error).length,
            avgLatencyMs: operations.reduce((sum, op) => sum + op.duration, 0) / operations.length,
            p95LatencyMs: this.calculateP95Latency(operations),
            errorRate: batch.errors.length / operations.length
        };

        // Check thresholds
        if (batch.metrics.errorRate > this.config.errorThreshold) {
            console.error(`Batch "${name}" exceeded error threshold: ${batch.metrics.errorRate}`);
        }
        if (batch.metrics.p95LatencyMs > this.config.latencyThreshold) {
            console.warn(`Batch "${name}" exceeded p95 latency threshold: ${batch.metrics.p95LatencyMs}ms`);
        }

        return batch.metrics;
    }

    getBatchMetrics(name) {
        const batch = this.metrics.batches.get(name);
        if (!batch) {
            throw new Error(`No batch "${name}" found`);
        }
        return batch.metrics;
    }

    calculateP95Latency(operations) {
        const durations = operations
            .filter(op => op.completed)
            .map(op => op.duration)
            .sort((a, b) => a - b);
        
        const index = Math.ceil(durations.length * 0.95) - 1;
        return durations[index] || 0;
    }

    async generateReport() {
        const endTime = Date.now();
        const totalDuration = endTime - this.metrics.startTime;

        const report = {
            duration: totalDuration,
            operations: {},
            batches: {},
            errors: this.metrics.errors,
            summary: {
                totalOperations: 0,
                totalErrors: this.metrics.errors.length,
                avgLatencyMs: 0
            }
        };

        // Compile operation metrics
        for (const [name, operations] of this.metrics.operations) {
            report.operations[name] = {
                total: operations.length,
                successful: operations.filter(op => op.completed && !op.error).length,
                failed: operations.filter(op => op.error).length,
                avgLatencyMs: operations.reduce((sum, op) => sum + op.duration, 0) / operations.length,
                p95LatencyMs: this.calculateP95Latency(operations)
            };
            report.summary.totalOperations += operations.length;
        }

        // Compile batch metrics
        for (const [name, batch] of this.metrics.batches) {
            report.batches[name] = batch.metrics;
        }

        // Calculate overall metrics
        const allOperations = Array.from(this.metrics.operations.values()).flat();
        report.summary.avgLatencyMs = allOperations.reduce((sum, op) => sum + op.duration, 0) / allOperations.length;

        // Log report
        console.log('\nTest Performance Report:');
        console.log('=======================');
        console.log(`Duration: ${totalDuration}ms`);
        console.log(`Total Operations: ${report.summary.totalOperations}`);
        console.log(`Total Errors: ${report.summary.totalErrors}`);
        console.log(`Average Latency: ${report.summary.avgLatencyMs}ms`);
        console.log('\nOperation Metrics:');
        console.table(report.operations);
        console.log('\nBatch Metrics:');
        console.table(report.batches);
        
        if (report.summary.totalErrors > 0) {
            console.log('\nErrors:');
            console.table(report.errors);
        }

        return report;
    }
}

function createMetricsCollector(config = {}) {
    return new MetricsCollector(config);
}

module.exports = {
    createMetricsCollector,
    OrderMetricsService
}; 