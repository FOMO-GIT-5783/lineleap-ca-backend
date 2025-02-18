const WebSocketMonitor = require('../../utils/websocketMonitor.cjs');
const OptimizationManager = require('../../utils/optimizationManager.cjs');
const { mockSocket, mockIO, resetMockIO } = require('../mocks/socket.mock.cjs');

// Mock the io.cjs module
jest.mock('../../utils/io.cjs', () => ({
    getIO: () => mockIO()
}));

describe('Halifax Venue WebSocket Monitor', () => {
    beforeEach(() => {
        resetMockIO();
        WebSocketMonitor.metrics.clear();
        OptimizationManager.optimizations.clear();
    });

    test('stays normal under light load', async () => {
        const venueId = 'halifax-downtown-1';
        const io = mockIO();
        
        io.simulateLoad(`venue:${venueId}`, {
            connections: 100  // Normal crowd
        });
        
        const result = await WebSocketMonitor.trackVenue(venueId);
        
        expect(result.state).toBe('normal');
        expect(result.connections).toBe(100);
        
        // No optimizations needed
        const optimizations = OptimizationManager.optimizations.get(venueId);
        expect(optimizations).toBeUndefined();
    });

    test('enables basic optimizations under heavy load', async () => {
        const venueId = 'halifax-downtown-2';
        const io = mockIO();
        
        io.simulateLoad(`venue:${venueId}`, {
            connections: 175  // Busy night
        });
        
        const result = await WebSocketMonitor.trackVenue(venueId);
        
        expect(result.state).toBe('warning');
        expect(result.connections).toBe(175);
        
        // Should enable message batching
        const optimizations = OptimizationManager.optimizations.get(venueId);
        expect(optimizations.batching).toBeDefined();
        expect(optimizations.compression).toBeUndefined();
    });

    test('enables full optimizations under critical load', async () => {
        const venueId = 'halifax-downtown-3';
        const io = mockIO();
        
        io.simulateLoad(`venue:${venueId}`, {
            connections: 250  // Packed venue
        });
        
        const result = await WebSocketMonitor.trackVenue(venueId);
        
        expect(result.state).toBe('critical');
        expect(result.connections).toBe(250);
        
        // Should enable all optimizations
        const optimizations = OptimizationManager.optimizations.get(venueId);
        expect(optimizations.batching).toBeDefined();
        expect(optimizations.compression.enabled).toBe(true);
    });
});

describe('Optimization Manager', () => {
    beforeEach(() => {
        resetMockIO();
        OptimizationManager.cleanup('test-venue');
    });

    test('batches messages correctly', async () => {
        const venueId = 'test-venue';
        await OptimizationManager.enableMessageBatching(venueId);
        
        // Send multiple messages
        for (let i = 0; i < 50; i++) {
            await OptimizationManager.processMessage(venueId, { id: i });
        }
        
        const queue = OptimizationManager.messageQueues.get(venueId);
        expect(queue.length).toBeLessThanOrEqual(100);
    });

    test('compresses large payloads', async () => {
        const venueId = 'test-venue';
        await OptimizationManager.enableCompression(venueId);
        
        const largeMessage = { data: 'x'.repeat(2000) };
        await OptimizationManager.processMessage(venueId, largeMessage);
        
        const optimizations = OptimizationManager.optimizations.get(venueId);
        expect(optimizations.compression.enabled).toBe(true);
    });

    test('cleans up resources properly', () => {
        const venueId = 'test-venue';
        
        OptimizationManager.enableMessageBatching(venueId);
        OptimizationManager.cleanup(venueId);
        
        expect(OptimizationManager.messageQueues.has(venueId)).toBe(false);
        expect(OptimizationManager.optimizations.has(venueId)).toBe(false);
        expect(OptimizationManager.flushIntervals.has(venueId)).toBe(false);
    });
}); 