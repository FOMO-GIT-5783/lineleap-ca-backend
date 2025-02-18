const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const EVENT_TYPES = require('../../utils/eventTypes.cjs');

class PaymentEventEmitter extends BaseService {
    constructor() {
        super('payment-event-emitter');
        this.logger = logger.child({ service: 'payment-event-emitter' });
    }

    async _init() {
        const events = this.getDependency('events');
        if (!events) {
            throw new Error('Events system not available');
        }

        this.logger.info('Payment event emitter initialized');
    }

    async emitPaymentCreated(data) {
        const events = this.getDependency('events');
        const metrics = this.getDependency('metrics');

        try {
            // Emit event
            events.emitPaymentEvent('INITIATED', {
                ...data,
                timestamp: Date.now()
            });

            // Record metrics
            await metrics?.recordPaymentMetric(data.venueId, 'initiated', {
                amount: data.amount,
                type: data.type
            });

            this.logger.info('Payment created event emitted', {
                venueId: data.venueId,
                type: data.type,
                amount: data.amount
            });

        } catch (error) {
            this.logger.error('Failed to emit payment created event:', {
                error: error.message,
                data
            });
        }
    }

    async emitPaymentCompleted(data) {
        const events = this.getDependency('events');
        const metrics = this.getDependency('metrics');

        try {
            // Emit event
            events.emitPaymentEvent('COMPLETED', {
                ...data,
                timestamp: Date.now()
            });

            // Record metrics
            await metrics?.recordPaymentMetric(data.venueId, 'completed', {
                amount: data.amount,
                type: data.type,
                duration: Date.now() - data.startTime
            });

            this.logger.info('Payment completed event emitted', {
                venueId: data.venueId,
                type: data.type,
                amount: data.amount,
                duration: Date.now() - data.startTime
            });

        } catch (error) {
            this.logger.error('Failed to emit payment completed event:', {
                error: error.message,
                data
            });
        }
    }

    async emitPaymentFailed(data) {
        const events = this.getDependency('events');
        const metrics = this.getDependency('metrics');

        try {
            // Emit event
            events.emitPaymentEvent('FAILED', {
                ...data,
                timestamp: Date.now()
            });

            // Record metrics
            await metrics?.recordPaymentMetric(data.venueId, 'failed', {
                amount: data.amount,
                type: data.type,
                error: data.error,
                duration: Date.now() - data.startTime
            });

            this.logger.error('Payment failed event emitted', {
                venueId: data.venueId,
                type: data.type,
                amount: data.amount,
                error: data.error,
                duration: Date.now() - data.startTime
            });

            // Check for alert conditions
            if (await this.shouldAlert(data)) {
                await this.emitPaymentAlert(data);
            }

        } catch (error) {
            this.logger.error('Failed to emit payment failed event:', {
                error: error.message,
                data
            });
        }
    }

    async shouldAlert(data) {
        const metrics = this.getDependency('metrics');
        if (!metrics) return false;

        try {
            const venueMetrics = await metrics.getMetrics(data.venueId);
            const failureRate = venueMetrics.payment.error_rate || 0;

            // Alert if:
            // 1. High failure rate (>10%)
            // 2. Multiple failures in short time
            // 3. High value transaction failure
            return (
                failureRate > 10 ||
                venueMetrics.payment.recent_failures > 3 ||
                data.amount > 10000 // $100
            );

        } catch (error) {
            this.logger.error('Failed to check alert conditions:', {
                error: error.message,
                data
            });
            return false;
        }
    }

    async emitPaymentAlert(data) {
        const events = this.getDependency('events');

        try {
            events.emitPaymentEvent('ALERT', {
                venueId: data.venueId,
                type: 'payment_failure',
                severity: this.getAlertSeverity(data),
                data: {
                    failureCount: data.failureCount,
                    amount: data.amount,
                    error: data.error
                },
                timestamp: Date.now()
            });

            this.logger.warn('Payment alert emitted', {
                venueId: data.venueId,
                severity: this.getAlertSeverity(data),
                data
            });

        } catch (error) {
            this.logger.error('Failed to emit payment alert:', {
                error: error.message,
                data
            });
        }
    }

    getAlertSeverity(data) {
        if (data.amount > 10000) return 'high';
        if (data.failureCount > 5) return 'high';
        if (data.failureCount > 3) return 'medium';
        return 'low';
    }

    async _cleanup() {
        this.logger.info('Payment event emitter cleaned up');
    }
}

module.exports = new PaymentEventEmitter(); 