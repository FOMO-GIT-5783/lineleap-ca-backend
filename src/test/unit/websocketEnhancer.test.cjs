// Create working compression mocks
const mockGzip = jest.fn().mockImplementation((data, callback) => {
    if (callback) {
        callback(null, Buffer.from('compressed'));
        return;
    }
    return Buffer.from('compressed');
});

const mockGunzip = jest.fn().mockImplementation((data, callback) => {
    if (callback) {
        callback(null, Buffer.from('uncompressed'));
        return;
    }
    return Buffer.from('uncompressed');
});

// Mock all required modules before requiring WebSocketEnhancer
jest.mock('zlib', () => ({
    gzip: mockGzip,
    gunzip: mockGunzip
}));

jest.mock('../../utils/optimizationManager.cjs', () => ({
    getSettings: jest.fn().mockResolvedValue({
        compressionEnabled: true,
        compressionLevel: 2
    })
}));

jest.mock('../../utils/websocketMonitor.cjs', () => ({
    getVenueMetrics: jest.fn().mockResolvedValue({ 
        connections: 30,
        messageRate: 20
    }),
    recordMetric: jest.fn()
}));

// Now require the module under test
const WebSocketEnhancer = require('../../utils/websocketEnhancer.cjs');
const webSocketMonitorMock = require('../../utils/websocketMonitor.cjs');
const optimizationManagerMock = require('../../utils/optimizationManager.cjs');

describe('WebSocketEnhancer', () => {
    let enhancer;
    let mockSocket;
    const venueId = 'test-venue';

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockGzip.mockClear();
        mockGunzip.mockClear();
        
        // Reset environment and ensure it's explicitly set
        process.env.ENABLE_WS_COMPRESSION = 'true';

        // Initialize enhancer
        enhancer = new WebSocketEnhancer(webSocketMonitorMock, optimizationManagerMock);

        // Create mock socket
        mockSocket = {
            id: 'test-socket',
            emit: jest.fn().mockImplementation((event, data) => Promise.resolve()),
            on: jest.fn(),
            removeListener: jest.fn()
        };

        // Setup default mock responses
        webSocketMonitorMock.getVenueMetrics.mockResolvedValue({ 
            connections: 30,
            messageRate: 20
        });
        optimizationManagerMock.getSettings.mockResolvedValue({
            compressionEnabled: true,
            compressionLevel: 2
        });
    });

    describe('Gradual WebSocket Compression', () => {
        it('enables compression gradually based on connection count', async () => {
            // Test with low traffic
            webSocketMonitorMock.getVenueMetrics.mockResolvedValueOnce({ 
                connections: 20,
                messageRate: 10
            });
            let socket = await enhancer.enhanceSocket(mockSocket, venueId);
            expect(socket.compressionEnabled).toBe(false);

            // Test with medium traffic
            webSocketMonitorMock.getVenueMetrics.mockResolvedValueOnce({ 
                connections: 35,
                messageRate: 30
            });
            socket = await enhancer.enhanceSocket(mockSocket, venueId);
            expect(socket.compressionEnabled).toBe(true);
            expect(socket.compressionLevel).toBe(1);

            // Test with high traffic
            webSocketMonitorMock.getVenueMetrics.mockResolvedValueOnce({ 
                connections: 100,
                messageRate: 50
            });
            socket = await enhancer.enhanceSocket(mockSocket, venueId);
            expect(socket.compressionEnabled).toBe(true);
            expect(socket.compressionLevel).toBe(2);
        });

        it('respects feature flag for gradual rollout', async () => {
            // Explicitly set flag to false
            process.env.ENABLE_WS_COMPRESSION = 'false';
            
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            
            // Should be disabled regardless of metrics
            expect(socket.compressionEnabled).toBe(false);
            expect(socket.compressionLevel).toBe(0);
            
            // Should not have called metrics
            expect(webSocketMonitorMock.getVenueMetrics).not.toHaveBeenCalled();
        });

        it('maintains metrics format during compression', async () => {
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            
            // Simulate message sending
            const messageData = { type: 'test', data: 'x'.repeat(2000) };
            await socket.emit('test', messageData);

            expect(webSocketMonitorMock.recordMetric).toHaveBeenCalledWith(
                'ws_compression_applied',
                expect.objectContaining({
                    venueId,
                    level: expect.any(Number),
                    socketId: mockSocket.id
                })
            );
        });
    });

    describe('Message Processing', () => {
        it('compresses messages above threshold when enabled', async () => {
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            const largeData = { type: 'test', data: 'x'.repeat(2000) };
            
            await socket.emit('test', largeData);
            
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'test',
                expect.objectContaining({
                    compressed: true,
                    data: expect.any(Buffer)
                })
            );
        });

        it('skips compression for small messages', async () => {
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            const smallData = { type: 'test' };
            
            await socket.emit('test', smallData);
            
            expect(mockSocket.emit).toHaveBeenCalledWith('test', smallData);
        });
    });

    describe('Error Handling', () => {
        it('handles compression errors gracefully', async () => {
            // Setup socket with compression enabled
            webSocketMonitorMock.getVenueMetrics.mockResolvedValue({ 
                connections: 100,
                messageRate: 50
            });
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            
            // Mock compression failure
            mockGzip.mockImplementationOnce(() => {
                throw new Error('Compression failed');
            });
            
            // Send large message that should trigger compression
            const largeData = { type: 'test', data: 'x'.repeat(2000) };
            await socket.emit('test', largeData);
            
            // Should have recorded error metric
            expect(webSocketMonitorMock.recordMetric).toHaveBeenCalledWith(
                'ws_error',
                expect.objectContaining({
                    venueId,
                    error: 'Compression failed'
                })
            );
            
            // Should have fallen back to uncompressed data
            expect(mockSocket.emit).toHaveBeenCalledWith('test', largeData);
        });

        it('logs compression errors for monitoring', async () => {
            const socket = await enhancer.enhanceSocket(mockSocket, venueId);
            const error = new Error('Test error');
            
            // Trigger error handler
            const errorHandler = mockSocket.on.mock.calls.find(
                call => call[0] === 'error'
            )[1];
            await errorHandler(error);

            expect(webSocketMonitorMock.recordMetric).toHaveBeenCalledWith(
                'ws_error',
                expect.objectContaining({
                    venueId,
                    error: error.message
                })
            );
        });
    });
}); 