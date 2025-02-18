const { clearDatabase } = require('./setup.cjs');

beforeEach(async () => {
    await clearDatabase();
});

// Increase timeout for all tests
jest.setTimeout(30000); 