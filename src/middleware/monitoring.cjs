const promClient = require('prom-client');
const responseTime = require('response-time');
const { metrics, trace } = require('@opentelemetry/api');
const logger = require('../utils/logger.cjs');

// Initialize metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'lineleap_' });

// Custom metrics
const httpRequestDurationMicroseconds = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500]
});

const httpRequestsTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});

const errorCounter = new promClient.Counter({
    name: 'errors_total',
    help: 'Total number of errors',
    labelNames: ['type']
});

// Business metrics
const activeUsers = new promClient.Gauge({
    name: 'active_users',
    help: 'Number of currently active users'
});

const orderCount = new promClient.Counter({
    name: 'orders_total',
    help: 'Total number of orders',
    labelNames: ['status']
});

const venueUtilization = new promClient.Gauge({
    name: 'venue_utilization',
    help: 'Current venue utilization percentage',
    labelNames: ['venue_id']
});

// Business metrics
const passMetrics = {
    sales: new promClient.Counter({
        name: 'pass_sales_total',
        help: 'Total number of passes sold',
        labelNames: ['venue_id', 'pass_type']
    }),
    redemptions: new promClient.Counter({
        name: 'pass_redemptions_total',
        help: 'Total number of passes redeemed',
        labelNames: ['venue_id', 'pass_type']
    }),
    redemptionRate: new promClient.Gauge({
        name: 'pass_redemption_rate',
        help: 'Pass redemption rate percentage',
        labelNames: ['venue_id', 'pass_type']
    })
};

const paymentMetrics = {
    attempts: new promClient.Counter({
        name: 'payment_attempts_total',
        help: 'Total number of payment attempts',
        labelNames: ['venue_id', 'status']
    }),
    successRate: new promClient.Gauge({
        name: 'payment_success_rate',
        help: 'Payment success rate percentage',
        labelNames: ['venue_id']
    })
};

const venueMetrics = {
    activeUsers: new promClient.Gauge({
        name: 'venue_active_users',
        help: 'Number of currently active users per venue',
        labelNames: ['venue_id']
    }),
    capacity: new promClient.Gauge({
        name: 'venue_capacity',
        help: 'Current venue capacity percentage',
        labelNames: ['venue_id']
    })
};

// Critical alerts thresholds
const ALERT_THRESHOLDS = {
    PAYMENT_SUCCESS_RATE: 95, // Alert if payment success rate drops below 95%
    REDEMPTION_FAILURE_RATE: 10, // Alert if redemption failure rate exceeds 10%
    AUTH_ERROR_RATE: 5 // Alert if auth error rate exceeds 5%
};

// Middleware to track request metrics
const requestMetrics = responseTime((req, res, time) => {
    const route = req.route ? req.route.path : req.path;
    const method = req.method;
    const statusCode = res.statusCode;

    httpRequestDurationMicroseconds
        .labels(method, route, statusCode)
        .observe(time);

    httpRequestsTotal
        .labels(method, route, statusCode)
        .inc();
});

// Error tracking
const trackError = (error, type = 'unknown') => {
    errorCounter.labels(type).inc();
    // Additional error tracking logic here
};

// Business metrics tracking
const trackActiveUser = (increment = true) => {
    if (increment) {
        activeUsers.inc();
    } else {
        activeUsers.dec();
    }
};

const trackOrder = (status) => {
    orderCount.labels(status).inc();
};

const updateVenueUtilization = (venueId, percentage) => {
    venueUtilization.labels(venueId).set(percentage);
};

// Track business metrics
const trackPassSale = (venueId, passType) => {
    passMetrics.sales.labels(venueId, passType).inc();
};

const trackPassRedemption = (venueId, passType, success = true) => {
    if (success) {
        passMetrics.redemptions.labels(venueId, passType).inc();
    }
    
    // Update redemption rate
    const sales = passMetrics.sales.labels(venueId, passType).get();
    const redemptions = passMetrics.redemptions.labels(venueId, passType).get();
    if (sales > 0) {
        const rate = (redemptions / sales) * 100;
        passMetrics.redemptionRate.labels(venueId, passType).set(rate);
    }
};

const trackPayment = (venueId, success) => {
    const status = success ? 'success' : 'failure';
    paymentMetrics.attempts.labels(venueId, status).inc();
    
    // Update success rate
    const total = paymentMetrics.attempts.labels(venueId, 'success').get() +
                 paymentMetrics.attempts.labels(venueId, 'failure').get();
    const successes = paymentMetrics.attempts.labels(venueId, 'success').get();
    
    if (total > 0) {
        const rate = (successes / total) * 100;
        paymentMetrics.successRate.labels(venueId).set(rate);
        
        // Check for payment system alert
        if (rate < ALERT_THRESHOLDS.PAYMENT_SUCCESS_RATE) {
            console.error(`ALERT: Payment success rate for venue ${venueId} dropped to ${rate}%`);
        }
    }
};

const trackVenueActivity = (venueId, activeUserCount, capacityPercentage) => {
    venueMetrics.activeUsers.labels(venueId).set(activeUserCount);
    venueMetrics.capacity.labels(venueId).set(capacityPercentage);
};

// Metrics endpoint
const metricsEndpoint = async (req, res) => {
    try {
        res.set('Content-Type', promClient.register.contentType);
        const metrics = await promClient.register.metrics();
        res.send(metrics);
    } catch (error) {
        res.status(500).send(error);
    }
};

// Business metrics endpoint
const businessMetricsEndpoint = async (req, res) => {
    try {
        const metrics = {
            activeUsers: await activeUsers.get(),
            orderCount: await orderCount.get(),
            venueUtilization: await venueUtilization.get()
        };
        res.json(metrics);
    } catch (error) {
        res.status(500).send(error);
    }
};

// OpenTelemetry integration
const meter = metrics.getMeter('lineleap-api');
const tracer = trace.getTracer('lineleap-api');

// Enhanced middleware that supports both Prometheus and OpenTelemetry
function monitoringMiddleware(req, res, next) {
    const startTime = process.hrtime();
    const span = tracer.startSpan(`${req.method} ${req.path}`);

    // Add trace context to request
    req.span = span;
    
    // Existing response tracking
    const originalEnd = res.end;
    res.end = function(...args) {
        const diff = process.hrtime(startTime);
        const duration = (diff[0] * 1e3 + diff[1] * 1e-6);
        
        // Record metrics in both systems
        httpRequestDurationMicroseconds.observe({
            method: req.method,
            route: req.route?.path || req.path,
            status_code: res.statusCode
        }, duration);

        meter.createHistogram('request.duration').record(duration, {
            method: req.method,
            path: req.route?.path || req.path,
            status_code: res.statusCode.toString()
        });

        // End the span
        span.setAttributes({
            'http.method': req.method,
            'http.route': req.route?.path || req.path,
            'http.status_code': res.statusCode
        });
        span.end();

        // Log for monitoring
        logger.info('Request metrics', {
            path: req.path,
            method: req.method,
            duration,
            statusCode: res.statusCode
        });

        originalEnd.apply(res, args);
    };

    next();
}

// Export existing endpoints and new middleware
module.exports = {
    monitoringMiddleware,
    metricsEndpoint,
    businessMetricsEndpoint,
    metrics: {
        httpRequestDurationMicroseconds,
        httpRequestsTotal,
        errorCounter,
        activeUsers,
        orderCount,
        venueUtilization,
        passMetrics,
        paymentMetrics
    },
    ALERT_THRESHOLDS
}; 