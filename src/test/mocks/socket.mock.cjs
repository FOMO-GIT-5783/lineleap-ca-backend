// Singleton instance
let mockIOInstance = null;

class MockSocket {
    constructor(id) {
        this.id = id;
        this.rooms = new Set();
        this.events = new Map();
    }

    join(room) {
        this.rooms.add(room);
    }

    leave(room) {
        this.rooms.delete(room);
    }

    on(event, handler) {
        this.events.set(event, handler);
    }

    emit(event, data) {
        if (event === 'ping') {
            // Immediate response for health checks
            const handler = this.events.get('pong');
            if (handler) handler();
        }
    }
}

class MockIO {
    constructor() {
        this.sockets = {
            adapter: {
                rooms: new Map(),
                sids: new Map()
            }
        };
        this.stats = new Map();
        this.cleanupCallbacks = new Set();
    }

    simulateLoad(room, metrics) {
        // Update room connections
        const sockets = new Set();
        for (let i = 0; i < metrics.connections; i++) {
            sockets.add(`${room}-socket-${i}`);
        }
        this.sockets.adapter.rooms.set(room, sockets);

        // Store metrics
        this.stats.set(room, {
            connections: metrics.connections || 0,
            messageRate: metrics.messageRate || 0,
            latency: metrics.latency || 0,
            messageCount: (metrics.messageRate || 0) * 60, // Last minute's worth
            orderCount: Math.floor((metrics.messageRate || 0) * 0.1) // ~10% are orders
        });
    }

    getStats(room) {
        return this.stats.get(room) || {
            connections: 0,
            messageRate: 0,
            latency: 0,
            messageCount: 0,
            orderCount: 0
        };
    }

    socket(id) {
        const socket = new MockSocket(id);
        this.sockets.adapter.sids.set(id, new Set([id]));
        return socket;
    }

    to(room) {
        return {
            emit: (event, data) => {
                // For ping events, respond immediately in test environment
                if (event === 'ping' && typeof data === 'function') {
                    data();
                }
            }
        };
    }

    // Cleanup method for tests
    cleanup() {
        this.sockets.adapter.rooms.clear();
        this.sockets.adapter.sids.clear();
        this.stats.clear();
        this.cleanupCallbacks.forEach(callback => callback());
        this.cleanupCallbacks.clear();
    }

    // Register cleanup callbacks
    onCleanup(callback) {
        this.cleanupCallbacks.add(callback);
    }
}

const mockSocket = (id = 'test-socket') => {
    return mockIOInstance.socket(id);
};

const mockIO = () => {
    if (!mockIOInstance) {
        mockIOInstance = new MockIO();
    }
    return mockIOInstance;
};

const resetMockIO = () => {
    if (mockIOInstance) {
        mockIOInstance.cleanup();
    }
    mockIOInstance = new MockIO();
};

module.exports = {
    mockSocket,
    mockIO,
    resetMockIO
}; 