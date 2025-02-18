const ServiceContainer = require('../../utils/serviceContainer.cjs');
const BaseService = require('../../utils/baseService.cjs');
const { SERVICE_STATES } = require('../../utils/baseService.cjs');

// Mock services for testing
class MockBaseService extends BaseService {
    constructor(name) {
        super(name || 'mock-base-service');
        this.initialized = false;
        this.cleanedUp = false;
        this.dependencies = new Map();
    }

    async _init() {
        this.initialized = true;
    }

    async _cleanup() {
        this.cleanedUp = true;
    }

    getHealth() {
        return {
            status: this.initialized ? 'healthy' : 'unhealthy'
        };
    }
}

class MockLegacyService {
    constructor(config = {}) {
        this.config = config;
        this._initialized = false;
        this._cleanedUp = false;
    }

    get initialized() {
        return this._initialized;
    }

    get cleanedUp() {
        return this._cleanedUp;
    }

    async initialize(deps = {}) {
        this._initialized = true;
        this.dependencies = deps;
    }

    async cleanup() {
        this._cleanedUp = true;
    }
}

class MockDependentService extends BaseService {
    constructor() {
        super('dependent-service');
        this.dependencies = new Map();
        this.dependencies.set('mock-base-service', null);
        this.initialized = false;
    }

    async _init() {
        const dependency = this.getDependency('mock-base-service');
        if (!dependency) {
            throw new Error('Required dependency not found');
        }
        this.initialized = true;
    }
}

describe('ServiceContainer', () => {
    let container;

    beforeEach(() => {
        container = new ServiceContainer();
    });

    afterEach(async () => {
        await container.cleanup();
    });

    describe('Service Registration', () => {
        it('should register BaseService instances correctly', () => {
            const service = container.register('test', MockBaseService);
            
            expect(service).toBeInstanceOf(MockBaseService);
            expect(container.states.get('test')).toBe(SERVICE_STATES.UNINITIALIZED);
        });

        it('should wrap legacy services with createService', () => {
            const service = container.register('legacy', MockLegacyService);
            
            expect(service.execute).toBeDefined();
            expect(service.executeWithRetry).toBeDefined();
            expect(container.states.get('legacy')).toBe(SERVICE_STATES.UNINITIALIZED);
        });

        it('should return existing service if already registered', () => {
            const service1 = container.register('test', MockBaseService);
            const service2 = container.register('test', MockBaseService);
            
            expect(service1).toBe(service2);
        });

        it('should handle registration errors gracefully', () => {
            class ErrorService extends BaseService {
                constructor() {
                    throw new Error('Service creation failed');
                }
            }

            expect(() => {
                container.register('error', ErrorService);
            }).toThrow('Service creation failed');
        });
    });

    describe('Service Initialization', () => {
        it('should initialize all registered services', async () => {
            const baseService = container.register('base', MockBaseService);
            const legacyService = container.register('legacy', MockLegacyService);
            
            await container.initialize();
            
            expect(baseService.initialized).toBe(true);
            expect(legacyService.initialized).toBe(true);
            expect(container.states.get('base')).toBe(SERVICE_STATES.READY);
            expect(container.states.get('legacy')).toBe(SERVICE_STATES.READY);
        });

        it('should handle initialization errors', async () => {
            class FailingService extends BaseService {
                constructor() {
                    super('failing');
                    this.dependencies = new Map();
                }

                async _init() {
                    throw new Error('Initialization failed');
                }
            }

            container.register('failing', FailingService);
            
            await expect(container.initialize()).rejects.toThrow('Initialization failed');
            expect(container.states.get('failing')).toBe(SERVICE_STATES.FAILED);
        });

        it('should initialize services with dependencies', async () => {
            const baseService = container.register('mock-base-service', MockBaseService);
            const dependent = container.register('dependent', MockDependentService);
            
            await container.initialize();
            
            expect(dependent.initialized).toBe(true);
            expect(container.states.get('dependent')).toBe(SERVICE_STATES.READY);
        });

        it('should fail if dependency is missing', async () => {
            container.register('dependent', MockDependentService);
            
            await expect(container.initialize()).rejects.toThrow(
                'Required dependency mock-base-service not found for dependent'
            );
        });
    });

    describe('Service Retrieval', () => {
        it('should get initialized service', async () => {
            container.register('test', MockBaseService);
            await container.initialize();
            
            const service = container.getService('test');
            expect(service).toBeInstanceOf(MockBaseService);
        });

        it('should throw if service not found', () => {
            expect(() => {
                container.getService('nonexistent');
            }).toThrow('Service nonexistent not found');
        });

        it('should throw if service not ready', () => {
            container.register('test', MockBaseService);
            
            expect(() => {
                container.getService('test');
            }).toThrow('Service test is not ready');
        });
    });

    describe('Service Cleanup', () => {
        it('should cleanup all services in reverse order', async () => {
            const baseService = container.register('base', MockBaseService);
            const legacyService = container.register('legacy', MockLegacyService);
            
            await container.initialize();
            await container.cleanup();
            
            expect(baseService.cleanedUp).toBe(true);
            expect(legacyService.cleanedUp).toBe(true);
            expect(container.services.size).toBe(0);
            expect(container.states.size).toBe(0);
        });

        it('should handle cleanup errors gracefully', async () => {
            class ErrorService extends BaseService {
                constructor() {
                    super('error');
                    this.dependencies = new Map();
                }

                async _init() {
                    // Empty init to avoid not implemented error
                }

                async _cleanup() {
                    throw new Error('Cleanup failed');
                }
            }

            container.register('error', ErrorService);
            await container.initialize();
            
            // Should not throw
            await container.cleanup();
            
            expect(container.services.size).toBe(0);
            expect(container.states.size).toBe(0);
        });
    });

    describe('Health Checks', () => {
        it('should report container health status', async () => {
            container.register('test', MockBaseService);
            await container.initialize();
            
            const health = container.getHealth();
            
            expect(health.services).toHaveLength(1);
            expect(health.services[0]).toEqual({
                name: 'test',
                state: SERVICE_STATES.READY,
                health: { status: 'healthy' }
            });
            expect(health.environment).toBe(process.env.NODE_ENV);
        });

        it('should handle services without health check', async () => {
            container.register('legacy', MockLegacyService);
            await container.initialize();
            
            const health = container.getHealth();
            
            expect(health.services[0].health).toBe('unknown');
        });
    });
});