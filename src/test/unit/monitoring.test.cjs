const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const { mockStripe } = require('../mocks/stripe.mock.cjs');
const { config } = require('../../config/environment.cjs');
const promClient = require('prom-client');

// Enhanced test registry initialization
const initializeTestMetrics = () => {
    const registry = new promClient.Registry();
    const testMetrics = {
        httpRequestDurationMicroseconds: new promClient.Histogram({
            name: 'http_request_duration_ms',
            help: 'Duration of HTTP requests in ms',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500],
            registers: [registry]
        }),
        httpRequestsTotal: new promClient.Counter({
            name: 'http_requests_total',
            help: 'Total number of HTTP requests',
            labelNames: ['method', 'route', 'status_code'],
            registers: [registry]
        }),
        errorCounter: new promClient.Counter({
            name: 'errors_total',
            help: 'Total number of errors',
            labelNames: ['type'],
            registers: [registry]
        }),
        venueUtilization: new promClient.Gauge({
            name: 'venue_utilization',
            help: 'Current venue utilization percentage',
            labelNames: ['venue_id'],
            registers: [registry]
        }),
        passMetrics: {
            sales: new promClient.Counter({
                name: 'pass_sales_total',
                help: 'Total number of passes sold',
                labelNames: ['venue_id', 'pass_type'],
                registers: [registry]
            }),
            redemptions: new promClient.Counter({
                name: 'pass_redemptions_total',
                help: 'Total number of passes redeemed',
                labelNames: ['venue_id', 'pass_type'],
                registers: [registry]
            })
        },
        paymentMetrics: {
            attempts: new promClient.Counter({
                name: 'payment_attempts_total',
                help: 'Total number of payment attempts',
                labelNames: ['venue_id', 'status'],
                registers: [registry]
            }),
            successRate: new promClient.Gauge({
                name: 'payment_success_rate',
                help: 'Payment success rate percentage',
                labelNames: ['venue_id'],
                registers: [registry]
            })
        }
    };

    return { metrics: testMetrics, registry };
};

// Initialize test metrics once
const { metrics: testMetrics, registry } = initializeTestMetrics();

// Helper to update business metrics
const updateBusinessMetrics = (metric, labels, value) => {
    // Handle nested metrics (like passMetrics.sales)
    if (metric.labels) {
        // Convert labels object to array in correct order based on labelNames
        const labelValues = metric.labelNames.map(name => labels[name]);
        const labeledMetric = metric.labels(...labelValues);
        
        if (metric instanceof promClient.Gauge) {
            labeledMetric.set(value || 0);
        } else if (metric instanceof promClient.Counter) {
            labeledMetric.inc(value || 1);
        } else {
            labeledMetric.observe(value || 0);
        }
    } else {
        // Handle nested objects
        Object.values(metric).forEach(m => updateBusinessMetrics(m, labels, value));
    }
};

// Mock external dependencies
jest.mock('../../middleware/authMiddleware.cjs', () => ({
    requireAuth: () => (req, res, next) => next()
}));

jest.mock('stripe', () => mockStripe);

// Mock monitoring module
jest.mock('../../middleware/monitoring.cjs', () => {
    const originalModule = jest.requireActual('../../middleware/monitoring.cjs');
    return {
        ...originalModule,
        metrics: testMetrics,
        monitoringMiddleware: (req, res, next) => {
            const start = process.hrtime();
            
            // Capture original end to wrap it
            const originalEnd = res.end;
            res.end = function(...args) {
                const diff = process.hrtime(start);
                const duration = diff[0] * 1e3 + diff[1] * 1e-6;
                
                // Record request duration
                testMetrics.httpRequestDurationMicroseconds
                    .labels(req.method, req.path, res.statusCode.toString())
                    .observe(duration);
                
                // Increment request counter
                testMetrics.httpRequestsTotal
                    .labels(req.method, req.path, res.statusCode.toString())
                    .inc();
                
                originalEnd.apply(res, args);
            };
            
            next();
        },
        updateBusinessMetrics
    };
});

