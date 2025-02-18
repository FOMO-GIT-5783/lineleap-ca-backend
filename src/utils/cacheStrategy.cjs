const { LRUCache } = require('lru-cache');
const logger = require('./logger.cjs');

class CacheStrategy {
    constructor() {
        this.localCache = new LRUCache({
            max: 10000,
            ttl: 60 * 60 * 1000 // 1 hour
        });
        this.isRedisHealthy = false;

        logger.info('Running with local cache only');
    }

    async get(key) {
        try {
            return this.localCache.get(key);
        } catch (error) {
            logger.error('Cache get error:', { error: error.message, key });
            return null;
        }
    }

    async set(key, value, ttl = null) {
        try {
            this.localCache.set(key, value, ttl ? { ttl: ttl * 1000 } : undefined);
            return true;
        } catch (error) {
            logger.error('Cache set error:', { error: error.message, key });
            return false;
        }
    }

    async delete(key) {
        try {
            this.localCache.delete(key);
            return true;
        } catch (error) {
            logger.error('Cache delete error:', { error: error.message, key });
            return false;
        }
    }

    getHealth() {
        return {
            status: 'healthy',
            mode: 'local',
            localCacheSize: this.localCache.size
        };
    }

    async cleanup() {
        this.localCache.clear();
        logger.info('Cache strategy cleaned up');
    }
}

// Export singleton instance
module.exports = new CacheStrategy(); 