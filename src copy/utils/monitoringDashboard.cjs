const logger = require('./logger.cjs');
const BaseService = require('./baseService.cjs');

class MonitoringDashboard extends BaseService {
    constructor(config = {}) {
        super('monitoring-dashboard', {}, config);
        this.metrics = new Map();
        this.eventEmitter = require('./eventEmitter.cjs');
        this.updateInterval = config.updateInterval || 5000; // 5 seconds
        this.intervalId = null;
    }

    async _init() {
        try {
            await this.setupEventListeners();
            // Start periodic metrics collection
            this.intervalId = setInterval(() => this.collectMetrics(), this.updateInterval);
            
            logger.info('Monitoring dashboard initialized');
        } catch (error) {
            logger.error('Failed to initialize monitoring dashboard:', error);
            throw error;
        }
    }

    async setupEventListeners() {
        // Use proper event emitter methods
        this.eventEmitter.safeOn('metrics:websocket', (data) => {
            this.updateMetrics('websocket', data);
        });

        this.eventEmitter.safeOn('metrics:auth', (data) => {
            this.updateMetrics('auth', data);
        });

        logger.info('Event listeners setup completed');
    }

    updateMetrics(category, data) {
        if (!this.metrics.has(category)) {
            this.metrics.set(category, []);
        }
        const metrics = this.metrics.get(category);
        metrics.push({
            timestamp: Date.now(),
            ...data
        });
        // Keep last 1000 metrics
        if (metrics.length > 1000) {
            metrics.shift();
        }

        logger.debug('Metrics updated', { category, data });
    }

    async collectMetrics() {
        try {
            const wsMonitor = this.getDependency('websocket-monitor');
            const authService = this.getDependency('auth-service');
            const dbService = this.getDependency('database');

            // Collect system metrics
            const systemMetrics = {
                timestamp: Date.now(),
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                websocket: wsMonitor ? await wsMonitor.getHealth() : null,
                auth: authService ? await authService.getHealth() : null,
                database: dbService ? await dbService.getHealth() : null
            };

            this.updateMetrics('system', systemMetrics);
            
            logger.debug('System metrics collected', systemMetrics);
        } catch (error) {
            logger.error('Error collecting metrics:', error);
        }
    }

    getMetrics(category) {
        return this.metrics.get(category) || [];
    }

    async _cleanup() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.metrics.clear();
        logger.info('Monitoring dashboard cleaned up');
    }

    getHealth() {
        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            metrics: {
                categories: Array.from(this.metrics.keys()),
                totalEntries: Array.from(this.metrics.values())
                    .reduce((sum, arr) => sum + arr.length, 0)
            },
            lastUpdate: new Date().toISOString()
        };
    }
}

module.exports = new MonitoringDashboard(); 