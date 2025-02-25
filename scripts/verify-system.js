const axios = require('axios');
const logger = require('../src/utils/logger.cjs');
const featureManager = require('../src/services/core/FeatureManager.cjs');

async function verifySystem() {
    const baseUrl = process.env.API_URL || 'http://localhost:3000';
    const results = {
        health: { status: 'unknown' },
        features: { status: 'unknown' },
        components: {}
    };

    try {
        // Check basic health
        const healthResponse = await axios.get(`${baseUrl}/health`);
        results.health = healthResponse.data;
        logger.info('Basic health check:', results.health);

        // Check detailed health
        const detailedHealth = await axios.get(`${baseUrl}/health/detailed`);
        results.components = detailedHealth.data;
        logger.info('Detailed health check:', results.components);

        // Verify feature flags
        await featureManager.initialize();
        const featureHealth = await featureManager.getHealth();
        results.features = {
            status: featureHealth.status,
            count: featureHealth.features.length,
            enabled: featureHealth.features.filter(f => f.enabled).length,
            features: featureHealth.features
        };
        
        logger.info('Feature flags verified:', results.features);

        // Final status
        const isHealthy = results.health.status === 'healthy' && 
                         results.features.status === 'healthy';

        logger.info('System verification complete:', {
            healthy: isHealthy,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            healthy: isHealthy,
            results
        };
    } catch (error) {
        logger.error('System verification failed:', error);
        return {
            success: false,
            error: error.message,
            results
        };
    }
}

// Run if called directly
if (require.main === module) {
    verifySystem()
        .then(result => {
            if (!result.success || !result.healthy) {
                process.exit(1);
            }
            process.exit(0);
        })
        .catch(error => {
            logger.error('Verification script failed:', error);
            process.exit(1);
        });
}

module.exports = verifySystem; 