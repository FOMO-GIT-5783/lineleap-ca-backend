const cacheStrategy = require('../../utils/cacheStrategy.cjs');

describe('CacheStrategy', () => {
    beforeEach(async () => {
        // Reset cache strategy before each test
        await cacheStrategy.cleanup();
    });

    afterEach(async () => {
        // Clean up after each test
        await cacheStrategy.cleanup();
    });

    it('should store and retrieve values from local cache', async () => {
        const key = 'test-key';
        const value = { foo: 'bar' };

        await cacheStrategy.set(key, value);
        const retrieved = await cacheStrategy.get(key);

        expect(retrieved).toEqual(value);
    });

    it('should handle TTL in local cache', async () => {
        const key = 'ttl-test';
        const value = { foo: 'bar' };
        const ttl = 1; // 1 second

        await cacheStrategy.set(key, value, ttl);
        
        // Value should exist immediately
        let retrieved = await cacheStrategy.get(key);
        expect(retrieved).toEqual(value);

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 1100));

        // Value should be gone
        retrieved = await cacheStrategy.get(key);
        expect(retrieved).toBeNull();
    });

    it('should delete values from cache', async () => {
        const key = 'delete-test';
        const value = { foo: 'bar' };

        await cacheStrategy.set(key, value);
        await cacheStrategy.delete(key);

        const retrieved = await cacheStrategy.get(key);
        expect(retrieved).toBeNull();
    });

    it('should handle Redis connection failure gracefully', async () => {
        // Force Redis to be unhealthy
        cacheStrategy.isRedisHealthy = false;

        const key = 'redis-failure-test';
        const value = { foo: 'bar' };

        // Should still work with local cache
        await cacheStrategy.set(key, value);
        const retrieved = await cacheStrategy.get(key);

        expect(retrieved).toEqual(value);
    });

    it('should report correct health status', () => {
        const health = cacheStrategy.getHealth();

        expect(health).toHaveProperty('status');
        expect(health).toHaveProperty('redisConnected');
        expect(health).toHaveProperty('localCacheSize');
        expect(health).toHaveProperty('retryAttempts');
        expect(health).toHaveProperty('mode');
    });

    it('should handle JSON serialization/deserialization', async () => {
        const key = 'json-test';
        const value = {
            string: 'test',
            number: 123,
            boolean: true,
            array: [1, 2, 3],
            nested: {
                foo: 'bar'
            }
        };

        await cacheStrategy.set(key, value);
        const retrieved = await cacheStrategy.get(key);

        expect(retrieved).toEqual(value);
    });
}); 