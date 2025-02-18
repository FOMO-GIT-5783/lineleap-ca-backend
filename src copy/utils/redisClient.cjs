const Redis = require('ioredis');
const { config } = require('../config/environment.cjs');
const logger = require('./logger.cjs');
const { LRUCache } = require('lru-cache');
const BaseService = require('./baseService.cjs');

// Maintain singleton for backward compatibility
let instance = null;

class RedisClient extends BaseService {
    constructor(config = {}) {
        // Return existing instance if already created
        if (instance) {
            return instance;
        }

        super('redis-client', {}, config);

        // Initialize instance variables
        this.client = null;
        this.localCache = null;

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

        const service = new RedisClient(config);
        await service.initialize();
        return service;
    }

    /**
     * Internal initialization
     */
    async _init() {
        // Initialize LRU cache as fallback
        this.localCache = new LRUCache({
            max: 10000,
            ttl: 60 * 60 * 1000 // 1 hour
        });

        // Only initialize Redis in production
        if (process.env.NODE_ENV === 'production') {
            await this.initRedis();
        } else {
            logger.info('Running in development mode - using LRU cache only');
        }
    }

    async initRedis() {
        try {
            this.client = new Redis(config.redis.url, {
                retryStrategy: (times) => {
                    if (times > config.redis.retryCount) {
                        logger.warn('Redis connection failed, falling back to LRU cache');
                        return null; // Stop retrying
                    }
                    return Math.min(times * 100, 3000); // Exponential backoff
                },
                keyPrefix: `${config.redis.keyPrefix}:`
            });

            // Set up event handlers
            this.client.on('error', (err) => {
                logger.error('Redis client error:', err);
            });

            this.client.on('connect', () => {
                logger.info('Redis client connected');
            });

            // Test connection
            await this.client.ping();
        } catch (error) {
            logger.error('Failed to initialize Redis:', error);
            // Don't throw - we'll fallback to local cache
        }
    }

    async acquireLock(key, ttl = config.redis.lockTTL) {
        if (!this.isReady()) {
            logger.warn('Redis client not ready, using local cache for lock');
            return this.acquireLocalLock(key, ttl);
        }

        try {
            if (this.client) {
                const lockKey = `lock:${key}`;
                const acquired = await this.client.set(lockKey, '1', 'NX', 'EX', ttl);
                return acquired === 'OK';
            }
            
            return this.acquireLocalLock(key, ttl);
        } catch (error) {
            logger.error('Lock acquisition error:', error);
            return this.acquireLocalLock(key, ttl);
        }
    }

    async acquireLocalLock(key, ttl) {
        const lockKey = `lock:${key}`;
        if (this.localCache.has(lockKey)) {
            return false;
        }
        this.localCache.set(lockKey, '1', { ttl: ttl * 1000 });
        return true;
    }

    async releaseLock(key) {
        if (!this.isReady()) {
            return this.releaseLocalLock(key);
        }

        try {
            if (this.client) {
                const lockKey = `lock:${key}`;
                await this.client.del(lockKey);
            } else {
                this.releaseLocalLock(key);
            }
        } catch (error) {
            logger.error('Lock release error:', error);
            this.releaseLocalLock(key);
        }
    }

    releaseLocalLock(key) {
        this.localCache.delete(`lock:${key}`);
    }

    async get(key) {
        if (!this.isReady()) {
            return this.localCache.get(key);
        }

        try {
            if (this.client) {
                const value = await this.client.get(key);
                // Cache in local for faster subsequent access
                if (value) {
                    this.localCache.set(key, value);
                }
                return value;
            }
            return this.localCache.get(key);
        } catch (error) {
            logger.error('Cache get error:', error);
            return this.localCache.get(key);
        }
    }

    async set(key, value, ttl = null) {
        if (!this.isReady()) {
            this.localCache.set(key, value, ttl ? { ttl: ttl * 1000 } : undefined);
            return 'OK';
        }

        try {
            if (this.client) {
                let result;
                if (ttl) {
                    result = await this.client.set(key, value, 'EX', ttl);
                } else {
                    result = await this.client.set(key, value);
                }
                // Update local cache
                this.localCache.set(key, value, ttl ? { ttl: ttl * 1000 } : undefined);
                return result;
            }
            
            this.localCache.set(key, value, ttl ? { ttl: ttl * 1000 } : undefined);
            return 'OK';
        } catch (error) {
            logger.error('Cache set error:', error);
            // Fallback to local cache
            this.localCache.set(key, value, ttl ? { ttl: ttl * 1000 } : undefined);
            return null;
        }
    }

    getClient() {
        return this.client;
    }

    /**
     * Cleanup resources
     */
    async _cleanup() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
        }
        if (this.localCache) {
            this.localCache.clear();
        }
        logger.info('Redis client cleaned up');
    }

    /**
     * Check if service is ready
     */
    isReady() {
        return this.state === 'ready' && this.localCache !== null;
    }

    /**
     * Get service health
     */
    getHealth() {
        return {
            ...super.getHealth(),
            redisConnected: this.client?.status === 'ready',
            localCacheSize: this.localCache?.size || 0,
            mode: process.env.NODE_ENV === 'production' ? 'redis' : 'local'
        };
    }
}

// Export singleton instance for backward compatibility
module.exports = new RedisClient();
// Also export the class for service container
module.exports.RedisClient = RedisClient; 