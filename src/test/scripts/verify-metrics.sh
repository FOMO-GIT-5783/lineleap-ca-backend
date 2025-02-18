#!/bin/bash

# 1. Basic connectivity
curl -sI http://localhost:9090/metrics | grep "200 OK" || exit 1

# 2. Metric validation
METRIC_COUNT=$(curl -s http://localhost:9090/metrics | grep -v '#' | wc -l)
(( METRIC_COUNT > 15 )) || {
    echo "Insufficient metrics: $METRIC_COUNT"
    exit 2
}

# 3. Circuit breaker status
curl -s http://localhost:9090/metrics | grep 'circuit_breaker_status' || {
    echo "Missing circuit breaker metrics"
    exit 3
}

echo "All metrics checks passed" 