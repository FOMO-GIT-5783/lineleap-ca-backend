const { LRUCache } = require('lru-cache');
const Redis = require('ioredis');
const logger = require('../utils/logger.cjs');
const BaseService = require('../utils/baseService.cjs');
const { config } = require('../config/environment.cjs');
const cacheStrategy = require('../utils/cacheStrategy.cjs');

class CacheService extends BaseService {
    constructor() {
        super('cache-service');
        this.cacheStrategy = cacheStrategy;
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
            // Initialize default cache as fallback
            this.getCache('GENERAL');
            
            this.logger.info('Cache service initialized', {
                mode: this.cacheStrategy.isRedisHealthy ? 'redis' : 'local',
                environment: process.env.NODE_ENV,
                redisEnabled: this.cacheStrategy.isRedisHealthy
            });
        } catch (error) {
            this.logger.error('Cache initialization error:', error);
            // Continue with local cache in case of failure
            this.logger.info('Falling back to local cache');
        }
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
            const fullKey = `${cacheName}:${key}`;
            const value = await this.cacheStrategy.get(fullKey);
            
            // Add artificial delay in development if configured
            if (process.env.NODE_ENV === 'development' && 
                config.redis.development.mockDelay) {
                await new Promise(r => setTimeout(r, config.redis.development.mockDelay));
            }

            return value;
        } catch (error) {
            this.logger.error('Cache get error:', error);
            return this.getCache(cacheName).get(key);
        }
    }

    async set(key, value, cacheName = 'default', ttl = null) {
        try {
            const fullKey = `${cacheName}:${key}`;
            await this.cacheStrategy.set(fullKey, value, ttl);
            
            // Always update local cache as backup
            const cache = this.getCache(cacheName);
            return cache.set(key, value, ttl ? { ttl } : undefined);
        } catch (error) {
            this.logger.error('Cache set error:', error);
            // Ensure local cache is updated even if strategy fails
            const cache = this.getCache(cacheName);
            return cache.set(key, value, ttl ? { ttl } : undefined);
        }
    }

    async delete(key, cacheName = 'default') {
        try {
            const fullKey = `${cacheName}:${key}`;
            await this.cacheStrategy.delete(fullKey);
            return this.getCache(cacheName).delete(key);
        } catch (error) {
            this.logger.error('Cache delete error:', error);
            return this.getCache(cacheName).delete(key);
        }
    }

    async clear(cacheName = 'default') {
        try {
            if (cacheName === '*') {
                // Clear all caches
                this.localCaches.forEach(cache => cache.clear());
                return true;
            }

            return this.getCache(cacheName).clear();
        } catch (error) {
            this.logger.error('Cache clear error:', error);
            return this.getCache(cacheName).clear();
        }
    }

    async _cleanup() {
        try {
            await this.cacheStrategy.cleanup();
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
        const strategyHealth = this.cacheStrategy.getHealth();
        return {
            status: strategyHealth.status,
            mode: strategyHealth.mode,
            redisConnected: strategyHealth.redisConnected,
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