const webSocketMonitorMock = {
    getVenueMetrics: jest.fn().mockResolvedValue({
        connections: 30,
        messageRate: 20
    }),
    trackVenue: jest.fn(),
    getMessageRate: jest.fn(),
    getOrderVelocity: jest.fn(),
    measureLatency: jest.fn(),
    shouldOptimize: jest.fn(),
    getVenueHistory: jest.fn(),
    recordMetric: jest.fn()
};

// Reset helper
webSocketMonitorMock.reset = function() {
    Object.values(this)
        .filter(value => typeof value === 'function' && value.mockReset)
        .forEach(mock => mock.mockReset());
    
    // Reset default behaviors
    this.getVenueMetrics.mockResolvedValue({
        connections: 30,
        messageRate: 20
    });
};

module.exports = webSocketMonitorMock; 