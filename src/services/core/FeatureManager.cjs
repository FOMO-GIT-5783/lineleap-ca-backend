const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { systemMetrics } = require('../../middleware/monitoring.cjs');
const cacheService = require('../cacheService.cjs');

class FeatureManager extends BaseService {
    constructor() {
        super('feature-manager');
        this.features = new Map();
        this.logger = logger.child({
            context: 'core',
            service: 'feature-manager'
        });
        this.metrics = systemMetrics.featureFlags;
        this.cache = cacheService.getCache('FEATURE_FLAGS');
    }

    async _init() {
        // Load features from cache first
        const cachedFeatures = await this.cache.get('features');
        if (cachedFeatures) {
            this.features = new Map(cachedFeatures);
        } else {
            // Initialize default features
            await this.initializeFeatures();
        }
        this.logger.info('Feature manager initialized');
    }

    async initializeFeatures() {
        const defaultFeatures = {
            USE_NEW_PAYMENT_PROCESSOR: {
                enabled: process.env.NODE_ENV === 'development',
                rolloutPercentage: process.env.NODE_ENV === 'development' ? 100 : 0,
                description: 'Use new payment processor implementation',
                metrics: { usageCount: 0, errors: 0, lastUsed: null }
            },
            USE_NEW_METRICS: {
                enabled: true,
                rolloutPercentage: 100,
                description: 'Use enhanced metrics collection',
                metrics: { usageCount: 0, errors: 0, lastUsed: null }
            },
            USE_CIRCUIT_BREAKER: {
                enabled: true,
                rolloutPercentage: 100,
                description: 'Enable circuit breaker for external services',
                metrics: { usageCount: 0, errors: 0, lastUsed: null }
            }
        };

        // Set features and update cache
        for (const [key, value] of Object.entries(defaultFeatures)) {
            this.features.set(key, value);
            this.updateMetrics(key, value);
        }

        await this.cache.set('features', Array.from(this.features.entries()));
    }

    updateMetrics(feature, config) {
        this.metrics.set({
            feature,
            enabled: config.enabled ? 1 : 0,
            rollout_percentage: config.rolloutPercentage
        }, 1);
    }

    async isEnabled(feature, context = {}) {
        const featureConfig = this.features.get(feature);
        if (!featureConfig) {
            this.logger.warn(`Feature not found: ${feature}`);
            return false;
        }

        let result = false;

        try {
            if (featureConfig.enabled && featureConfig.rolloutPercentage === 100) {
                result = true;
            }

            if (featureConfig.enabled && featureConfig.rolloutPercentage > 0) {
                const inRollout = this.isInRolloutGroup(feature, context, featureConfig.rolloutPercentage);
                this.logger.debug('Rollout check', {
                    feature,
                    context,
                    rolloutPercentage: featureConfig.rolloutPercentage,
                    inRollout
                });
                result = inRollout;
            }

            await this.recordUsage(feature, result);
            this.updateMetrics(feature, featureConfig);

            return result;
        } catch (error) {
            this.logger.error('Feature check failed:', {
                feature,
                error: error.message
            });
            featureConfig.metrics.errors++;
            this.updateMetrics(feature, featureConfig);
            return false;
        }
    }

    async recordUsage(feature, enabled) {
        const featureConfig = this.features.get(feature);
        if (featureConfig) {
            featureConfig.metrics.usageCount++;
            featureConfig.metrics.lastUsed = new Date();
            this.features.set(feature, featureConfig);
            await this.cache.set('features', Array.from(this.features.entries()));
        }
    }

    isInRolloutGroup(feature, context, percentage) {
        const hash = this.calculateHash(feature + JSON.stringify(context));
        return (hash % 100) < percentage;
    }

    calculateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    async getHealth() {
        const health = {
            status: 'healthy',
            features: Array.from(this.features.entries()).map(([key, value]) => ({
                name: key,
                enabled: value.enabled,
                rolloutPercentage: value.rolloutPercentage,
                metrics: value.metrics
            }))
        };

        return health;
    }
}

// Export singleton instance
module.exports = new FeatureManager(); 