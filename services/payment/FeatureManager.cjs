class FeatureManager extends BaseService {
  constructor() {
    super('feature-manager');
    this.features = new Map();
    this.featureGauge = new promClient.Gauge({
      name: 'feature_usage_count',
      help: 'Feature flag usage count',
      labelNames: ['feature']
    });
    this.featureErrorRate = new promClient.Gauge({
      name: 'feature_error_rate',
      help: 'Feature flag error rate',
      labelNames: ['feature']
    });
  }

  async enhanceMetrics(feature) {
    const metrics = this.features.get(feature)?.metrics;
    if (metrics) {
      this.featureGauge.set({ feature }, metrics.usageCount);
      this.featureErrorRate.set({ feature }, metrics.errors);
    }
  }

  async isEnabled(feature, context = {}) {
    const featureConfig = this.features.get(feature);
    if (!featureConfig) {
      this.logger.warn(`Feature not found: ${feature}`);
      return false;
    }

    let result = false;

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
    await this.enhanceMetrics(feature);

    return result;
  }

  async recordUsage(feature, enabled) {
    const featureConfig = this.features.get(feature);
    if (featureConfig) {
      featureConfig.metrics.usageCount++;
      featureConfig.metrics.lastUsed = new Date();
      this.features.set(feature, featureConfig);
    }
  }
} 