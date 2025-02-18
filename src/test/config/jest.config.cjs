module.exports = {
    testEnvironment: 'node',
    moduleFileExtensions: ['js', 'cjs'],
    testMatch: [
        '**/test/unit/**/*.test.cjs',
        '**/test/smoke/**/*.cjs'
    ],
    verbose: true,
    collectCoverage: true,
    coverageDirectory: 'test/coverage',
    coverageReporters: ['text', 'lcov'],
    transform: {},
    testTimeout: 30000,
    roots: ['<rootDir>/../'],
    globalSetup: '<rootDir>/setup.cjs',
    globalTeardown: '<rootDir>/setup.cjs',
    setupFilesAfterEnv: ['<rootDir>/setupAfterEnv.cjs']
}; 