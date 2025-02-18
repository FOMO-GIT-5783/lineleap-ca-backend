const mongoose = require('mongoose');
const { Order } = require('../../models/Order.cjs');
const { Pass } = require('../../models/Pass.cjs');
const { OrderMetrics } = require('../../models/OrderMetrics.cjs');

class AnalyticsAggregator {
    static async getVenueOverview(venueId, startDate, endDate) {
        const [orderMetrics, passMetrics] = await Promise.all([
            this.getOrderMetrics(venueId, startDate, endDate),
            this.getPassMetrics(venueId, startDate, endDate)
        ]);

        return {
            orders: orderMetrics,
            passes: passMetrics,
            totalRevenue: orderMetrics.totalRevenue + passMetrics.totalRevenue
        };
    }

    static async getOrderMetrics(venueId, startDate, endDate) {
        const metrics = await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    eventType: 'order_creation',
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: '$revenue.total' },
                    avgOrderValue: { $avg: '$revenue.total' },
                    totalTips: { $sum: '$revenue.tipAmount' }
                }
            }
        ]);

        return metrics[0] || {
            totalOrders: 0,
            totalRevenue: 0,
            avgOrderValue: 0,
            totalTips: 0
        };
    }

    static async getPassMetrics(venueId, startDate, endDate) {
        const metrics = await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    eventType: 'pass_purchase',
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPasses: { $sum: 1 },
                    totalRevenue: { $sum: '$revenue.total' },
                    avgPassValue: { $avg: '$revenue.total' }
                }
            }
        ]);

        return metrics[0] || {
            totalPasses: 0,
            totalRevenue: 0,
            avgPassValue: 0
        };
    }

    static async getHourlyMetrics(venueId, date) {
        const metrics = await OrderMetrics.aggregate([
            {
                $match: {
                    venueId: new mongoose.Types.ObjectId(venueId),
                    timestamp: {
                        $gte: new Date(date.setHours(0, 0, 0)),
                        $lt: new Date(date.setHours(23, 59, 59))
                    }
                }
            },
            {
                $group: {
                    _id: { $hour: '$timestamp' },
                    orders: {
                        $sum: {
                            $cond: [
                                { $eq: ['$eventType', 'order_creation'] },
                                1,
                                0
                            ]
                        }
                    },
                    passes: {
                        $sum: {
                            $cond: [
                                { $eq: ['$eventType', 'pass_purchase'] },
                                1,
                                0
                            ]
                        }
                    },
                    revenue: { $sum: '$revenue.total' }
                }
            },
            {
                $sort: { '_id': 1 }
            }
        ]);

        // Fill in missing hours with zeros
        const hourlyData = new Array(24).fill(null).map((_, hour) => {
            const hourMetrics = metrics.find(m => m._id === hour);
            return hourMetrics || {
                _id: hour,
                orders: 0,
                passes: 0,
                revenue: 0
            };
        });

        return hourlyData;
    }
}

module.exports = AnalyticsAggregator; 