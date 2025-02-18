const logger = require('./logger.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');
const BaseService = require('./baseService.cjs');
const EVENT_TYPES = require('./eventTypes.cjs');

// Circuit breaker states
const BREAKER_STATES = {
    CLOSED: 'closed',
    OPEN: 'open',
    HALF_OPEN: 'half_open'
};

// Maintain singleton for backward compatibility
let instance = null;

class VenueAwareBreaker extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('circuit-breaker', {}, config);

        this.service = config.service;
        this.venueId = config.venueId;
        this.failureThreshold = config.failureThreshold || 5;
        this.resetTimeout = config.resetTimeout || 30000;
        this.halfOpenSuccessThreshold = config.halfOpenSuccessThreshold || 3;

        this.state = BREAKER_STATES.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastError = null;

        this.logger = logger.child({
            service: this.service,
            venueId: this.venueId,
            component: 'circuit-breaker'
        });

        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            openCircuits: 0,
            lastOpenTime: null,
            averageResponseTime: 0
        };

        instance = this;
    }

    /**
     * Factory method for service container
     */
    static async create(config = {}) {
        // Return existing instance if available
        if (instance) {
            return instance;
        }

        const service = new VenueAwareBreaker(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        const events = this.getDependency('events');

        // Set up event listeners
        events.safeOn(EVENT_TYPES.OPTIMIZATION.THRESHOLD_REACHED, this.handleThresholdReached.bind(this));

        logger.info('Circuit breaker initialized');
    }

    async execute(fn) {
        this.metrics.totalCalls++;
        const startTime = Date.now();

        try {
            if (this.isOpen()) {
                if (this.shouldAttemptReset()) {
                    this.transitionToHalfOpen();
                } else {
                    throw createError.service(
                        ERROR_CODES.CIRCUIT_BREAKER_OPEN,
                        `Circuit breaker is open for ${this.service}`
                    );
                }
            }

            const result = await fn();
            this.handleSuccess();
            
            // Update metrics
            this.metrics.successfulCalls++;
            this.updateResponseTime(Date.now() - startTime);
            
            return result;
        } catch (error) {
            this.handleFailure(error);
            
            // Update metrics
            this.metrics.failedCalls++;
            this.updateResponseTime(Date.now() - startTime);
            
            throw error;
        }
    }

    isOpen() {
        return this.state === BREAKER_STATES.OPEN;
    }

    shouldAttemptReset() {
        if (!this.lastFailureTime) return false;
        return Date.now() - this.lastFailureTime >= this.resetTimeout;
    }

    transitionToHalfOpen() {
        this.state = BREAKER_STATES.HALF_OPEN;
        this.successes = 0;
        
        this.logger.info('Circuit breaker transitioning to half-open state', {
            failures: this.failures,
            lastError: this.lastError?.message
        });
    }

    handleSuccess() {
        if (this.state === BREAKER_STATES.HALF_OPEN) {
            this.successes++;
            if (this.successes >= this.halfOpenSuccessThreshold) {
                this.reset();
            }
        } else if (this.state === BREAKER_STATES.CLOSED) {
            this.failures = 0;
            this.lastError = null;
        }
    }

    handleFailure(error) {
        this.lastFailureTime = Date.now();
        this.lastError = error;
        this.failures++;

        if (this.state === BREAKER_STATES.HALF_OPEN || 
            (this.state === BREAKER_STATES.CLOSED && this.failures >= this.failureThreshold)) {
            this.trip();
        }

        this.logger.error('Circuit breaker recorded failure', {
            state: this.state,
            failures: this.failures,
            error: error.message
        });
    }

    trip() {
        this.state = BREAKER_STATES.OPEN;
        this.metrics.openCircuits++;
        this.metrics.lastOpenTime = Date.now();
        
        this.logger.warn('Circuit breaker tripped', {
            failures: this.failures,
            lastError: this.lastError?.message,
            resetTimeout: this.resetTimeout
        });
    }

    reset() {
        this.state = BREAKER_STATES.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastError = null;
        
        this.logger.info('Circuit breaker reset', {
            metrics: this.getMetrics()
        });
    }

    getState() {
        return {
            service: this.service,
            venueId: this.venueId,
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            lastError: this.lastError?.message,
            metrics: this.getMetrics()
        };
    }

    getMetrics() {
        return {
            ...this.metrics,
            currentState: this.state,
            failureRate: this.metrics.totalCalls > 0 
                ? (this.metrics.failedCalls / this.metrics.totalCalls) * 100 
                : 0
        };
    }

    updateResponseTime(duration) {
        const totalCalls = this.metrics.successfulCalls + this.metrics.failedCalls;
        if (totalCalls === 1) {
            this.metrics.averageResponseTime = duration;
        } else {
            this.metrics.averageResponseTime = (
                (this.metrics.averageResponseTime * (totalCalls - 1)) + duration
            ) / totalCalls;
        }
    }

    handleThresholdReached({ venueId, level }) {
        if (level === 'critical' && venueId === this.venueId) {
            this.failureThreshold = Math.max(2, this.failureThreshold - 1);
            this.resetTimeout = Math.min(60000, this.resetTimeout * 1.5);
        }
    }

    /**
     * Cleanup resources
     */
    async _cleanup() {
        this.state = BREAKER_STATES.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.lastFailureTime = null;
        this.lastError = null;

        logger.info('Circuit breaker cleaned up');
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.state === 'ready';
    }

    /**
     * Get service health
     */
    getHealth() {
        return {
            ...super.getHealth(),
            breakerState: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            lastError: this.lastError?.message,
            metrics: this.getMetrics()
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new VenueAwareBreaker();
// Also export the class for service container
module.exports.VenueAwareBreaker = VenueAwareBreaker;
// Export states for external use
module.exports.BREAKER_STATES = BREAKER_STATES; 