const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');
const { METRICS_EVENTS, OPTIMIZATION_EVENTS } = require('./eventTypes.cjs');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Maintain singleton for backward compatibility
let instance = null;

class OptimizationManager extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('optimization-manager', {}, config);

        // Initialize instance variables
        this.optimizations = new Map();
        this.messageQueues = new Map();
        this.flushIntervals = new Map();

        // Create specialized logger
        this.logger = logger.child({
            context: 'optimization',
            service: 'optimization-manager'
        });

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

        const service = new OptimizationManager(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        const events = this.getDependency('events');
        if (!events) {
            throw new Error('Events dependency required');
        }

        // Listen for metrics threshold events
        events.safeOn(METRICS_EVENTS.THRESHOLD_REACHED, async ({ venueId, level, metrics }) => {
            if (level === 'critical') {
                await this.enableMessageBatching(venueId);
                await this.enableCompression(venueId);
            } else if (level === 'warning') {
                await this.enableMessageBatching(venueId);
            }
        });

        this.logger.info('Optimization manager initialized');
    }

    async enableMessageBatching(venueId) {
        if (!this.isReady()) {
            this.logger.warn('Optimization manager not ready, batching request delayed', { venueId });
            return;
        }

        if (this.optimizations.get(venueId)?.batching) return;

        const batchConfig = {
            maxSize: 100,    // Messages per batch
            maxWait: 50,     // Milliseconds
            compression: true // Enable for larger batches
        };

        this.optimizations.set(venueId, {
            ...this.optimizations.get(venueId),
            batching: batchConfig
        });

        // Initialize message queue for this venue
        if (!this.messageQueues.has(venueId)) {
            this.messageQueues.set(venueId, []);
        }

        // Set up flush interval if not already running
        if (!this.flushIntervals.has(venueId)) {
            const interval = setInterval(
                () => this.flushMessageQueue(venueId),
                batchConfig.maxWait
            );
            this.flushIntervals.set(venueId, interval);
        }

        this.logger.info('Message batching enabled', {
            venueId,
            config: batchConfig
        });

        // Emit optimization event
        const events = this.getDependency('events');
        if (events) {
            events.emit(OPTIMIZATION_EVENTS.APPLIED, {
                venueId,
                type: 'batching',
                config: batchConfig
            });
        }
    }

    async enableCompression(venueId) {
        if (!this.isReady()) {
            this.logger.warn('Optimization manager not ready, compression request delayed', { venueId });
            return;
        }

        if (this.optimizations.get(venueId)?.compression) return;

        const compressionConfig = {
            enabled: true,
            threshold: 1024 // Compress messages larger than 1KB
        };

        this.optimizations.set(venueId, {
            ...this.optimizations.get(venueId),
            compression: compressionConfig
        });

        this.logger.info('Compression enabled', {
            venueId,
            config: compressionConfig
        });

        // Emit optimization event
        const events = this.getDependency('events');
        if (events) {
            events.emit(OPTIMIZATION_EVENTS.APPLIED, {
                venueId,
                type: 'compression',
                config: compressionConfig
            });
        }
    }

    async processMessage(venueId, message) {
        if (!this.isReady()) {
            this.logger.warn('Optimization manager not ready, message processing delayed', { venueId });
            return this.sendImmediate(venueId, message);
        }

        const config = this.optimizations.get(venueId);
        
        if (config?.batching) {
            return this.queueMessage(venueId, message);
        }
        
        return this.sendImmediate(venueId, message);
    }

    async queueMessage(venueId, message) {
        const queue = this.messageQueues.get(venueId) || [];
        queue.push(message);
        this.messageQueues.set(venueId, queue);

        const config = this.optimizations.get(venueId)?.batching;
        if (queue.length >= config.maxSize) {
            await this.flushMessageQueue(venueId);
        }
    }

    async flushMessageQueue(venueId) {
        if (!this.isReady()) return;

        const queue = this.messageQueues.get(venueId);
        if (!queue || queue.length === 0) return;

        const config = this.optimizations.get(venueId);
        let payload = queue;

        if (config?.compression?.enabled) {
            const serialized = JSON.stringify(payload);
            if (serialized.length > config.compression.threshold) {
                payload = await gzip(serialized);
            }
        }

        await this.sendImmediate(venueId, payload);
        this.messageQueues.set(venueId, []);

        // Emit batch processed event
        const events = this.getDependency('events');
        events.emitSocketEvent('MESSAGE', {
            venueId,
            type: 'batch',
            size: queue.length,
            compressed: payload !== queue
        });

        this.logger.debug('Message queue flushed', {
            venueId,
            batchSize: queue.length,
            compressed: payload !== queue
        });
    }

    async sendImmediate(venueId, message) {
        const io = this.getDependency('io');
        io.to(`venue:${venueId}`).emit('message', message);

        // Emit message processed event
        const events = this.getDependency('events');
        events.emitSocketEvent('MESSAGE', {
            venueId,
            type: 'immediate',
            size: 1,
            compressed: false
        });
    }

    isOpen(venueId) {
        return this.optimizations.get(venueId)?.status === 'open';
    }

    getOptimizations(venueId) {
        return this.optimizations.get(venueId);
    }

    /**
     * Cleanup resources
     */
    async _cleanup() {
        // Clear all intervals
        for (const [venueId, interval] of this.flushIntervals.entries()) {
            clearInterval(interval);
            this.flushIntervals.delete(venueId);
        }

        // Clear all queues and optimizations
        this.messageQueues.clear();
        this.optimizations.clear();

        this.logger.info('Optimization manager cleaned up');
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
            activeOptimizations: this.optimizations.size,
            queuedMessages: Array.from(this.messageQueues.values())
                .reduce((total, queue) => total + queue.length, 0),
            activeVenues: this.messageQueues.size
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new OptimizationManager();
// Also export the class for service container
module.exports.OptimizationManager = OptimizationManager; 