const EventEmitter = require('events');
const logger = require('./logger.cjs');
const EVENT_TYPES = require('./eventTypes.cjs');
const BaseService = require('./baseService.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class EventService extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('event-service', {}, config);
        
        // Initialize event emitter with unlimited listeners for nightlife app
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(0); // Unlimited listeners, we'll manage them ourselves
        this.handlers = new Map();
        this.listenerCount = new Map();
        this.listenerLimits = new Map();
        
        // Set default limits per event type
        this.setDefaultLimits();
        
        // Track handlers for cleanup
        this.boundHandlers = new WeakMap();
        
        // Initialize metrics
        this.metrics = {
            totalEvents: 0,
            eventTypes: new Map(),
            lastCleanup: Date.now()
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

        const service = new EventService(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        try {
            // Set up default event handlers
            this.handlers.set('error', (error) => {
                this.logger.error('Event error:', error);
            });

            this.handlers.set('warning', (warning) => {
                this.logger.warn('Event warning:', warning);
            });

            // Start cleanup job
            this.startCleanupJob();

            this.logger.info('Event service initialized');
            return true;
        } catch (error) {
            this.logger.error('Failed to initialize event service:', error);
            throw error;
        }
    }

    startCleanupJob() {
        setInterval(() => {
            this.cleanupStaleListeners();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    cleanupStaleListeners() {
        const now = Date.now();
        let cleaned = 0;

        // Clean up stale handlers
        for (const [eventName, count] of this.listenerCount.entries()) {
            if (count === 0) {
                this.listenerCount.delete(eventName);
                cleaned++;
            }
        }

        // Update metrics
        this.metrics.lastCleanup = now;

        this.logger.info('Event listener cleanup completed', {
            cleaned,
            remaining: this.listenerCount.size
        });
    }

    /**
     * Emit an event with automatic logging and error handling
     */
    safeEmit(eventName, data = {}) {
        if (!this.isReady()) {
            this.logger.warn('Event service not ready, event dropped:', { eventName, data });
            return false;
        }

        try {
            const eventData = {
                ...data,
                timestamp: new Date().toISOString()
            };

            // Debug logging for development
            if (process.env.NODE_ENV !== 'production') {
                this.logger.debug('Event Emitted:', { eventName, ...eventData });
            }

            this.emitter.emit(eventName, eventData);
            return true;
        } catch (error) {
            this.logger.error('Event Emission Error:', {
                eventName,
                error: error.message,
                data
            });
            return false;
        }
    }

    setDefaultLimits() {
        // Set reasonable limits per event type
        const limits = {
            'auth:*': 20,
            'payment:*': 15,
            'socket:*': 25,
            'venue:*': 20,
            'default': 10
        };

        Object.entries(limits).forEach(([type, limit]) => {
            this.listenerLimits.set(type, limit);
        });
    }

    getListenerLimit(eventName) {
        // Check for exact match
        if (this.listenerLimits.has(eventName)) {
            return this.listenerLimits.get(eventName);
        }

        // Check for wildcard match
        const prefix = eventName.split(':')[0];
        const wildcardKey = `${prefix}:*`;
        if (this.listenerLimits.has(wildcardKey)) {
            return this.listenerLimits.get(wildcardKey);
        }

        // Return default limit
        return this.listenerLimits.get('default');
    }

    safeOn(eventName, handler) {
        if (!this.isReady()) {
            this.logger.warn('Event service not ready, subscription delayed:', { eventName });
            return;
        }

        try {
            // Check against per-event-type limits
            const currentCount = this.listenerCount.get(eventName) || 0;
            const limit = this.getListenerLimit(eventName);

            if (currentCount >= limit) {
                this.logger.warn('Listener limit reached for event type:', { 
                    eventName, 
                    currentCount,
                    limit 
                });
                return;
            }

            // Store bound handler for removal
            const boundHandler = handler.bind(null);
            this.boundHandlers.set(handler, boundHandler);

            // Wrap handler to catch errors and track metrics
            const wrappedHandler = async (data) => {
                const startTime = Date.now();
                try {
                    await boundHandler(data);
                    this.metrics.totalEvents++;
                    
                    // Update event type metrics
                    const typeMetrics = this.metrics.eventTypes.get(eventName) || {
                        count: 0,
                        errors: 0,
                        avgDuration: 0
                    };
                    typeMetrics.count++;
                    const duration = Date.now() - startTime;
                    typeMetrics.avgDuration = 
                        (typeMetrics.avgDuration * (typeMetrics.count - 1) + duration) / typeMetrics.count;
                    this.metrics.eventTypes.set(eventName, typeMetrics);

                } catch (error) {
                    this.logger.error('Event Handler Error:', {
                        eventName,
                        error: error.message,
                        data
                    });
                    
                    // Update error metrics
                    const typeMetrics = this.metrics.eventTypes.get(eventName) || {
                        count: 0,
                        errors: 0,
                        avgDuration: 0
                    };
                    typeMetrics.errors++;
                    this.metrics.eventTypes.set(eventName, typeMetrics);
                }
            };

            // Store handler reference
            this.handlers.set(`${eventName}:${handler.name || 'anonymous'}`, wrappedHandler);
            this.listenerCount.set(eventName, currentCount + 1);

            this.emitter.on(eventName, wrappedHandler);
            this.logger.debug('Event handler registered:', { eventName });
        } catch (error) {
            this.logger.error('Event Subscription Error:', {
                eventName,
                error: error.message
            });
        }
    }

    /**
     * Emit venue-related events
     */
    emitVenueEvent(type, venueId, data = {}) {
        return this.safeEmit(EVENT_TYPES.VENUE[type], {
            venueId,
            ...data
        });
    }

    /**
     * Emit payment-related events
     */
    emitPaymentEvent(type, data = {}) {
        return this.safeEmit(EVENT_TYPES.PAYMENT[type], data);
    }

    /**
     * Emit auth-related events
     */
    emitAuthEvent(type, data = {}) {
        return this.safeEmit(EVENT_TYPES.AUTH[type], data);
    }

    /**
     * Emit socket-related events
     */
    emitSocketEvent(type, data = {}) {
        return this.safeEmit(EVENT_TYPES.SOCKET[type], data);
    }

    /**
     * Emit optimization-related events
     */
    emitOptimizationEvent(type, data = {}) {
        return this.safeEmit(EVENT_TYPES.OPTIMIZATION[type], data);
    }

    /**
     * Cleanup resources
     */
    async _cleanup() {
        this.removeAllListeners();
        this.logger.info('Event service cleaned up');
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.state === 'ready' && this.emitter !== null;
    }

    getHealth() {
        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            listenerCount: Object.fromEntries(this.listenerCount),
            handlers: Array.from(this.handlers.keys())
        };
    }

    on(event, handler) {
        if (typeof handler !== 'function') {
            console.warn(`Invalid handler for event: ${event}`);
            return;
        }

        this.handlers.set(event, handler);
        this.emitter.on(event, handler);
        console.info(`Handler registered for event: ${event}`);
    }

    removeHandler(eventName, handler) {
        const boundHandler = this.boundHandlers.get(handler);
        if (boundHandler) {
            this.emitter.removeListener(eventName, boundHandler);
            this.boundHandlers.delete(handler);
            
            const count = this.listenerCount.get(eventName) || 0;
            if (count > 0) {
                this.listenerCount.set(eventName, count - 1);
            }
            
            this.logger.debug('Event handler removed:', { eventName });
        }
    }

    removeAllListeners(eventName) {
        if (eventName) {
            this.emitter.removeAllListeners(eventName);
            this.listenerCount.delete(eventName);
            // Remove all handlers for this event
            for (const [key, handler] of this.handlers.entries()) {
                if (key.startsWith(`${eventName}:`)) {
                    this.handlers.delete(key);
                }
            }
        } else {
            this.emitter.removeAllListeners();
            this.handlers.clear();
            this.listenerCount.clear();
        }
    }
}

// Export singleton instance for backward compatibility
module.exports = new EventService();
// Also export the class for service container
module.exports.EventService = EventService; 