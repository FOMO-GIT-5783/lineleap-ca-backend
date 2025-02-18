#!/bin/bash

echo "Starting comprehensive load testing..."

# Function to check service health
check_health() {
    local service=$1
    local port=$2
    local endpoint=$3
    response=$(curl -s -o /dev/null -w "%{http_code}" localhost:${port}${endpoint})
    echo "Health check ${service}: ${response}"
    return $([ "$response" == "200" ])
}

# Function to monitor resource usage
monitor_resources() {
    local duration=$1
    local interval=5
    local count=$((duration / interval))
    
    echo "Monitoring resources for ${duration} seconds..."
    for ((i=1; i<=count; i++)); do
        echo "=== Resource Usage (${i}/${count}) ==="
        docker stats --no-stream src-api-1 src-metrics-1
        sleep $interval
    done
}

# Function to collect metrics
collect_metrics() {
    echo "Collecting metrics..."
    curl -s localhost:9090/metrics | grep -E 'circuit_breaker_status|http_request_duration_seconds'
}

echo "Phase 1: Baseline Metrics"
collect_metrics

echo -e "\nPhase 2: Light Load (10 concurrent users)"
docker run --rm --network lineleap-monitoring alpine/bombardier -c 10 -d 30s http://api:3000/api/health
collect_metrics

echo -e "\nPhase 3: Medium Load (50 concurrent users)"
docker run --rm --network lineleap-monitoring alpine/bombardier -c 50 -d 30s http://api:3000/api/health
collect_metrics

echo -e "\nPhase 4: Heavy Load (100 concurrent users)"
docker run --rm --network lineleap-monitoring alpine/bombardier -c 100 -d 30s http://api:3000/api/health
collect_metrics

echo -e "\nPhase 5: Spike Test (200 concurrent users, short duration)"
docker run --rm --network lineleap-monitoring alpine/bombardier -c 200 -d 10s http://api:3000/api/health
collect_metrics

echo -e "\nPhase 6: Recovery Period"
echo "Monitoring recovery for 30 seconds..."
monitor_resources 30

echo -e "\nPhase 7: Final Health Check"
check_health "API" 3000 "/api/health"
check_health "Metrics" 9090 "/health"

echo -e "\nLoad testing completed. Check metrics endpoint for detailed performance data." 