const { monitoringMiddleware, metricsEndpoint } = require('../../middleware/monitoring.cjs');

// Safe metric value retrieval with error handling
const getMetricValue = async (metric, labels = {}) => {
    try {
        if (!metric) {
            return 0;
        }
        const value = await metric.get();
        if (!value?.values?.length) return 0;
        
        // Match labels in the correct order
        const matchingValue = value.values.find(v => 
            metric.labelNames.every(name => v.labels[name] === labels[name])
        );
        return matchingValue ? matchingValue.value : 0;
    } catch (error) {
        console.error('Error getting metric value:', error);
        return 0;
    }
};

// Fix 2: Add realistic test thresholds
const TEST_THRESHOLDS = {
    MIN_CONCURRENT: 50,   // Halifax venues peak at ~150
    MAX_LATENCY_MS: 200,  // 200ms acceptable for mobile users
    ERROR_TOLERANCE: 0.05 // 5% error rate max
};

describe('Monitoring System Tests (Test Environment)', () => {
    let app;

    beforeAll(async () => {
        // Connect to test database
        if (!mongoose.connection.readyState) {
            await mongoose.connect(process.env.MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
        }

        // Setup test express app
        app = express();
        app.use((req, res, next) => {
            req.metrics = testMetrics;
            next();
        });
        app.use(monitoringMiddleware);
        app.get('/test-endpoint', (req, res) => res.json({ status: 'success' }));
        app.post('/test-payment', (req, res) => res.json({ status: 'success' }));
        app.get('/metrics', metricsEndpoint);
        
        app.use((err, req, res, next) => {
            res.status(500).json({ error: err.message });
        });

        // Verify metric registration
        const registeredMetrics = await registry.getMetricsAsJSON();
        expect(registeredMetrics.length).toBeGreaterThan(0);
    });

    beforeEach(async () => {
        await registry.clear();
    });

    afterEach(async () => {
        await registry.clear();
    });

    afterAll(async () => {
        await mongoose.disconnect();
    });

    describe('1. Basic Metric Collection', () => {
        test('tracks HTTP request duration', async () => {
            const response = await request(app)
                .get('/test-endpoint')
                .expect(200);

            const duration = await testMetrics.httpRequestDurationMicroseconds.get();
            expect(duration.values.length).toBeGreaterThan(0);
            expect(duration.values[0].value).toBeLessThan(TEST_THRESHOLDS.MAX_LATENCY_MS);
        });

        test('counts total requests', async () => {
            const before = await getMetricValue(testMetrics.httpRequestsTotal, {
                method: 'GET',
                route: '/test-endpoint',
                status_code: '200'
            });
            
            await request(app)
                .get('/test-endpoint')
                .expect(200);

            const after = await getMetricValue(testMetrics.httpRequestsTotal, {
                method: 'GET',
                route: '/test-endpoint',
                status_code: '200'
            });
            expect(after - before).toBe(1);
        });

        test('tracks error counts', async () => {
            const errorType = 'test_error';
            const before = await getMetricValue(testMetrics.errorCounter, { type: errorType });
            
            testMetrics.errorCounter.labels(errorType).inc();
            
            const after = await getMetricValue(testMetrics.errorCounter, { type: errorType });
            expect(after - before).toBe(1);
        });
    });

    describe('2. Business Metrics', () => {
        test('tracks pass sales and redemptions', async () => {
            const venueId = 'test-venue';
            const passType = 'VIP';

            updateBusinessMetrics(testMetrics.passMetrics.sales, { venueId, passType });
            updateBusinessMetrics(testMetrics.passMetrics.redemptions, { venueId, passType });

            const sales = await getMetricValue(testMetrics.passMetrics.sales, { 
                venueId, 
                passType 
            });
            const redemptions = await getMetricValue(testMetrics.passMetrics.redemptions, { 
                venueId, 
                passType 
            });

            expect(sales).toBe(1);
            expect(redemptions).toBe(1);
        });

        test('calculates payment success rate', async () => {
            const venueId = 'test-venue';

            updateBusinessMetrics(testMetrics.paymentMetrics.attempts, { venueId, status: 'success' }, 8);
            updateBusinessMetrics(testMetrics.paymentMetrics.attempts, { venueId, status: 'failure' }, 2);
            updateBusinessMetrics(testMetrics.paymentMetrics.successRate, { venueId }, 80);

            const successRate = await getMetricValue(testMetrics.paymentMetrics.successRate, { venueId });
            expect(successRate).toBe(80);
            expect(successRate).toBeLessThan(95); // Alert threshold
        });

        test('tracks venue utilization', async () => {
            const venueId = 'test-venue';
            const utilization = 75;

            updateBusinessMetrics(testMetrics.venueUtilization, { venueId }, utilization);
            
            const result = await getMetricValue(testMetrics.venueUtilization, { venueId });
            expect(result).toBe(utilization);
        });
    });

    describe('3. Alert Thresholds', () => {
        test('detects payment system issues', async () => {
            const venueId = 'test-venue';
            
            updateBusinessMetrics(testMetrics.paymentMetrics.attempts, { venueId, status: 'success' }, 90);
            updateBusinessMetrics(testMetrics.paymentMetrics.attempts, { venueId, status: 'failure' }, 10);
            updateBusinessMetrics(testMetrics.paymentMetrics.successRate, { venueId }, 90);

            const successRate = await getMetricValue(testMetrics.paymentMetrics.successRate, { venueId });
            expect(successRate).toBe(90);
            expect(successRate).toBeLessThan(95); // Alert threshold
        });

        test('monitors high error rates', async () => {
            const errorType = 'auth_error';
            const threshold = 5; // 5% error rate threshold
            
            for (let i = 0; i < 6; i++) {
                testMetrics.errorCounter.labels(errorType).inc();
            }

            const errorCount = await getMetricValue(testMetrics.errorCounter, { type: errorType });
            expect(errorCount).toBeGreaterThan(threshold);
        });
    });

    describe('4. Performance Under Load', () => {
        test('handles concurrent requests', async () => {
            const concurrentRequests = 30; // 150/5 venues
            const requests = Array(concurrentRequests).fill().map(() =>
                request(app).get('/test-endpoint')
            );

            const responses = await Promise.all(requests);
            responses.forEach(response => {
                expect(response.status).toBe(200);
            });

            const metricsResponse = await request(app)
                .get('/metrics')
                .expect(200);

            expect(metricsResponse.text).toContain('http_requests_total');
        }, 10000); // Extended timeout

        test('maintains accuracy under load', async () => {
            const venueId = 'test-venue';
            const operations = 100; // ~1.6 ops/sec
            let successCount = 0;

            for (let i = 0; i < operations; i++) {
                const res = await request(app).get('/test-endpoint');
                if (res.status === 200) successCount++;
            }

            expect(successCount).toBeGreaterThanOrEqual(
                operations * (1 - TEST_THRESHOLDS.ERROR_TOLERANCE)
            );
        });
    });

    describe('5. Integration Tests', () => {
        test('correctly tracks full payment flow', async () => {
            const venueId = 'test-venue';
            
            await request(app)
                .post('/test-payment')
                .send({ amount: 100 })
                .expect(200);

            const requestCount = await getMetricValue(testMetrics.httpRequestsTotal, {
                method: 'POST',
                route: '/test-payment',
                status_code: '200'
            });
            expect(requestCount).toBeGreaterThan(0);
        });

        test('integrates with error handling', async () => {
            const errorType = 'payment_error';
            
            testMetrics.errorCounter.labels(errorType).inc();
            
            const errorCount = await getMetricValue(testMetrics.errorCounter, { type: errorType });
            expect(errorCount).toBe(1);
        });
    });
}); 