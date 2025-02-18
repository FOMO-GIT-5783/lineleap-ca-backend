const logger = require('./logger.cjs');
const { createError, ERROR_CODES } = require('./errors.cjs');

/**
 * Service initialization states
 */
const SERVICE_STATES = {
    UNINITIALIZED: 'uninitialized',
    INITIALIZING: 'initializing',
    READY: 'ready',
    FAILED: 'failed',
    SHUTDOWN: 'shutdown'
};

class BaseService {
    constructor(name) {
        if (!name) {
            throw new Error('Service name is required');
        }

        this.name = name;
        this.dependencies = new Map();
        this.state = SERVICE_STATES.UNINITIALIZED;
        this.ready = false;
        this.logger = logger.child({ service: name });
    }

    /**
     * Initialize the service
     */
    async initialize(config = {}) {
        try {
            if (this.state === SERVICE_STATES.READY) {
                this.logger.warn('Service already initialized');
                return;
            }

            this.state = SERVICE_STATES.INITIALIZING;

            // Initialize dependencies
            if (config.dependencies) {
                this._validateAndSetDependencies(config.dependencies);
            }

            // Initialize this service
            await this._init();
            
            this.state = SERVICE_STATES.READY;
            this.ready = true;

            this.logger.info('Service initialized successfully');

        } catch (error) {
            this.state = SERVICE_STATES.FAILED;
            this.ready = false;
            
            this.logger.error('Service initialization failed:', {
                error: error.message,
                stack: error.stack
            });
            
            throw createError.service(
                ERROR_CODES.SERVICE_INIT_FAILED,
                `${this.name} initialization failed: ${error.message}`
            );
        }
    }

    /**
     * Internal initialization - must be implemented by services
     */
    async _init() {
        throw new Error(`_init() must be implemented by service ${this.name}`);
    }

    /**
     * Cleanup service resources
     */
    async cleanup() {
        if (this.state === SERVICE_STATES.SHUTDOWN) {
            return;
        }

        try {
            await this._cleanup();
            this.state = SERVICE_STATES.SHUTDOWN;
            this.ready = false;
            this.dependencies.clear();
            this.logger.info('Service cleaned up successfully');
        } catch (error) {
            this.logger.error('Service cleanup failed:', {
                error: error.message,
                stack: error.stack
            });
            throw createError.service(
                ERROR_CODES.SERVICE_CLEANUP_FAILED,
                `${this.name} cleanup failed: ${error.message}`
            );
        }
    }

    /**
     * Internal cleanup - can be implemented by services
     */
    async _cleanup() {
        // Default no-op cleanup
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.ready;
    }

    /**
     * Get service health status
     */
    getHealth() {
        return {
            name: this.name,
            state: this.state,
            dependencies: Array.from(this.dependencies.keys()),
            ready: this.ready
        };
    }

    /**
     * Validate and set dependencies
     */
    _validateAndSetDependencies(dependencies) {
        if (!dependencies || typeof dependencies !== 'object') {
            throw new Error('Dependencies must be an object');
        }

        for (const [name, service] of Object.entries(dependencies)) {
            if (!service) {
                this.logger.warn(`Dependency ${name} not found for service ${this.name}`);
                continue;
            }
            this.dependencies.set(name, service);
        }
    }

    /**
     * Get a dependency
     */
    getDependency(name) {
        return this.dependencies.get(name);
    }

    /**
     * Set a dependency
     */
    setDependency(name, service) {
        if (!service) {
            throw new Error(`Invalid dependency ${name}`);
        }
        this.dependencies.set(name, service);
    }

    getConfig(key, defaultValue = null) {
        return key in this.config ? this.config[key] : defaultValue;
    }

    setConfig(key, value) {
        this.config[key] = value;
        this.logger.debug(`Config ${key} updated`, { value });
    }

    updateConfig(updates) {
        Object.assign(this.config, updates);
        this.logger.debug('Config updated', { updates });
    }

    validateDependencies(required = []) {
        const missing = required.filter(dep => !this.getDependency(dep));
        if (missing.length > 0) {
            throw createError.service(
                ERROR_CODES.MISSING_DEPENDENCIES,
                `Missing required dependencies: ${missing.join(', ')}`
            );
        }
    }

    async healthCheck() {
        return {
            service: this.name,
            status: this.isReady() ? 'healthy' : 'unhealthy',
            dependencies: Object.keys(this.dependencies).reduce((acc, dep) => {
                const dependency = this.getDependency(dep);
                acc[dep] = {
                    status: dependency && typeof dependency.isReady === 'function' 
                        ? dependency.isReady() ? 'healthy' : 'unhealthy'
                        : 'unknown'
                };
                return acc;
            }, {}),
            config: this.config,
            uptime: process.uptime()
        };
    }

    async validateConfig(schema) {
        const { error } = schema.validate(this.config);
        if (error) {
            throw createError.validation(
                ERROR_CODES.INVALID_CONFIG,
                `Invalid config for ${this.name}: ${error.message}`
            );
        }
    }

    logMetric(name, value, tags = {}) {
        const events = this.getDependency('events');
        if (events) {
            events.emit('metrics', {
                service: this.name,
                name,
                value,
                tags,
                timestamp: new Date()
            });
        }
    }

    async retry(fn, options = {}) {
        const {
            attempts = 3,
            delay = 1000,
            backoff = 2,
            shouldRetry = () => true
        } = options;

        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (attempt === attempts || !shouldRetry(error)) {
                    throw error;
                }
                this.logger.warn(`Retry attempt ${attempt} failed`, {
                    error: error.message,
                    nextAttemptIn: delay * Math.pow(backoff, attempt - 1)
                });
                await new Promise(resolve => 
                    setTimeout(resolve, delay * Math.pow(backoff, attempt - 1))
                );
            }
        }
        throw lastError;
    }
}

// Export the class directly for backward compatibility
module.exports = BaseService;
// Also export states for services that need them
module.exports.SERVICE_STATES = SERVICE_STATES; 