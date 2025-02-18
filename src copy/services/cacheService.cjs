const { LRUCache } = require('lru-cache');
const Redis = require('ioredis');
const logger = require('../utils/logger.cjs');
const BaseService = require('../utils/baseService.cjs');
const { config } = require('../config/environment.cjs');

class CacheService extends BaseService {
    constructor() {
        super('cache-service');
        this.redisClient = null;
        this.localCaches = new Map();
        this.config = {
            defaultTTL: 60 * 60 * 1000, // 1 hour
            maxSize: 10000,
            retryAttempts: 3,
            retryDelay: 1000
        };
    }

    async _init() {
        try {
            const isDev = process.env.NODE_ENV === 'development';
            
            // Initialize Redis if enabled
            if (!isDev || (isDev && config.redis.development.enabled)) {
                await this.initRedis();
            } else {
                this.logger.info('Redis disabled in development mode, using local cache');
            }
            
            // Initialize default cache as fallback
            this.getCache('GENERAL');
            
            this.logger.info('Cache service initialized', {
                mode: this.redisClient ? 'redis' : 'local',
                environment: process.env.NODE_ENV,
                redisEnabled: !!this.redisClient
            });
        } catch (error) {
            this.logger.error('Cache initialization error:', error);
            // Continue with local cache in case of Redis failure
            this.logger.info('Falling back to local cache');
        }
    }

    async initRedis() {
        let attempts = 0;
        while (attempts < this.config.retryAttempts) {
            try {
                // Use configuration from environment.cjs
                this.redisClient = new Redis(config.redis.url, {
                    ...config.redis.options,
                    keyPrefix: config.redis.keyPrefix,
                    maxRetriesPerRequest: config.redis.retryCount
                });

                // Set up event handlers
                this.redisClient.on('error', (err) => {
                    this.logger.error('Redis client error:', err);
                });

                this.redisClient.on('connect', () => {
                    this.logger.info('Redis client connected');
                });

                this.redisClient.on('ready', () => {
                    this.logger.info('Redis client ready');
                });

                // Test connection
                await this.redisClient.ping();
                this.logger.info('Redis connected successfully');
                return;
            } catch (error) {
                attempts++;
                this.logger.warn(`Redis connection attempt ${attempts} failed:`, error);
                await new Promise(r => setTimeout(r, this.config.retryDelay * attempts));
            }
        }
        throw new Error('Redis connection failed after multiple attempts');
    }

    getCache(name = 'default') {
        let cache = this.localCaches.get(name);
        if (!cache) {
            this.logger.info(`Creating new local cache: ${name}`);
            cache = new LRUCache({
                max: this.config.maxSize,
                ttl: this.config.defaultTTL
            });
            this.localCaches.set(name, cache);
        }
        return cache;
    }

    async get(key, cacheName = 'default') {
        try {
            // Try Redis first if available
            if (this.redisClient?.status === 'ready') {
                const value = await this.redisClient.get(`${cacheName}:${key}`);
                if (value) {
                    // Add artificial delay in development
                    if (process.env.NODE_ENV === 'development' && config.redis.development.mockDelay) {
                        await new Promise(r => setTimeout(r, config.redis.development.mockDelay));
                    }
                    return JSON.parse(value);
                }
            }

            // Fallback to local cache
            return this.getCache(cacheName).get(key);
        } catch (error) {
            this.logger.error('Cache get error:', error);
            return this.getCache(cacheName).get(key);
        }
    }

    async set(key, value, cacheName = 'default', ttl = null) {
        try {
            // Set in Redis if available
            if (this.redisClient?.status === 'ready') {
                const options = ttl ? ['PX', ttl] : [];
                await this.redisClient.set(
                    `${cacheName}:${key}`,
                    JSON.stringify(value),
                    ...options
                );
            }

            // Always set in local cache as backup
            const cache = this.getCache(cacheName);
            return cache.set(key, value, ttl ? { ttl } : undefined);
        } catch (error) {
            this.logger.error('Cache set error:', error);
            // Ensure local cache is updated even if Redis fails
            const cache = this.getCache(cacheName);
            return cache.set(key, value, ttl ? { ttl } : undefined);
        }
    }

    async delete(key, cacheName = 'default') {
        try {
            if (this.redisClient?.status === 'ready') {
                await this.redisClient.del(`${cacheName}:${key}`);
            }
            return this.getCache(cacheName).delete(key);
        } catch (error) {
            this.logger.error('Cache delete error:', error);
            return this.getCache(cacheName).delete(key);
        }
    }

    async clear(cacheName = 'default') {
        try {
            if (cacheName === '*') {
                if (this.redisClient?.status === 'ready') {
                    await this.redisClient.flushall();
                }
                this.localCaches.forEach(cache => cache.clear());
                return true;
            }

            if (this.redisClient?.status === 'ready') {
                const keys = await this.redisClient.keys(`${cacheName}:*`);
                if (keys.length) await this.redisClient.del(keys);
            }
            return this.getCache(cacheName).clear();
        } catch (error) {
            this.logger.error('Cache clear error:', error);
            return this.getCache(cacheName).clear();
        }
    }

    async _cleanup() {
        try {
            if (this.redisClient) {
                await this.redisClient.quit();
                this.redisClient = null;
            }
            this.localCaches.forEach(cache => cache.clear());
            this.localCaches.clear();
            this.logger.info('Cache service cleaned up');
            return true;
        } catch (error) {
            this.logger.error('Cache cleanup error:', error);
            return false;
        }
    }

    getHealth() {
        const isDev = process.env.NODE_ENV === 'development';
        const redisEnabled = !isDev || (isDev && config.redis.development.enabled);

        return {
            status: redisEnabled && !this.redisClient?.status === 'ready' ? 'degraded' : 'healthy',
            mode: this.redisClient?.status === 'ready' ? 'redis' : 'local',
            redisEnabled,
            redisConnected: this.redisClient?.status === 'ready',
            localCacheCount: this.localCaches.size,
            localCacheStats: Array.from(this.localCaches.entries()).map(([name, cache]) => ({
                name,
                size: cache.size,
                maxSize: cache.max
            }))
        };
    }
}

module.exports = new CacheService(); 