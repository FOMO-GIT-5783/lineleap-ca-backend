const VenueAwareBreaker = require('../../utils/circuitBreaker.cjs');
const optimizationManagerMock = require('../mocks/optimizationManager.mock.cjs');
const webSocketMonitorMock = require('../mocks/websocketMonitor.mock.cjs');

// Mock dependencies
jest.mock('../../utils/optimizationManager.cjs', () => optimizationManagerMock);
jest.mock('../../utils/websocketMonitor.cjs', () => webSocketMonitorMock);

describe('VenueAwareBreaker Integration Tests', () => {
    const venueId = 'test-venue-123';
    let breaker;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Initialize breaker
        breaker = new VenueAwareBreaker({
            service: 'stripe',
            venueId,
            optimizationManager: optimizationManagerMock,
            wsMonitor: webSocketMonitorMock,
            options: {
                failureThreshold: 2,
                resetTimeout: 1000,
                maxHalfOpenAttempts: 3
            }
        });

        // Default mock responses
        webSocketMonitorMock.getVenueMetrics.mockResolvedValue({
            connections: 30,
            messageRate: 50
        });
    });

    describe('Circuit State Management', () => {
        test('starts in closed state', () => {
            expect(breaker.getState().state).toBe('CLOSED');
        });

        test('opens after failures', async () => {
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            
            // First failure
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            expect(breaker.getState().state).toBe('CLOSED');
            
            // Second failure - should open circuit
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            expect(breaker.getState().state).toBe('OPEN');
            
            // Verify optimization manager called
            expect(optimizationManagerMock.handleBreakerOpen)
                .toHaveBeenCalledWith(venueId);
        });

        test('transitions to half-open after timeout', async () => {
            // Force circuit open
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            
            // Wait for reset timeout
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Next execution should be in half-open state
            const state = breaker.getState();
            expect(state.state).toBe('HALF_OPEN');
            expect(state.halfOpenAttempts).toBe(0);
        });
    });

    describe('Optimization Integration', () => {
        test('notifies optimization manager on state changes', async () => {
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            
            // Fail until open
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            
            expect(optimizationManagerMock.handleBreakerOpen)
                .toHaveBeenCalledWith(venueId);
            expect(optimizationManagerMock.handleFailure)
                .toHaveBeenCalledWith(venueId, expect.any(Object));
        });

        test('considers venue metrics for decisions', async () => {
            // Mock high traffic scenario
            webSocketMonitorMock.getVenueMetrics.mockResolvedValue({
                connections: 100,
                messageRate: 50
            });
            
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            
            expect(webSocketMonitorMock.getVenueMetrics)
                .toHaveBeenCalledWith(venueId);
        });
    });

    describe('Recovery Behavior', () => {
        test('resets after successful execution', async () => {
            // First get to open state
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            
            // Wait for half-open
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Successful execution
            const successFn = jest.fn().mockResolvedValue('success');
            await breaker.execute(successFn);
            
            const state = breaker.getState();
            expect(state.state).toBe('CLOSED');
            expect(state.failures).toBe(0);
            expect(optimizationManagerMock.handleServiceRecovery)
                .toHaveBeenCalledWith(venueId, 'stripe');
        });

        test('limits half-open attempts', async () => {
            // Get to open state
            const failingFn = jest.fn().mockRejectedValue(new Error('test error'));
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            await expect(breaker.execute(failingFn)).rejects.toThrow();
            
            // Wait for half-open
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Fail max half-open attempts
            for (let i = 0; i < 3; i++) {
                await expect(breaker.execute(failingFn)).rejects.toThrow();
            }
            
            const state = breaker.getState();
            expect(state.state).toBe('OPEN');
            expect(state.halfOpenAttempts).toBe(3);
        });
    });
}); 