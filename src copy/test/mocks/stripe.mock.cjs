// Mock Stripe implementation
const stripeMock = {
    paymentIntents: {
        create: jest.fn(),
        list: jest.fn(),
        update: jest.fn()
    },
    refunds: {
        create: jest.fn()
    },
    webhooks: {
        constructEvent: jest.fn()
    },

    // Storage for simulating idempotency
    existingIntents: new Map(),

    // Reset mock state
    reset: () => {
        stripeMock.existingIntents.clear();
        jest.clearAllMocks();
    }
};

module.exports = stripeMock; 