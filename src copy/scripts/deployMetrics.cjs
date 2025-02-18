const client = require('prom-client');
const express = require('express');
const logger = require('./utils/logger.cjs');
const { config } = require('../config/environment.cjs');

// Initialize metrics registry
const register = new client.Registry();
register.setDefaultLabels({ app: 'lineleap-backend' });

// Add core metrics
client.collectDefaultMetrics({ register });

// Custom metrics with safe defaults
const circuitBreakerStatus = new client.Gauge({
    name: 'circuit_breaker_status',
    help: '0=open, 1=closed, 0.5=half-open',
    labelNames: ['service'],
    aggregator: 'average',
    defaultValue: 1
});

// Add HTTP request duration metric
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.1, 0.3, 0.5, 1, 2.5, 5]
});

// Add health check latency metric
const healthCheckLatency = new client.Gauge({
    name: 'health_check_latency_seconds',
    help: 'Health check latency in seconds',
    labelNames: ['endpoint']
});

// Add error counter
const errorCounter = new client.Counter({
    name: 'error_total',
    help: 'Count of errors by type',
    labelNames: ['type']
});

// Register all metrics
register.registerMetric(circuitBreakerStatus);
register.registerMetric(httpRequestDuration);
register.registerMetric(healthCheckLatency);
register.registerMetric(errorCounter);

// Initialize with default values
circuitBreakerStatus.labels('stripe').set(1);
circuitBreakerStatus.labels('database').set(1);

// Health check with retries and better error handling
async function getHealthStatus() {
    const HEALTH_URL = process.env.HEALTH_URL || 
        (process.env.NODE_ENV === 'production'
            ? 'https://api.lineleap.app/health'
            : 'http://host.docker.internal:3000/api/health');
    
    if (!HEALTH_URL) {
        throw new Error('HEALTH_URL environment variable not set');
    }

    let attempts = 0;
    let lastError;

    // Parse URL for better error reporting
    let urlObj;
    try {
        urlObj = new URL(HEALTH_URL);
    } catch (error) {
        throw new Error(`Invalid HEALTH_URL: ${error.message}`);
    }

    while (attempts < 3) {
        try {
            logger.info(`Health check attempt ${attempts + 1} to ${urlObj.hostname}`);
            const res = await fetch(HEALTH_URL, {
                timeout: 5000,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'LineleapMetrics/1.0'
                }
            });

            if (!res.ok) {
                throw new Error(`Health check failed with status: ${res.status}`);
            }

            const data = await res.json();
            logger.info('Health check successful', { 
                status: data.status,
                endpoint: urlObj.hostname 
            });
            return data;

        } catch (error) {
            lastError = error;
            attempts++;
            
            // Provide more detailed error information
            logger.warn(`Health check attempt ${attempts} failed`, {
                host: urlObj.hostname,
                error: error.message,
                code: error.code,
                type: error.name
            });

            if (attempts < 3) {
                await new Promise(r => setTimeout(r, 1000 * attempts)); // Exponential backoff
            }
        }
    }

    // Detailed error for monitoring
    const errorDetails = {
        host: urlObj.hostname,
        lastError: lastError.message,
        errorCode: lastError.code,
        errorType: lastError.name
    };
    
    logger.error('Health check failed permanently', errorDetails);
    throw new Error(`Health check failed after 3 attempts: ${lastError.message}`);
}

// Metrics endpoint
const app = express();

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const health = await getHealthStatus();

        // Update circuit breakers
        Object.entries(health.circuitBreakers || {}).forEach(([service, breaker]) => {
            const value = breaker.status === 'closed' ? 1 :
                         breaker.status === 'half-open' ? 0.5 : 0;
            circuitBreakerStatus.labels(service).set(value);
        });

        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
    } catch (error) {
        logger.error('Metrics collection failed', { error: error.message, stack: error.stack });
        res.status(500).end(`# ERROR: ${error.message}\n`);
    }
});

// Add request duration middleware
const measureRequestDuration = (req, res, next) => {
    const start = process.hrtime();
    
    res.on('finish', () => {
        const duration = process.hrtime(start);
        const durationSeconds = duration[0] + duration[1] / 1e9;
        
        httpRequestDuration
            .labels(req.method, req.path, res.statusCode.toString())
            .observe(durationSeconds);

        // Alert on slow requests
        if (durationSeconds > 2.5) {
            logger.warn(`Slow request detected: ${req.path} took ${durationSeconds}s`);
        }
    });
    
    next();
};

// Use duration middleware
app.use(measureRequestDuration);

// Error handling
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).end(`# ERROR: Internal server error\n`);
});

// Start server
const port = process.env.METRICS_PORT || 9090;
const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`Metrics server ready on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal, shutting down...');
    server.close(() => {
        logger.info('Server closed');
        process.exit(0);
    });
});

async function deployMetrics() {
    try {
        // Only collect metrics in production
        if (process.env.NODE_ENV !== 'production') {
            logger.info('Skipping metrics collection in development');
            return;
        }

        // Check if metrics endpoint is configured
        if (!config.monitoring?.metricsEndpoint) {
            logger.warn('Metrics endpoint not configured, skipping collection');
            return;
        }

        // Collect system metrics
        const metrics = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            version: process.version
        };

        // Try to send metrics with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(config.monitoring.metricsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.monitoring.apiKey}`
                },
                body: JSON.stringify(metrics),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            logger.info('Metrics deployed successfully');
        } catch (error) {
            if (error.name === 'AbortError') {
                logger.warn('Metrics collection timed out');
            } else {
                logger.warn('Metrics collection failed:', {
                    error: error.message,
                    retryIn: '5 minutes'
                });
            }
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        logger.error('Metrics deployment failed:', error);
        // Don't throw in development
        if (process.env.NODE_ENV === 'production') {
            throw error;
        }
    }
}

// Run metrics deployment if called directly
if (require.main === module) {
    deployMetrics()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Metrics deployment failed:', error);
            process.exit(1);
        });
}

module.exports = deployMetrics; 