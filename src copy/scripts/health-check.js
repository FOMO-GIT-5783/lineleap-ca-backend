const { ServiceContainer } = require('../utils/serviceContainer.cjs');
const logger = require('../utils/logger.cjs');

async function performHealthCheck() {
    try {
        const monitoring = ServiceContainer.getService('monitoring');
        const wsMonitor = ServiceContainer.getService('websocket-monitor');
        
        const metrics = await wsMonitor.getHealth();
        
        console.log('Current System State:', {
            status: metrics.status,
            errorRate: metrics.errorRate || 0,
            latency: metrics.averageLatency || 0,
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
            activeConnections: metrics.activeConnections || 0,
            version: metrics.version
        });

        return metrics.status === 'healthy';
    } catch (error) {
        logger.error('Health check failed:', error);
        return false;
    }
}

performHealthCheck()
    .then(healthy => {
        process.exit(healthy ? 0 : 1);
    })
    .catch(error => {
        console.error('Health check error:', error);
        process.exit(1);
    }); 