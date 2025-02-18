const logger = require('./logger.cjs');
const createService = require('./createService.cjs');
const { SERVICE_STATES } = require('./baseService.cjs');

class ServiceContainer {
    constructor() {
        this.services = new Map();
        this.states = new Map();
        
        // Core service configurations
        this.configs = {
            cache: {
                maxSize: process.env.NODE_ENV === 'production' ? 100000 : 10000,
                ttl: 60 * 60 * 1000 // 1 hour
            },
            redis: {
                url: process.env.REDIS_URL,
                keyPrefix: process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
            },
            websocket: {
                pingInterval: 25000,
                pingTimeout: 60000,
                maxConnections: process.env.NODE_ENV === 'production' ? 1000 : 100
            }
        };
    }

    /**
     * Register a service with the container
     */
    register(name, ServiceClass, dependencies = []) {
        if (this.services.has(name)) {
            return this.services.get(name);
        }

        try {
            let service;

            // Handle different service types
            if (ServiceClass.prototype instanceof require('./baseService.cjs')) {
                // BaseService instance - use as is
                service = new ServiceClass(name);
            } else {
                // Create legacy service instance
                const legacyInstance = new ServiceClass(this.configs[name] || {});
                
                // Wrap with service functionality
                service = createService(name, this.configs[name] || {});
                
                // Copy methods and properties
                Object.assign(service, legacyInstance);
                
                // Ensure initialize and cleanup are preserved
                if (typeof legacyInstance.initialize === 'function') {
                    service.initialize = async (deps) => {
                        await legacyInstance.initialize(deps);
                        service.initialized = legacyInstance.initialized;
                        return service;
                    };
                }
                
                if (typeof legacyInstance.cleanup === 'function') {
                    service.cleanup = async () => {
                        await legacyInstance.cleanup();
                        service.cleanedUp = legacyInstance.cleanedUp;
                    };
                }
            }

            // Store service
            this.services.set(name, service);
            this.states.set(name, SERVICE_STATES.UNINITIALIZED);

            logger.info(`Service ${name} registered`);
            return service;
        } catch (error) {
            logger.error(`Service ${name} registration failed:`, error);
            throw error;
        }
    }

    /**
     * Initialize registered services
     */
    async initialize() {
        const services = Array.from(this.services.entries());

        for (const [name, service] of services) {
            try {
                this.states.set(name, SERVICE_STATES.INITIALIZING);

                // Initialize if service has initialize method
                if (typeof service.initialize === 'function') {
                    await service.initialize({
                        dependencies: this._resolveDependencies(name)
                    });
                }

                this.states.set(name, SERVICE_STATES.READY);
                logger.info(`Service ${name} initialized`);

            } catch (error) {
                this.states.set(name, SERVICE_STATES.FAILED);
                logger.error(`Service ${name} initialization failed:`, error);
                throw error;
            }
        }

        logger.info('Service container initialized');
        return true;
    }

    /**
     * Get an initialized service
     */
    getService(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service ${name} not found`);
        }
        if (this.states.get(name) !== SERVICE_STATES.READY) {
            throw new Error(`Service ${name} is not ready`);
        }
        return service;
    }

    /**
     * Clean up all services
     */
    async cleanup() {
        const services = Array.from(this.services.entries()).reverse();
        
        for (const [name, service] of services) {
            try {
                if (typeof service.cleanup === 'function') {
                    await service.cleanup();
                }
                logger.info(`Service ${name} cleaned up`);
            } catch (error) {
                logger.error(`Service ${name} cleanup failed:`, error);
            }
        }

        this.services.clear();
        this.states.clear();
    }

    /**
     * Resolve service dependencies
     */
    _resolveDependencies(serviceName) {
        const dependencies = {};
        const service = this.services.get(serviceName);

        if (!service.dependencies) {
            return dependencies;
        }

        // Handle both Map and array dependencies
        const deps = service.dependencies instanceof Map ? 
            Array.from(service.dependencies.keys()) : 
            service.dependencies;

        for (const depName of deps) {
            const dependency = this.services.get(depName);
            if (!dependency) {
                throw new Error(`Required dependency ${depName} not found for ${serviceName}`);
            }
            if (this.states.get(depName) !== SERVICE_STATES.READY) {
                throw new Error(`Required dependency ${depName} is not ready for ${serviceName}`);
            }
            dependencies[depName] = dependency;
        }

        return dependencies;
    }

    /**
     * Get container health status
     */
    getHealth() {
        return {
            services: Array.from(this.services.entries()).map(([name, service]) => ({
                name,
                state: this.states.get(name),
                health: typeof service.getHealth === 'function' ? 
                    service.getHealth() : 'unknown'
            })),
            environment: process.env.NODE_ENV
        };
    }
}

module.exports = ServiceContainer; 