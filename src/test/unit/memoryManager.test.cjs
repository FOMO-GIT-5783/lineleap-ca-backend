const memoryManager = require('../../utils/memoryManager.cjs');

describe('MemoryManager', () => {
    beforeEach(() => {
        // Reset metrics before each test
        const metrics = require('../../utils/monitoring.cjs');
        metrics.reset();
    });

    it('should report memory stats correctly', () => {
        const stats = memoryManager.getMemoryStats();
        
        expect(stats).toHaveProperty('heapUsed');
        expect(stats).toHaveProperty('heapTotal');
        expect(stats).toHaveProperty('external');
        expect(stats).toHaveProperty('arrayBuffers');
        expect(stats).toHaveProperty('heapUsagePercent');
        expect(stats).toHaveProperty('lastCleanup');
        expect(stats).toHaveProperty('timeSinceCleanup');
    });

    it('should detect when cleanup is needed', () => {
        const mockMemUsage = {
            heapUsed: 900,
            heapTotal: 1000,  // 90% usage
            external: 60 * 1024 * 1024,  // 60MB (above threshold)
            arrayBuffers: 25 * 1024 * 1024  // 25MB (above threshold)
        };

        // Force last cleanup to be old enough
        memoryManager.lastCleanup = Date.now() - (6 * 60 * 1000); // 6 minutes ago

        expect(memoryManager.shouldCleanup(mockMemUsage)).toBe(true);
    });

    it('should not cleanup too frequently', () => {
        const mockMemUsage = {
            heapUsed: 900,
            heapTotal: 1000,
            external: 60 * 1024 * 1024,
            arrayBuffers: 25 * 1024 * 1024
        };

        // Set last cleanup to recent
        memoryManager.lastCleanup = Date.now() - (1 * 60 * 1000); // 1 minute ago

        expect(memoryManager.shouldCleanup(mockMemUsage)).toBe(false);
    });

    it('should monitor large array buffer allocations', () => {
        // Create a large array buffer
        const buffer = new ArrayBuffer(2 * 1024 * 1024); // 2MB

        // Get metrics
        const metrics = require('../../utils/monitoring.cjs');
        const stats = metrics.getMetrics();

        // Should have recorded the large buffer allocation
        expect(stats.counters['memory.large_buffers']).toBe(1);
    });

    it('should handle cleanup process', async () => {
        // Mock global.gc
        global.gc = jest.fn();

        await memoryManager.cleanup();

        // Should have called gc
        expect(global.gc).toHaveBeenCalled();

        // Get metrics
        const metrics = require('../../utils/monitoring.cjs');
        const stats = metrics.getMetrics();

        // Should have timing data for cleanup
        expect(stats.timings['memory.cleanup.duration']).toBeDefined();

        // Cleanup
        delete global.gc;
    });

    it('should detect external memory changes', () => {
        // Mock the metrics increment function
        const metrics = require('../../utils/monitoring.cjs');
        const originalIncrement = metrics.increment;
        let spikeDetected = false;

        metrics.increment = (metric) => {
            if (metric === 'memory.external_spikes') {
                spikeDetected = true;
            }
        };

        // Simulate memory change detection
        const memUsage = process.memoryUsage();
        memoryManager.monitorExternalMemory();

        // Trigger a memory spike manually
        const delta = 6 * 1024 * 1024; // 6MB change (above 5MB threshold)
        memoryManager.checkExternalMemoryChange(memUsage.external + delta);

        // Restore original increment function
        metrics.increment = originalIncrement;

        // Verify spike was detected
        expect(spikeDetected).toBe(true);
    });
}); 