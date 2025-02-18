const logger = require('./logger.cjs');
const { SERVICE_STATES } = require('./baseService.cjs');

class ServiceContainer {
    constructor() {
        this.services = new Map();
        this.states = new Map();
        this.initOrder = [];
        
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
            },
            optimization: {
                batchSize: 100,
                compressionThreshold: 1024,
                maxQueueSize: 10000
            }
        };
    }

    /**
     * Initialize services in dependency order
     */
    async initialize(serviceDefinitions) {
        try {
            // Build dependency graph
            const graph = this._buildDependencyGraph(serviceDefinitions);
            
            // Get initialization order
            this.initOrder = this._getInitializationOrder(graph);
            
            // Initialize services in order
            for (const serviceName of this.initOrder) {
                const definition = serviceDefinitions.find(([name]) => name === serviceName);
                if (!definition) {
                    throw new Error(`Service definition not found for ${serviceName}`);
                }
                
                await this.createService(...definition);
            }

            logger.info('Service container initialized successfully', {
                services: this.initOrder,
                environment: process.env.NODE_ENV
            });

            return true;
        } catch (error) {
            logger.error('Service container initialization failed:', error);
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Create a service with dependencies
     */
    async createService(name, ServiceClass, dependencyNames = []) {
        // Return existing service if already initialized
        if (this.services.has(name)) {
            return this.services.get(name);
        }

        try {
            // Resolve dependencies
            const dependencies = this._resolveDependencies(dependencyNames);
            
            let service;
            
            // Handle both BaseService and legacy service instances
            if (typeof ServiceClass.create === 'function') {
                // New BaseService pattern
                service = await ServiceClass.create(
                    dependencies,
                    this.configs[name] || {}
                );
            } else if (typeof ServiceClass === 'function') {
                // Legacy class pattern
                service = new ServiceClass(this.configs[name] || {});
                if (typeof service.initialize === 'function') {
                    await service.initialize(dependencies);
                }
            } else {
                // Direct instance export
                service = ServiceClass;
            }

            // Store service
            this.services.set(name, service);
            this.states.set(name, SERVICE_STATES.READY);

            logger.info(`Service ${name} created successfully`);
            return service;
        } catch (error) {
            this.states.set(name, SERVICE_STATES.FAILED);
            logger.error(`Service ${name} creation failed:`, error);
            throw error;
        }
    }

    /**
     * Get an initialized service
     */
    getService(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service ${name} not found`);
        }
        if (!service.isReady()) {
            throw new Error(`Service ${name} is not ready`);
        }
        return service;
    }

    /**
     * Clean up all services in reverse initialization order
     */
    async cleanup() {
        const cleanupOrder = [...this.initOrder].reverse();
        
        for (const serviceName of cleanupOrder) {
            const service = this.services.get(serviceName);
            if (service?.cleanup) {
                try {
                    await service.cleanup();
                    logger.info(`Service ${serviceName} cleaned up`);
                } catch (error) {
                    logger.error(`Service ${serviceName} cleanup failed:`, error);
                }
            }
        }

        this.services.clear();
        this.states.clear();
        this.initOrder = [];
    }

    /**
     * Build dependency graph for services
     */
    _buildDependencyGraph(definitions) {
        const graph = new Map();
        
        for (const [name, , dependencies] of definitions) {
            graph.set(name, dependencies || []);
        }

        return graph;
    }

    /**
     * Get initialization order using topological sort
     */
    _getInitializationOrder(graph) {
        const visited = new Set();
        const temp = new Set();
        const order = [];

        function visit(name) {
            if (temp.has(name)) {
                throw new Error(`Circular dependency detected: ${name}`);
            }
            if (visited.has(name)) {
                return;
            }
            temp.add(name);
            
            const dependencies = graph.get(name) || [];
            for (const dep of dependencies) {
                visit(dep);
            }
            
            temp.delete(name);
            visited.add(name);
            order.push(name);
        }

        for (const name of graph.keys()) {
            if (!visited.has(name)) {
                visit(name);
            }
        }

        return order;
    }

    /**
     * Resolve service dependencies
     */
    _resolveDependencies(dependencyNames) {
        const dependencies = {};
        
        for (const name of dependencyNames) {
            const dependency = this.services.get(name);
            if (!dependency) {
                throw new Error(`Required dependency ${name} not initialized`);
            }
            if (!dependency.isReady()) {
                throw new Error(`Required dependency ${name} is not ready`);
            }
            dependencies[name] = dependency;
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
                state: service.getHealth(),
                dependencies: service.dependencies ? Array.from(service.dependencies.keys()) : []
            })),
            initializationOrder: this.initOrder,
            environment: process.env.NODE_ENV
        };
    }
}

module.exports = ServiceContainer; 