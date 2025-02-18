const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');

class PaymentMetrics extends BaseService {
    constructor() {
        super('payment-metrics');
        this.metrics = {
            success: 0,
            failed: 0,
            total: 0,
            latency: [],
            errors: new Map()
        };
        this.logger = logger.child({
            context: 'payment',
            service: 'payment-metrics'
        });
    }

    async _init() {
        // Start metrics aggregation
        this.aggregationInterval = setInterval(() => {
            this.aggregateMetrics();
        }, 5 * 60 * 1000); // Every 5 minutes

        this.logger.info('Payment metrics service initialized', {
            config: {
                retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
                aggregationInterval: 5 * 60 * 1000 // 5 minutes
            }
        });
    }

    recordSuccess(data) {
        this.metrics.success++;
        this.metrics.total++;
        this.metrics.latency.push(data.duration);
        this.logger.debug('Payment success recorded', data);
    }

    recordFailure(data, error) {
        this.metrics.failed++;
        this.metrics.total++;
        
        // Track error types
        const errorType = error.code || error.type || 'unknown';
        const currentCount = this.metrics.errors.get(errorType) || 0;
        this.metrics.errors.set(errorType, currentCount + 1);

        this.logger.debug('Payment failure recorded', {
            ...data,
            error: error.message,
            type: errorType
        });
    }

    aggregateMetrics() {
        const now = Date.now();
        
        // Calculate average latency
        const avgLatency = this.metrics.latency.length > 0
            ? this.metrics.latency.reduce((a, b) => a + b, 0) / this.metrics.latency.length
            : 0;

        // Calculate error rate
        const errorRate = this.metrics.total > 0
            ? (this.metrics.failed / this.metrics.total) * 100
            : 0;

        // Calculate success rate
        const successRate = this.metrics.total > 0
            ? (this.metrics.success / this.metrics.total) * 100
            : 100;

        const aggregated = {
            timestamp: new Date().toISOString(),
            total: this.metrics.total,
            success: this.metrics.success,
            failed: this.metrics.failed,
            successRate,
            errorRate,
            avgLatency,
            errors: Object.fromEntries(this.metrics.errors)
        };

        this.logger.info('Metrics aggregated', aggregated);

        // Reset metrics for next period
        this.metrics = {
            success: 0,
            failed: 0,
            total: 0,
            latency: [],
            errors: new Map()
        };

        return aggregated;
    }

    async getMetrics(venueId = null) {
        const metrics = this.aggregateMetrics();
        
        if (venueId) {
            // Filter metrics for specific venue if needed
            return {
                ...metrics,
                venueId
            };
        }

        return metrics;
    }

    async _cleanup() {
        if (this.aggregationInterval) {
            clearInterval(this.aggregationInterval);
        }
        this.metrics = {
            success: 0,
            failed: 0,
            total: 0,
            latency: [],
            errors: new Map()
        };
        this.logger.info('Payment metrics service cleaned up');
    }

    getHealth() {
        return {
            status: 'healthy',
            metrics: {
                total: this.metrics.total,
                success: this.metrics.success,
                failed: this.metrics.failed,
                errorTypes: this.metrics.errors.size
            }
        };
    }
}

module.exports = new PaymentMetrics(); 