const createService = require('../../utils/createService.cjs');
const metrics = require('../../utils/monitoring.cjs');

describe('Service Metrics Collection', () => {
    let service;

    beforeEach(() => {
        // Reset metrics before each test
        metrics.reset();
        
        // Create test service
        service = createService('test-service', {
            slowThreshold: 100 // Lower threshold for testing
        });
    });

    describe('Basic Metrics', () => {
        it('tracks operation attempts and success', async () => {
            const operation = async () => 'success';
            await service.execute(operation);

            const serviceMetrics = service.getMetrics();
            expect(serviceMetrics.attempts).toBe(1);
            expect(serviceMetrics.success).toBe(1);
            expect(serviceMetrics.errors).toBe(0);
            expect(serviceMetrics.uptime).toBeGreaterThan(0);
        });

        it('tracks operation failures', async () => {
            const operation = async () => {
                throw new Error('Test error');
            };

            await expect(service.execute(operation)).rejects.toThrow();

            const serviceMetrics = service.getMetrics();
            expect(serviceMetrics.attempts).toBe(1);
            expect(serviceMetrics.success).toBe(0);
            expect(serviceMetrics.errors).toBe(1);
        });

        it('tracks operation duration', async () => {
            const operation = async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return 'success';
            };

            await service.execute(operation);

            const serviceMetrics = service.getMetrics();
            expect(serviceMetrics.avgDuration).toBeGreaterThanOrEqual(50);
        });
    });

    describe('Operation-Specific Metrics', () => {
        it('tracks metrics per operation type', async () => {
            // Execute different operation types
            await service.execute(async () => 'success', { type: 'read' });
            await service.execute(async () => 'success', { type: 'write' });
            await expect(service.execute(async () => {
                throw new Error('Test error');
            }, { type: 'write' })).rejects.toThrow();

            const serviceMetrics = service.getMetrics();
            
            // Check read operation metrics
            expect(serviceMetrics.operations.read).toBeDefined();
            expect(serviceMetrics.operations.read.attempts).toBe(1);
            expect(serviceMetrics.operations.read.success).toBe(1);
            expect(serviceMetrics.operations.read.failures).toBe(0);
            expect(serviceMetrics.operations.read.successRate).toBe(100);

            // Check write operation metrics
            expect(serviceMetrics.operations.write).toBeDefined();
            expect(serviceMetrics.operations.write.attempts).toBe(2);
            expect(serviceMetrics.operations.write.success).toBe(1);
            expect(serviceMetrics.operations.write.failures).toBe(1);
            expect(serviceMetrics.operations.write.successRate).toBe(50);
        });

        it('tracks latency percentiles per operation', async () => {
            // Execute operations with different latencies
            for (let i = 0; i < 10; i++) {
                await service.execute(async () => {
                    await new Promise(resolve => setTimeout(resolve, (i + 1) * 10));
                    return 'success';
                }, { type: 'test' });
            }

            const serviceMetrics = service.getMetrics();
            const opMetrics = serviceMetrics.operations.test;

            expect(opMetrics.avgLatency).toBeGreaterThan(50); // Average should be around 55ms
            expect(opMetrics.p95Latency).toBeGreaterThan(90); // 95th percentile should be around 95ms
        });
    });

    describe('Retry Metrics', () => {
        it('tracks retry attempts', async () => {
            let attempts = 0;
            const operation = async () => {
                attempts++;
                if (attempts < 3) throw new Error('Retry needed');
                return 'success';
            };

            await service.executeWithRetry(operation, {
                maxAttempts: 3,
                delay: 10
            });

            const serviceMetrics = service.getMetrics();
            expect(metrics.getMetric('service.test-service.retry.attempts')).toBe(2);
            expect(serviceMetrics.success).toBe(1);
        });

        it('tracks exhausted retries', async () => {
            const operation = async () => {
                throw new Error('Always fail');
            };

            await expect(service.executeWithRetry(operation, {
                maxAttempts: 3,
                delay: 10
            })).rejects.toThrow();

            expect(metrics.getMetric('service.test-service.retry.exhausted')).toBe(1);
        });
    });

    describe('Metric Management', () => {
        it('allows resetting metrics', async () => {
            // Execute some operations
            await service.execute(async () => 'success', { type: 'test' });
            await service.execute(async () => 'success', { type: 'test' });

            // Get metrics before reset
            const beforeReset = service.getMetrics();
            expect(beforeReset.operations.test.attempts).toBe(2);

            // Reset metrics
            service.resetMetrics();

            // Get metrics after reset
            const afterReset = service.getMetrics();
            expect(afterReset.operations.test).toBeUndefined();
            expect(afterReset.lastReset).toBeGreaterThan(beforeReset.lastReset);
        });

        it('maintains uptime across resets', async () => {
            const beforeUptime = service.getMetrics().uptime;
            
            // Wait a bit and reset
            await new Promise(resolve => setTimeout(resolve, 50));
            service.resetMetrics();

            const afterUptime = service.getMetrics().uptime;
            expect(afterUptime).toBeGreaterThan(beforeUptime);
        });
    });
}); 