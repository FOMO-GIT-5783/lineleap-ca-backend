const IdempotencyService = require('../services/idempotencyService.cjs');
const cacheService = require('../services/cacheService.cjs');

async function startCleanupJobs() {
    // Run cleanup every hour
    const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
    
    console.info('Starting cleanup jobs with interval:', CLEANUP_INTERVAL);
    setInterval(runCleanup, CLEANUP_INTERVAL);
    
    // Run initial cleanup
    runCleanup().catch(error => {
        console.error('Initial cleanup failed:', error);
    });
}

async function runCleanup() {
    try {
        // Run cache cleanup
        await cacheService.runCleanup();
        console.info('Cache cleanup completed successfully');

        // Run other cleanup tasks here
        // ...

    } catch (error) {
        console.error('Cleanup job failed:', error);
        if (process.env.NODE_ENV !== 'development') {
            throw error;
        }
    }
}

module.exports = {
    startCleanupJobs
}; 