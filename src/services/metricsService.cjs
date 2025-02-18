const BaseService = require('../utils/baseService.cjs');
const logger = require('../utils/logger.cjs');

class MetricsService extends BaseService {
    constructor() {
        super('metrics-service');
        this.metrics = new Map();
        this.logger = logger.child({
            context: 'metrics',
            service: 'metrics-service'
        });
    }

    async _init() {
        this.logger.info('Metrics service initialized');
    }

    async getMetrics() {
        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            metrics: {
                memory: process.memoryUsage(),
                uptime: process.uptime()
            }
        };
    }

    async recordMetric(name, value, tags = {}) {
        const key = this.getMetricKey(name, tags);
        this.metrics.set(key, {
            value,
            timestamp: Date.now(),
            tags
        });
    }

    getMetricKey(name, tags) {
        const tagString = Object.entries(tags)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
        return tagString ? `${name}[${tagString}]` : name;
    }

    async _cleanup() {
        this.metrics.clear();
        this.logger.info('Metrics service cleaned up');
    }

    getHealth() {
        return {
            status: 'healthy',
            metrics: {
                count: this.metrics.size,
                lastUpdate: new Date().toISOString()
            }
        };
    }
}

module.exports = new MetricsService(); 