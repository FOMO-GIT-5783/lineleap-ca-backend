class WebSocketMonitor extends BaseService {
  constructor() {
    super('websocket-monitor');
    // ... existing constructor code ...
    
    this.featureSyncMetrics = new promClient.Counter({
      name: 'feature_sync_total',
      help: 'Feature flag sync operations',
      labelNames: ['feature', 'status']
    });
  }

  handleFeatureSync(data) {
    const { feature, state } = data;
    
    this.recordMetric('feature_sync', {
      feature,
      state,
      timestamp: Date.now()
    });

    this.featureSyncMetrics.inc({
      feature,
      status: state.enabled ? 'enabled' : 'disabled'
    });

    this.logger.info('Feature sync event', {
      feature,
      state,
      timestamp: new Date().toISOString()
    });
  }

  // Modify existing getHealth method
  getHealth() {
    const health = super.getHealth();
    
    // Add feature sync metrics
    health.featureSync = {
      status: this.isReady() ? 'healthy' : 'unhealthy',
      metrics: Array.from(this.metrics.entries())
        .filter(([key]) => key.startsWith('feature_sync'))
        .map(([key, value]) => ({
          feature: key.split(':')[1],
          ...value
        }))
    };

    return health;
  }

  // ... existing code ...
} 