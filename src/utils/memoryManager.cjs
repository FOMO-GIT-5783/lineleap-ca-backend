const logger = require('./logger.cjs');
const metrics = require('./monitoring.cjs');

class MemoryManager {
    constructor() {
        this.config = {
            heapUsageThreshold: 0.75, // 75% heap usage triggers cleanup
            gcInterval: 5 * 60 * 1000, // 5 minutes
            memoryLimit: process.env.NODE_ENV === 'production' ? 
                1024 * 1024 * 1024 : // 1GB in production
                512 * 1024 * 1024,   // 512MB in development
            cleanupThresholds: {
                heapUsed: 0.75,      // 75% heap usage
                arrayBuffers: 20 * 1024 * 1024, // 20MB
                external: 50 * 1024 * 1024      // 50MB
            }
        };

        this.lastCleanup = Date.now();
        this.lastExternalMemory = 0;
        this.setupMonitoring();
    }

    setupMonitoring() {
        // Monitor memory usage every minute
        setInterval(() => this.checkMemoryUsage(), 60 * 1000);

        // Monitor specific subsystems
        this.monitorArrayBuffers();
        this.monitorExternalMemory();

        // Schedule periodic garbage collection in development
        if (process.env.NODE_ENV === 'development' && global.gc) {
            setInterval(() => {
                this.forceGC();
            }, this.config.gcInterval);
        }
    }

    async checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        const heapUsage = memUsage.heapUsed / memUsage.heapTotal;

        metrics.gauge('memory.heap.used', memUsage.heapUsed);
        metrics.gauge('memory.heap.total', memUsage.heapTotal);
        metrics.gauge('memory.external', memUsage.external);
        metrics.gauge('memory.arrayBuffers', memUsage.arrayBuffers);

        // Log memory state
        logger.debug('Memory usage:', {
            heapUsage: `${(heapUsage * 100).toFixed(1)}%`,
            heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB`,
            external: `${(memUsage.external / 1024 / 1024).toFixed(1)}MB`,
            arrayBuffers: `${(memUsage.arrayBuffers / 1024 / 1024).toFixed(1)}MB`
        });

        // Check if cleanup is needed
        if (this.shouldCleanup(memUsage)) {
            await this.cleanup();
        }
    }

    shouldCleanup(memUsage) {
        const timeSinceLastCleanup = Date.now() - this.lastCleanup;
        if (timeSinceLastCleanup < this.config.gcInterval) {
            return false;
        }

        return (
            memUsage.heapUsed / memUsage.heapTotal > this.config.cleanupThresholds.heapUsed ||
            memUsage.arrayBuffers > this.config.cleanupThresholds.arrayBuffers ||
            memUsage.external > this.config.cleanupThresholds.external
        );
    }

    async cleanup() {
        logger.info('Starting memory cleanup');
        const startTime = Date.now();

        try {
            // 1. Clear module caches if needed
            if (process.env.NODE_ENV === 'development') {
                this.clearModuleCache();
            }

            // 2. Run garbage collection if available
            this.forceGC();

            // 3. Clear any internal caches
            await this.clearInternalCaches();

            // Record cleanup
            this.lastCleanup = Date.now();
            const duration = Date.now() - startTime;
            
            metrics.timing('memory.cleanup.duration', duration);
            logger.info('Memory cleanup completed', {
                duration,
                memoryAfter: process.memoryUsage()
            });

        } catch (error) {
            logger.error('Memory cleanup failed:', error);
            metrics.increment('memory.cleanup.errors');
        }
    }

    clearModuleCache() {
        // Clear only non-essential module caches
        Object.keys(require.cache).forEach(key => {
            if (key.includes('node_modules') || key.includes('.test.')) {
                delete require.cache[key];
            }
        });
    }

    async clearInternalCaches() {
        // Get cache service instance
        const cacheService = require('../services/cacheService.cjs');
        
        // Clear expired items from all local caches
        if (cacheService.localCaches) {
            for (const cache of cacheService.localCaches.values()) {
                if (typeof cache.purgeStale === 'function') {
                    await cache.purgeStale();
                }
            }
        }
    }

    forceGC() {
        if (global.gc) {
            try {
                global.gc();
                logger.debug('Manual garbage collection completed');
            } catch (error) {
                logger.error('Manual garbage collection failed:', error);
            }
        }
    }

    monitorArrayBuffers() {
        // Monitor array buffer allocations
        const originalArrayBuffer = ArrayBuffer;
        global.ArrayBuffer = function(...args) {
            const buffer = new originalArrayBuffer(...args);
            if (buffer.byteLength > 1024 * 1024) { // Log allocations over 1MB
                logger.warn('Large ArrayBuffer allocated:', {
                    size: buffer.byteLength,
                    stack: new Error().stack
                });
                metrics.increment('memory.large_buffers');
            }
            return buffer;
        };
    }

    monitorExternalMemory() {
        // Initialize last external memory value
        this.lastExternalMemory = process.memoryUsage().external;

        // Monitor external memory growth
        setInterval(() => {
            const currentExternal = process.memoryUsage().external;
            this.checkExternalMemoryChange(currentExternal);
            this.lastExternalMemory = currentExternal;
        }, 30 * 1000); // Check every 30 seconds
    }

    checkExternalMemoryChange(currentExternal) {
        const delta = currentExternal - this.lastExternalMemory;
            
        if (Math.abs(delta) > 5 * 1024 * 1024) { // 5MB change
            logger.warn('Significant external memory change:', {
                delta: `${(delta / 1024 / 1024).toFixed(1)}MB`,
                total: `${(currentExternal / 1024 / 1024).toFixed(1)}MB`
            });
            metrics.increment('memory.external_spikes');
        }
    }

    getMemoryStats() {
        const memUsage = process.memoryUsage();
        return {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            heapUsagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
            lastCleanup: this.lastCleanup,
            timeSinceCleanup: Date.now() - this.lastCleanup
        };
    }
}

// Export singleton instance
module.exports = new MemoryManager(); 