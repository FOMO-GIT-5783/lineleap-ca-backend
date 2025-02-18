const logger = require('./logger.cjs');
const metrics = require('./monitoring.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

/**
 * Creates a lightweight service wrapper that adds metrics and error handling.
 * Integrates with existing monitoring and logging systems.
 * 
 * @param {string} name - Service name for metrics and logging
 * @param {Object} options - Configuration options
 * @returns {Object} Wrapped service with execute method
 */
const createService = (name, options = {}) => {
    // Create specialized logger for this service
    const serviceLogger = logger.child({
        service: name,
        context: 'service-wrapper'
    });

    // Track service state
    const serviceState = {
        startTime: Date.now(),
        operations: new Map(),
        lastReset: Date.now()
    };

    // Service wrapper
    return {
        name,
        
        /**
         * Executes an operation with metrics and error handling
         * @param {Function} operation - Async operation to execute
         * @param {Object} context - Additional context for metrics/logging
         */
        async execute(operation, context = {}) {
            const start = Date.now();
            const operationId = context.operationId || `${name}_${Date.now()}`;
            const operationType = context.type || 'default';

            try {
                // Record attempt
                metrics.increment(`service.${name}.attempts`);
                metrics.increment(`service.${name}.${operationType}.attempts`);
                
                // Track operation start
                if (!serviceState.operations.has(operationType)) {
                    serviceState.operations.set(operationType, {
                        attempts: 0,
                        success: 0,
                        failures: 0,
                        latencies: []
                    });
                }
                serviceState.operations.get(operationType).attempts++;
                
                // Execute operation
                const result = await operation();
                
                // Record success metrics
                const duration = Date.now() - start;
                metrics.timing(`service.${name}.duration`, duration);
                metrics.timing(`service.${name}.${operationType}.duration`, duration);
                metrics.increment(`service.${name}.success`);
                metrics.increment(`service.${name}.${operationType}.success`);

                // Update operation stats
                const opStats = serviceState.operations.get(operationType);
                opStats.success++;
                opStats.latencies.push(duration);
                if (opStats.latencies.length > 100) opStats.latencies.shift();

                // Log success if significant duration
                if (duration > (options.slowThreshold || 1000)) {
                    serviceLogger.warn('Slow operation detected', {
                        operationId,
                        operationType,
                        duration,
                        ...context
                    });
                    metrics.increment(`service.${name}.slow_operations`);
                }

                return result;

            } catch (error) {
                // Record error metrics
                metrics.increment(`service.${name}.errors`);
                metrics.increment(`service.${name}.${operationType}.errors`);
                metrics.increment(`service.${name}.error.${error.code || 'unknown'}`);

                // Update operation stats
                const opStats = serviceState.operations.get(operationType);
                opStats.failures++;

                // Enhanced error logging
                serviceLogger.error('Operation failed', {
                    operationId,
                    operationType,
                    duration: Date.now() - start,
                    error: error.message,
                    code: error.code,
                    stack: error.stack,
                    ...context
                });

                // Ensure error has proper format
                if (!error.code) {
                    throw createError.service(
                        ERROR_CODES.SERVICE_ERROR,
                        error.message,
                        { originalError: error }
                    );
                }

                throw error;
            }
        },

        /**
         * Executes an operation with retry logic
         * @param {Function} operation - Async operation to execute
         * @param {Object} retryOptions - Retry configuration
         */
        async executeWithRetry(operation, retryOptions = {}) {
            const {
                maxAttempts = 3,
                delay = 1000,
                backoff = 2,
                shouldRetry = (error) => true
            } = retryOptions;

            let lastError;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await this.execute(operation, { attempt });
                } catch (error) {
                    lastError = error;
                    metrics.increment(`service.${name}.retry.attempts`);
                    
                    if (attempt === maxAttempts || !shouldRetry(error)) {
                        metrics.increment(`service.${name}.retry.exhausted`);
                        throw error;
                    }

                    // Log retry attempt
                    serviceLogger.warn(`Retry attempt ${attempt}`, {
                        error: error.message,
                        nextAttemptIn: delay * Math.pow(backoff, attempt - 1)
                    });

                    await new Promise(resolve => 
                        setTimeout(resolve, delay * Math.pow(backoff, attempt - 1))
                    );
                }
            }
            throw lastError;
        },

        /**
         * Gets service metrics
         */
        getMetrics() {
            // Basic metrics
            const basicMetrics = {
                uptime: Date.now() - serviceState.startTime,
                attempts: metrics.getMetric(`service.${name}.attempts`) || 0,
                success: metrics.getMetric(`service.${name}.success`) || 0,
                errors: metrics.getMetric(`service.${name}.errors`) || 0,
                avgDuration: metrics.getMetric(`service.${name}.duration`)?.avg || 0
            };

            // Operation-specific metrics
            const operationMetrics = {};
            for (const [type, stats] of serviceState.operations.entries()) {
                operationMetrics[type] = {
                    attempts: stats.attempts,
                    success: stats.success,
                    failures: stats.failures,
                    successRate: stats.attempts > 0 ? (stats.success / stats.attempts) * 100 : 0,
                    avgLatency: stats.latencies.length > 0 
                        ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length 
                        : 0,
                    p95Latency: stats.latencies.length > 0
                        ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
                        : 0
                };
            }

            return {
                ...basicMetrics,
                operations: operationMetrics,
                lastReset: serviceState.lastReset
            };
        },

        /**
         * Reset service metrics
         */
        resetMetrics() {
            serviceState.operations.clear();
            serviceState.lastReset = Date.now();
            serviceLogger.info('Service metrics reset');
        }
    };
};

module.exports = createService; 