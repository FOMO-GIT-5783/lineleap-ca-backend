#!/bin/bash

echo "Starting resilience tests..."

# Function to check metrics endpoint
check_metrics() {
    response=$(curl -s -o /dev/null -w "%{http_code}" localhost:9090/metrics)
    if [ "$response" == "200" ]; then
        echo "✅ Metrics endpoint responding: $response"
        return 0
    else
        echo "❌ Metrics endpoint failed: $response"
        return 1
    fi
}

# Function to check circuit breaker status
check_circuit_breakers() {
    breakers=$(curl -s localhost:9090/metrics | grep circuit_breaker_status)
    if [[ $breakers == *"1"* ]]; then
        echo "✅ Circuit breakers healthy"
        return 0
    else
        echo "❌ Circuit breakers unhealthy"
        return 1
    fi
}

echo "1. Testing basic connectivity..."
check_metrics

echo -e "\n2. Testing API failure recovery..."
docker stop api
echo "API stopped. Waiting 30 seconds..."
sleep 30
check_metrics
docker start api
echo "API restarted. Waiting 10 seconds..."
sleep 10
check_metrics

echo -e "\n3. Testing circuit breaker status..."
check_circuit_breakers

echo -e "\n4. Running load test..."
docker run --rm --network lineleap-monitoring alpine/bombardier -c 100 -d 30s http://api:3000/api/health

echo -e "\nResilience tests completed." 