const express = require('express');
const router = express.Router();
const { metrics } = require('@opentelemetry/api');
const { HealthStatus } = require('../utils/constants');
const cacheService = require('../services/cacheService.cjs');
const authService = require('../services/authService.cjs');
const dbService = require('../services/dbService.cjs');
const wsMonitor = require('../utils/websocketMonitor.cjs');
const rateLimiter = require('../services/rateLimiter.cjs');
const featureManager = require('../services/core/FeatureManager.cjs');
const logger = require('../utils/logger.cjs');

// HTML Template helper
const renderHTML = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Health Dashboard</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid #eee;
        }
        .status-badge {
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 14px;
        }
        .status-healthy { background: #d4edda; color: #155724; }
        .status-degraded { background: #fff3cd; color: #856404; }
        .status-down { background: #f8d7da; color: #721c24; }
        .status-unknown { background: #e2e3e5; color: #383d41; }
        .component-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .component-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            background: white;
        }
        .component-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .metrics-section {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
        .metric-group {
            margin-bottom: 15px;
        }
        .metric-title {
            font-weight: 600;
            margin-bottom: 5px;
        }
        .metric-value {
            font-family: monospace;
            background: #f8f9fa;
            padding: 5px;
            border-radius: 4px;
        }
        .error-message {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }
        .history-section {
            margin-top: 20px;
        }
        .history-entry {
            padding: 10px;
            border-bottom: 1px solid #eee;
        }
        .refresh-button {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .refresh-button:hover {
            background: #0056b3;
        }
        .auto-refresh {
            margin-left: 10px;
            display: flex;
            align-items: center;
        }
    </style>
    <script>
        function refreshPage() {
            window.location.reload();
        }
        
        function startAutoRefresh() {
            const checkbox = document.getElementById('autoRefresh');
            if (checkbox.checked) {
                window.autoRefreshInterval = setInterval(refreshPage, 30000);
            } else {
                clearInterval(window.autoRefreshInterval);
            }
        }
    </script>
</head>
<body>
    ${content}
</body>
</html>
`;

const formatBytes = (bytes) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
};

const getStatusClass = (status) => {
    const statusMap = {
        [HealthStatus.HEALTHY]: 'status-healthy',
        [HealthStatus.DEGRADED]: 'status-degraded',
        [HealthStatus.DOWN]: 'status-down',
        [HealthStatus.UNKNOWN]: 'status-unknown'
    };
    return statusMap[status] || 'status-unknown';
};

class HealthCheckManager {
  constructor() {
    this.meter = metrics.getMeter('health-check');
    this.healthGauge = this.meter.createUpDownCounter('system_health');
    this.componentStatus = this.meter.createHistogram('component_status');
    this.historyCache = cacheService.getCache('HEALTH_HISTORY');
    
    this.initializeMetrics();
  }

  initializeMetrics() {
    // Initialize base metrics
    this.healthGauge.add(1);
  }

  async getSystemHealth() {
    try {
      const components = {
        auth: await this.getServiceHealth(authService, 'auth'),
        cache: await this.getServiceHealth(cacheService, 'cache'),
        database: await this.getServiceHealth(dbService, 'database'),
        websocket: await this.getServiceHealth(wsMonitor, 'websocket'),
        rateLimiter: await this.getServiceHealth(rateLimiter, 'rate-limiter'),
        featureFlags: await this.getServiceHealth(featureManager, 'feature-flags')
      };

      const status = this.calculateOverallStatus(components);
      await this.recordHealthMetrics(components, status);

      return {
        status,
        timestamp: new Date().toISOString(),
        components,
        metrics: await this.getHealthMetrics(),
        history: await this.getHealthHistory(),
        environment: process.env.NODE_ENV
      };
    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        status: HealthStatus.DEGRADED,
        timestamp: new Date().toISOString(),
        error: error.message,
        environment: process.env.NODE_ENV
      };
    }
  }

  async getServiceHealth(service, name) {
    try {
      if (!service || typeof service.getHealth !== 'function') {
        return {
          status: HealthStatus.UNKNOWN,
          type: name,
          message: 'Service health check not implemented'
        };
      }
      return await service.getHealth();
    } catch (error) {
      logger.error(`Health check failed for ${name}:`, error);
      return {
        status: HealthStatus.DEGRADED,
        type: name,
        error: error.message
      };
    }
  }

  async recordHealthMetrics(components, status) {
    // Record overall health
    this.healthGauge.add(status === HealthStatus.HEALTHY ? 1 : -1);

    // Record component-specific metrics
    Object.entries(components).forEach(([name, health]) => {
      this.componentStatus.record(health.status === HealthStatus.HEALTHY ? 1 : 0, {
        component: name,
        type: health.type
      });
    });

    // Update history
    const history = this.historyCache.get('health_history') || [];
    history.push({
      timestamp: new Date().toISOString(),
      status,
      components: Object.fromEntries(
        Object.entries(components).map(([k, v]) => [k, v.status])
      )
    });

    // Keep last 24 hours of history
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filteredHistory = history.filter(h => 
      new Date(h.timestamp) > dayAgo
    );

    await this.historyCache.set('health_history', filteredHistory);
  }

  calculateOverallStatus(components) {
    const statuses = Object.values(components).map(c => c.status);
    
    if (statuses.some(s => s === HealthStatus.DOWN)) {
      return HealthStatus.DOWN;
    }
    
    if (statuses.some(s => s === HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }
    
    if (statuses.some(s => s === HealthStatus.UNKNOWN)) {
      return HealthStatus.DEGRADED;
    }
    
    return HealthStatus.HEALTHY;
  }

  async getHealthMetrics() {
    const metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      lastChecked: new Date().toISOString()
    };

    // Add load averages if available
    try {
      const os = require('os');
      metrics.loadAverage = os.loadavg();
    } catch (error) {
      logger.debug('Could not get load averages:', error);
    }

    return metrics;
  }

  async getHealthHistory() {
    return this.historyCache.get('health_history') || [];
  }
}

const healthManager = new HealthCheckManager();

// Basic health check - JSON response
router.get('/', (req, res) => {
    const health = {
        status: HealthStatus.HEALTHY,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        uptime: process.uptime()
    };
    res.json(health);
});

// HTML Dashboard view
router.get('/dashboard', (req, res) => {
    const health = {
        status: HealthStatus.HEALTHY,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        uptime: process.uptime()
    };
    
    const content = `
    <div class="container">
        <div class="header">
            <h1>System Health Status</h1>
            <div>
                <button class="refresh-button" onclick="refreshPage()">Refresh</button>
                <span class="auto-refresh">
                    <input type="checkbox" id="autoRefresh" onchange="startAutoRefresh()">
                    <label for="autoRefresh">Auto-refresh (30s)</label>
                </span>
            </div>
        </div>
        <div class="component-card">
            <div class="component-header">
                <h2>Quick Status</h2>
                <span class="status-badge ${getStatusClass(health.status)}">${health.status}</span>
            </div>
            <div>
                <p><strong>Environment:</strong> ${health.environment}</p>
                <p><strong>Uptime:</strong> ${Math.floor(health.uptime / 60)} minutes ${Math.floor(health.uptime % 60)} seconds</p>
                <p><strong>Last Updated:</strong> ${new Date(health.timestamp).toLocaleString()}</p>
            </div>
        </div>
        <p style="margin-top: 20px;">
            <a href="/api/health/detailed" style="color: #007bff;">View Detailed Health Report →</a>
        </p>
    </div>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(renderHTML(content));
});

// Detailed health check
router.get('/detailed', async (req, res) => {
    try {
        const health = await healthManager.getSystemHealth();
        
        if (req.accepts('html')) {
            const componentCards = Object.entries(health.components)
                .map(([name, component]) => `
                    <div class="component-card">
                        <div class="component-header">
                            <h3>${name.charAt(0).toUpperCase() + name.slice(1)}</h3>
                            <span class="status-badge ${getStatusClass(component.status)}">${component.status}</span>
                        </div>
                        ${component.error ? `<div class="error-message">${component.error}</div>` : ''}
                        <div class="metric-group">
                            ${Object.entries(component)
                                .filter(([key]) => !['status', 'error'].includes(key))
                                .map(([key, value]) => `
                                    <div class="metric-title">${key}</div>
                                    <div class="metric-value">${JSON.stringify(value, null, 2)}</div>
                                `).join('')}
                        </div>
                    </div>
                `).join('');

            const content = `
            <div class="container">
                <div class="header">
                    <h1>Detailed Health Report</h1>
                    <div>
                        <button class="refresh-button" onclick="refreshPage()">Refresh</button>
                        <span class="auto-refresh">
                            <input type="checkbox" id="autoRefresh" onchange="startAutoRefresh()">
                            <label for="autoRefresh">Auto-refresh (30s)</label>
                        </span>
                    </div>
                </div>
                
                <div class="component-header">
                    <h2>System Status</h2>
                    <span class="status-badge ${getStatusClass(health.status)}">${health.status}</span>
                </div>

                <div class="component-grid">
                    ${componentCards}
                </div>

                <div class="metrics-section">
                    <h2>System Metrics</h2>
                    <div class="component-grid">
                        <div class="component-card">
                            <h3>Memory Usage</h3>
                            <div class="metric-group">
                                <div class="metric-title">Heap Used</div>
                                <div class="metric-value">${formatBytes(health.metrics.memory.heapUsed)}</div>
                                <div class="metric-title">Heap Total</div>
                                <div class="metric-value">${formatBytes(health.metrics.memory.heapTotal)}</div>
                                <div class="metric-title">RSS</div>
                                <div class="metric-value">${formatBytes(health.metrics.memory.rss)}</div>
                            </div>
                        </div>
                        <div class="component-card">
                            <h3>System Load</h3>
                            <div class="metric-group">
                                ${health.metrics.loadAverage ? `
                                    <div class="metric-title">Load Average (1m, 5m, 15m)</div>
                                    <div class="metric-value">${health.metrics.loadAverage.join(', ')}</div>
                                ` : ''}
                                <div class="metric-title">Uptime</div>
                                <div class="metric-value">${Math.floor(health.metrics.uptime / 60)} minutes</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="history-section">
                    <h2>Recent History</h2>
                    ${health.history.slice(-5).reverse().map(entry => `
                        <div class="history-entry">
                            <span class="status-badge ${getStatusClass(entry.status)}">${entry.status}</span>
                            <span>${new Date(entry.timestamp).toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
            res.send(renderHTML(content));
        } else {
            res.status(health.status === HealthStatus.HEALTHY ? 200 : 503)
               .json(health);
        }
    } catch (error) {
        logger.error('Health check failed:', error);
        const errorResponse = {
            status: HealthStatus.DOWN,
            error: error.message,
            timestamp: new Date().toISOString()
        };

        if (req.accepts('html')) {
            const content = `
            <div class="container">
                <div class="header">
                    <h1>System Health Error</h1>
                    <button class="refresh-button" onclick="refreshPage()">Retry</button>
                </div>
                <div class="error-message">
                    <h2>Error Occurred</h2>
                    <p>${error.message}</p>
                    <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                </div>
            </div>`;
            res.status(500).send(renderHTML(content));
        } else {
            res.status(500).json(errorResponse);
        }
    }
});

// Component-specific health check
router.get('/component/:component', async (req, res) => {
    try {
        const health = await healthManager.getSystemHealth();
        const component = health.components[req.params.component];
        
        if (!component) {
            const errorResponse = {
                error: `Component ${req.params.component} not found`,
                availableComponents: Object.keys(health.components)
            };

            if (req.accepts('html')) {
                const content = `
                <div class="container">
                    <div class="header">
                        <h1>Component Not Found</h1>
                        <button class="refresh-button" onclick="history.back()">Back</button>
                    </div>
                    <div class="error-message">
                        <p>${errorResponse.error}</p>
                        <p><strong>Available Components:</strong></p>
                        <ul>
                            ${errorResponse.availableComponents.map(comp => `
                                <li><a href="/api/health/component/${comp}">${comp}</a></li>
                            `).join('')}
                        </ul>
                    </div>
                </div>`;
                return res.status(404).send(renderHTML(content));
            }
            return res.status(404).json(errorResponse);
        }

        const response = {
            component: req.params.component,
            status: component.status,
            details: component,
            timestamp: new Date().toISOString()
        };

        if (req.accepts('html')) {
            const content = `
            <div class="container">
                <div class="header">
                    <h1>${req.params.component.charAt(0).toUpperCase() + req.params.component.slice(1)} Status</h1>
                    <div>
                        <button class="refresh-button" onclick="refreshPage()">Refresh</button>
                        <button class="refresh-button" onclick="history.back()" style="margin-left: 10px;">Back</button>
                    </div>
                </div>
                <div class="component-card">
                    <div class="component-header">
                        <h2>Component Status</h2>
                        <span class="status-badge ${getStatusClass(component.status)}">${component.status}</span>
                    </div>
                    ${component.error ? `<div class="error-message">${component.error}</div>` : ''}
                    <div class="metric-group">
                        ${Object.entries(component)
                            .filter(([key]) => !['status', 'error'].includes(key))
                            .map(([key, value]) => `
                                <div class="metric-title">${key}</div>
                                <div class="metric-value">${JSON.stringify(value, null, 2)}</div>
                            `).join('')}
                    </div>
                </div>
            </div>`;
            res.send(renderHTML(content));
        } else {
            res.json(response);
        }
    } catch (error) {
        logger.error('Component health check failed:', error);
        const errorResponse = {
            status: HealthStatus.DOWN,
            component: req.params.component,
            error: error.message
        };

        if (req.accepts('html')) {
            const content = `
            <div class="container">
                <div class="header">
                    <h1>Component Check Error</h1>
                    <button class="refresh-button" onclick="refreshPage()">Retry</button>
                </div>
                <div class="error-message">
                    <h2>Error Checking ${req.params.component}</h2>
                    <p>${error.message}</p>
                </div>
            </div>`;
            res.status(500).send(renderHTML(content));
        } else {
            res.status(500).json(errorResponse);
        }
    }
});

module.exports = router; 