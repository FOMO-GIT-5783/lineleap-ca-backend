const optimizationManagerMock = {
    getSettings: jest.fn().mockResolvedValue({
        compressionEnabled: true,
        compressionLevel: 2
    }),
    handleBreakerOpen: jest.fn(),
    handleFailure: jest.fn(),
    handleServiceRecovery: jest.fn(),
    shouldOptimize: jest.fn().mockReturnValue(true),
    handleDatabaseLoad: jest.fn(),
    getOptimizations: jest.fn().mockReturnValue({
        compressionEnabled: true,
        compressionLevel: 2,
        poolMultiplier: 1.5
    }),
    getPoolMultiplier: jest.fn().mockReturnValue(1.5),
    cleanup: jest.fn(),
    enableCompression: jest.fn(),
    enableMessageBatching: jest.fn(),
    processMessage: jest.fn(),
    recordMetric: jest.fn()
};

// Reset all mocks helper
optimizationManagerMock.reset = () => {
    Object.values(optimizationManagerMock)
        .filter(value => typeof value === 'function' && value.mockReset)
        .forEach(mock => mock.mockReset());
    
    // Reset default behaviors
    optimizationManagerMock.getSettings.mockResolvedValue({
        compressionEnabled: true,
        compressionLevel: 2
    });
    optimizationManagerMock.shouldOptimize.mockReturnValue(true);
    optimizationManagerMock.getOptimizations.mockReturnValue({
        compressionEnabled: true,
        compressionLevel: 2,
        poolMultiplier: 1.5
    });
    optimizationManagerMock.getPoolMultiplier.mockReturnValue(1.5);
};

module.exports = optimizationManagerMock; 