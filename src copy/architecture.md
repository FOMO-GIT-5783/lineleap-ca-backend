# System Architecture Documentation

## Service Architecture

The system has been refactored to follow single responsibility and dependency injection principles. Here's the breakdown:

### Core Services

1. **WebSocketMonitor**
   - Main service coordinating WebSocket operations
   - Composed of three sub-services:
     - VenueMonitor: Tracks venue-specific metrics
     - OptimizationAdvisor: Manages optimization decisions
     - ConnectionManager: Handles WebSocket connections

2. **Event System**
   - Central event bus for inter-service communication
   - Handles all async events (connections, metrics, optimizations)

3. **Monitoring Dashboard**
   - Collects and aggregates metrics from all services
   - Provides real-time system health information
   - Exposes metrics through REST API endpoints

### Dependency Management

All services follow a consistent initialization pattern:
```javascript
await service.initialize({
    dependencies: {
        events: eventEmitter,
        // other dependencies...
    }
});
```

### Monitoring Endpoints

1. **General Metrics**
   - `GET /api/monitoring/`
   - Returns all system metrics

2. **Venue-Specific Metrics**
   - `GET /api/monitoring/venue/:venueId`
   - Returns metrics for a specific venue

3. **WebSocket Metrics**
   - `GET /api/monitoring/websocket`
   - Returns WebSocket-specific metrics

### Metrics Structure

```javascript
{
    "status": "success",
    "data": {
        "websocket": {
            "totalConnections": number,
            "activeVenues": number,
            "optimizedVenues": number
        },
        "venues": {
            [venueId]: {
                // venue-specific metrics
                "lastUpdated": timestamp
            }
        },
        "optimizations": {
            [venueId]: {
                "compression": boolean,
                "batching": boolean,
                "level": number,
                "lastUpdated": timestamp
            }
        },
        "connections": {
            [venueId]: {
                "count": number,
                "lastUpdated": timestamp
            }
        },
        "timestamp": timestamp
    }
}
```

### Health Checks

The system includes comprehensive health checks:
- Basic health: `GET /api/health`
- WebSocket health: `GET /api/health/websocket`
- Venue-specific health: `GET /api/health/websocket?venueId=:id`

## Best Practices

1. **Error Handling**
   - All services include graceful degradation
   - Errors are logged with context
   - Services can operate in degraded mode

2. **Monitoring**
   - Real-time metrics collection
   - Per-venue statistics
   - System-wide health monitoring

3. **Performance**
   - Automatic optimization based on load
   - Compression and batching when needed
   - Circuit breaking for external services

## Future Improvements

1. **Testing**
   - Add unit tests for each service
   - Integration tests for service communication
   - Load testing for optimization triggers

2. **Monitoring**
   - Add alerting system
   - Create monitoring dashboards
   - Set up metric persistence

3. **Documentation**
   - Add API documentation
   - Create deployment guides
   - Document configuration options 