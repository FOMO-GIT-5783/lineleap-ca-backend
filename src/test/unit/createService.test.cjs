const createService = require('../../utils/createService.cjs');
const metrics = require('../../utils/monitoring.cjs');
const { ERROR_CODES } = require('../../utils/errors.cjs');

describe('Service Wrapper', () => {
    let service;

    beforeEach(() => {
        // Reset metrics
        metrics.reset();
        
        // Create test service
        service = createService('test-service', {
            slowThreshold: 100 // Lower threshold for testing
        });
    });

    it('should execute operations successfully', async () => {
        const operation = async () => 'success';
        const result = await service.execute(operation);

        expect(result).toBe('success');
        
        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.attempts).toBe(1);
        expect(serviceMetrics.success).toBe(1);
        expect(serviceMetrics.errors).toBe(0);
    });

    it('should handle operation errors', async () => {
        const operation = async () => {
            throw new Error('Test error');
        };

        await expect(service.execute(operation))
            .rejects
            .toHaveProperty('code', ERROR_CODES.SERVICE_ERROR);

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.attempts).toBe(1);
        expect(serviceMetrics.success).toBe(0);
        expect(serviceMetrics.errors).toBe(1);
    });

    it('should detect slow operations', async () => {
        const operation = async () => {
            await new Promise(resolve => setTimeout(resolve, 150)); // Longer than threshold
            return 'slow success';
        };

        const result = await service.execute(operation);
        expect(result).toBe('slow success');

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.avgDuration).toBeGreaterThan(100);
    });

    it('should handle retries correctly', async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            if (attempts < 3) {
                throw new Error('Temporary error');
            }
            return 'success after retry';
        };

        const result = await service.executeWithRetry(operation, {
            maxAttempts: 3,
            delay: 10, // Short delay for testing
            shouldRetry: () => true
        });

        expect(result).toBe('success after retry');
        expect(attempts).toBe(3);

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.attempts).toBe(3);
        expect(serviceMetrics.success).toBe(1);
        expect(serviceMetrics.errors).toBe(2);
    });

    it('should respect retry conditions', async () => {
        const operation = async () => {
            throw new Error('Critical error');
        };

        await expect(service.executeWithRetry(operation, {
            maxAttempts: 3,
            delay: 10,
            shouldRetry: (error) => error.message !== 'Critical error'
        })).rejects.toThrow('Critical error');

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.attempts).toBe(1); // Should not retry
        expect(serviceMetrics.errors).toBe(1);
    });

    it('should preserve error codes', async () => {
        const customError = new Error('Custom error');
        customError.code = 'CUSTOM_ERROR';

        const operation = async () => {
            throw customError;
        };

        await expect(service.execute(operation))
            .rejects
            .toHaveProperty('code', 'CUSTOM_ERROR');

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.errors).toBe(1);
    });

    it('should provide operation context in metrics', async () => {
        const operation = async () => 'success';
        const context = { 
            operationId: 'test-123',
            userId: 'user-456'
        };

        await service.execute(operation, context);

        const serviceMetrics = service.getMetrics();
        expect(serviceMetrics.attempts).toBe(1);
        expect(serviceMetrics.success).toBe(1);
    });
}); 