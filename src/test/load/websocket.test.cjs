const WebSocketMonitor = require('../../utils/websocketMonitor.cjs');
const OptimizationManager = require('../../utils/optimizationManager.cjs');
const { mockIO, mockSocket } = require('../mocks/socket.mock.cjs');

// Helper to simulate connections and load
async function simulateVenueLoad(venueId, config) {
    const {
        connections = 100,
        messageRate = 10,
        duration = 60000, // 1 minute default
        messageSize = 100 // bytes
    } = config;

    const io = mockIO();
    const sockets = [];

    // Create connections
    for (let i = 0; i < connections; i++) {
        const socket = mockSocket(`${venueId}-socket-${i}`);
        await socket.join(`venue:${venueId}`);
        sockets.push(socket);
    }

    // Simulate message traffic
    const startTime = Date.now();
    const messageInterval = 1000 / messageRate;
    
    while (Date.now() - startTime < duration) {
        sockets.forEach(async (socket) => {
            const message = {
                id: Date.now(),
                data: 'x'.repeat(messageSize),
                type: 'test'
            };
            await OptimizationManager.processMessage(venueId, message);
        });
        
        await new Promise(resolve => setTimeout(resolve, messageInterval));
    }

    return WebSocketMonitor.trackVenue(venueId);
}

describe('Halifax Venue Load Tests', () => {
    beforeEach(() => {
        WebSocketMonitor.metrics.clear();
        OptimizationManager.optimizations.clear();
    });

    test('Single Venue Peak Load', async () => {
        const venueId = 'halifax-venue-1';
        
        const metrics = await simulateVenueLoad(venueId, {
            connections: 200,    // Peak venue capacity
            messageRate: 50,     // Messages per second
            duration: 300000,    // 5 minutes
            messageSize: 1024    // 1KB messages
        });

        expect(metrics.connections).toBeLessThanOrEqual(250);
        expect(metrics.messageRate).toBeLessThanOrEqual(60);
        expect(metrics.latency).toBeLessThanOrEqual(200);
        
        // Verify optimizations were applied
        const optimizations = OptimizationManager.optimizations.get(venueId);
        expect(optimizations.batching).toBeDefined();
        expect(optimizations.compression.enabled).toBe(true);
    }, 360000); // 6 minute timeout

    test('Multi-Venue Concurrent Load', async () => {
        const venues = ['halifax-1', 'halifax-2', 'halifax-3'];
        
        const results = await Promise.all(venues.map(venueId => 
            simulateVenueLoad(venueId, {
                connections: 150,    // Normal venue capacity
                messageRate: 30,     // Messages per second
                duration: 180000,    // 3 minutes
                messageSize: 512     // 512B messages
            })
        ));

        results.forEach((metrics, index) => {
            const venueId = venues[index];
            
            expect(metrics.connections).toBeLessThanOrEqual(200);
            expect(metrics.messageRate).toBeLessThanOrEqual(40);
            expect(metrics.latency).toBeLessThanOrEqual(150);
            
            // Verify optimizations
            const optimizations = OptimizationManager.optimizations.get(venueId);
            expect(optimizations).toBeDefined();
        });
    }, 240000); // 4 minute timeout

    test('Friday Night Rush Scenario', async () => {
        const venueId = 'halifax-peak';
        
        // Simulate gradual ramp-up
        const loads = [
            { connections: 50, messageRate: 10, duration: 60000 },  // First hour
            { connections: 100, messageRate: 20, duration: 60000 }, // Second hour
            { connections: 200, messageRate: 50, duration: 60000 }  // Peak hour
        ];

        for (const load of loads) {
            const metrics = await simulateVenueLoad(venueId, load);
            
            // Verify system handles increased load
            expect(metrics.latency).toBeLessThanOrEqual(200);
            
            // Check optimization progression
            const optimizations = OptimizationManager.optimizations.get(venueId);
            if (load.connections >= 150) {
                expect(optimizations.batching).toBeDefined();
                expect(optimizations.compression.enabled).toBe(true);
            }
        }
    }, 240000); // 4 minute timeout
}); 