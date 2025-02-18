const BaseService = require('../utils/baseService.cjs');
const logger = require('../utils/logger.cjs');
const featureManager = require('./FeatureManager.cjs');

class PaymentMetrics extends BaseService {
    constructor(config = {}) {
        super('payment-metrics');
        this.metrics = new Map();
        this.config = {
            retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
            aggregationInterval: 5 * 60 * 1000, // 5 minutes
            ...config
        };
        this.aggregationTimer = null;
        // Create specialized logger for payment metrics
        this.logger = logger.child({
            context: 'payment-metrics',
            service: 'payment-metrics'
        });
    }

    async _init() {
        const events = this.getDependency('events');
        if (events) {
            events.safeOn('payment.completed', this.handlePaymentSuccess.bind(this));
            events.safeOn('payment.failed', this.handlePaymentFailure.bind(this));
        }

        // Start aggregation timer
        this.aggregationTimer = setInterval(() => {
            this.aggregateMetrics();
        }, this.config.aggregationInterval);

        this.logger.info('Payment metrics service initialized', {
            config: {
                retentionPeriod: this.config.retentionPeriod,
                aggregationInterval: this.config.aggregationInterval
            }
        });
    }

    async recordSuccess(paymentData) {
        const useNewMetrics = await featureManager.isEnabled('USE_NEW_METRICS');
        
        try {
            if (useNewMetrics) {
                return await this.recordSuccessNew(paymentData);
            } else {
                return await this.recordSuccessLegacy(paymentData);
            }
        } catch (error) {
            this.logger.error('Failed to record success metric', {
                error: error.message,
                stack: error.stack,
                paymentData
            });
        }
    }

    async recordSuccessNew(paymentData) {
        const key = this.getMetricKey(paymentData);
        const current = this.metrics.get(key) || this.createDefaultMetrics();

        current.success++;
        current.volume += paymentData.amount;
        current.lastSuccess = Date.now();
        current.successLatencies.push(Date.now() - paymentData.startTime);

        // Keep only last 100 latencies
        if (current.successLatencies.length > 100) {
            current.successLatencies.shift();
        }

        this.metrics.set(key, current);

        this.logger.info('Payment success recorded', {
            venueId: paymentData.venueId,
            amount: paymentData.amount,
            latency: Date.now() - paymentData.startTime
        });

        // Emit metrics if available
        const events = this.getDependency('events');
        if (events) {
            events.emitPaymentEvent('METRICS_UPDATED', {
                type: 'success',
                metrics: this.getMetrics(key)
            });
        }
    }

    async recordSuccessLegacy(paymentData) {
        const key = this.getMetricKey(paymentData);
        const current = this.metrics.get(key) || this.createDefaultMetrics();

        current.success++;
        current.volume += paymentData.amount;
        
        this.metrics.set(key, current);
    }

    async recordFailure(paymentData, error) {
        const useNewMetrics = await featureManager.isEnabled('USE_NEW_METRICS');
        
        try {
            if (useNewMetrics) {
                return await this.recordFailureNew(paymentData, error);
            } else {
                return await this.recordFailureLegacy(paymentData, error);
            }
        } catch (error) {
            this.logger.error('Failed to record failure metric', {
                error: error.message,
                stack: error.stack,
                paymentData
            });
        }
    }

    async recordFailureNew(paymentData, error) {
        const key = this.getMetricKey(paymentData);
        const current = this.metrics.get(key) || this.createDefaultMetrics();

        current.failures++;
        current.lastFailure = Date.now();
        current.failureLatencies.push(Date.now() - paymentData.startTime);
        current.errors.push({
            time: Date.now(),
            error: error.message,
            code: error.code
        });

        // Keep only last 100 latencies and errors
        if (current.failureLatencies.length > 100) {
            current.failureLatencies.shift();
        }
        if (current.errors.length > 100) {
            current.errors.shift();
        }

        this.metrics.set(key, current);

        this.logger.warn('Payment failure recorded', {
            venueId: paymentData.venueId,
            error: error.message,
            code: error.code,
            latency: Date.now() - paymentData.startTime
        });

        // Check for alert conditions
        this.checkAlertConditions(key, current);

        // Emit metrics if available
        const events = this.getDependency('events');
        if (events) {
            events.emitPaymentEvent('METRICS_UPDATED', {
                type: 'failure',
                metrics: this.getMetrics(key)
            });
        }
    }

    async recordFailureLegacy(paymentData, error) {
        const key = this.getMetricKey(paymentData);
        const current = this.metrics.get(key) || this.createDefaultMetrics();

        current.failures++;
        current.errors.push({
            time: Date.now(),
            error: error.message
        });

        this.metrics.set(key, current);
    }

    createDefaultMetrics() {
        return {
            success: 0,
            failures: 0,
            volume: 0,
            successLatencies: [],
            failureLatencies: [],
            errors: [],
            startTime: Date.now()
        };
    }

    getMetricKey(paymentData) {
        return `${paymentData.venueId}:${paymentData.type}`;
    }

    async getMetrics(timeRange = {}) {
        const metrics = {};
        
        for (const [key, data] of this.metrics.entries()) {
            // Filter by time range if specified
            if (timeRange.start && data.startTime < timeRange.start) continue;
            if (timeRange.end && data.lastSuccess > timeRange.end) continue;

            const [venueId, type] = key.split(':');
            
            if (!metrics[venueId]) {
                metrics[venueId] = {};
            }

            metrics[venueId][type] = {
                success: data.success,
                failures: data.failures,
                volume: data.volume,
                successRate: data.success / (data.success + data.failures) * 100,
                averageLatency: this.calculateAverageLatency(data.successLatencies),
                errorRate: data.failures / (data.success + data.failures) * 100,
                recentErrors: data.errors.slice(-5)
            };
        }

        return metrics;
    }

    calculateAverageLatency(latencies) {
        if (!latencies.length) return 0;
        return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    }

    checkAlertConditions(key, metrics) {
        const errorRate = metrics.failures / (metrics.success + metrics.failures) * 100;
        
        if (errorRate > 10) {
            this.logger.error('High payment failure rate detected', {
                key,
                errorRate,
                recentErrors: metrics.errors.slice(-5),
                timeWindow: this.config.aggregationInterval
            });
        }

        const averageLatency = this.calculateAverageLatency(metrics.successLatencies);
        if (averageLatency > 5000) { // 5 seconds
            this.logger.warn('High payment latency detected', {
                key,
                averageLatency,
                sampleSize: metrics.successLatencies.length,
                threshold: 5000
            });
        }
    }

    aggregateMetrics() {
        const now = Date.now();
        let removedKeys = 0;
        
        // Remove old metrics
        for (const [key, data] of this.metrics.entries()) {
            if (data.startTime < now - this.config.retentionPeriod) {
                this.metrics.delete(key);
                removedKeys++;
            }
        }

        if (removedKeys > 0) {
            this.logger.info('Metrics aggregation completed', {
                removedKeys,
                remainingKeys: this.metrics.size,
                retentionPeriod: this.config.retentionPeriod
            });
        }
    }

    async handlePaymentSuccess(data) {
        await this.recordSuccess(data);
    }

    async handlePaymentFailure(data) {
        await this.recordFailure(data.paymentData, data.error);
    }

    async _cleanup() {
        if (this.aggregationTimer) {
            clearInterval(this.aggregationTimer);
        }
        this.metrics.clear();
        this.logger.info('Payment metrics service cleaned up');
    }
}

module.exports = new PaymentMetrics();
module.exports.PaymentMetrics = PaymentMetrics; 