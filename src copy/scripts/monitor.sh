#!/bin/bash

# Configuration
METRICS_INTERVAL=60  # seconds
ALERT_THRESHOLD_LATENCY=2.5  # seconds
ALERT_THRESHOLD_MEMORY=80    # percent
MAX_RESTART_ATTEMPTS=3
RESTART_COOLDOWN=300  # 5 minutes
LOG_FILE="monitoring.log"
RESTART_TRACKING_FILE="/tmp/lineleap_restarts.txt"

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Initialize log file
echo "=== Monitoring Started $(date) ===" > $LOG_FILE
touch $RESTART_TRACKING_FILE

log_message() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a $LOG_FILE
}

get_restart_count() {
    local container=$1
    grep "^${container}:" $RESTART_TRACKING_FILE | cut -d: -f2 || echo "0"
}

get_last_restart() {
    local container=$1
    grep "^${container}:" $RESTART_TRACKING_FILE | cut -d: -f3 || echo "0"
}

update_restart_tracking() {
    local container=$1
    local count=$2
    local timestamp=$3
    local temp_file=$(mktemp)
    grep -v "^${container}:" $RESTART_TRACKING_FILE > $temp_file
    echo "${container}:${count}:${timestamp}" >> $temp_file
    mv $temp_file $RESTART_TRACKING_FILE
}

check_container_health() {
    local container=$1
    local current_time=$(date +%s)
    
    if ! docker ps -a | grep -q $container; then
        log_message "${RED}ALERT" "Container $container does not exist"
        return 1
    fi

    local state=$(docker inspect -f '{{.State.Status}}' $container 2>/dev/null)
    
    if [[ "$state" != "running" ]]; then
        local restart_count=$(get_restart_count $container)
        local last_restart=$(get_last_restart $container)
        local time_since_restart=$((current_time - last_restart))
        
        if [ "$restart_count" -lt $MAX_RESTART_ATTEMPTS ]; then
            if [ $time_since_restart -gt $RESTART_COOLDOWN ]; then
                log_message "${YELLOW}WARN" "Attempting to restart $container (Attempt $((restart_count + 1))/$MAX_RESTART_ATTEMPTS)"
                
                if docker start $container; then
                    update_restart_tracking $container $((restart_count + 1)) $current_time
                    log_message "${GREEN}INFO" "Successfully restarted $container"
                    sleep 5
                    
                    if [[ $(docker inspect -f '{{.State.Running}}' $container) == "true" ]]; then
                        log_message "${GREEN}INFO" "Container $container is now running"
                    else
                        log_message "${RED}ALERT" "Container $container failed to start properly"
                    fi
                else
                    log_message "${RED}ALERT" "Failed to restart $container"
                fi
            else
                log_message "${YELLOW}WARN" "Container $container down, in cooldown period ($time_since_restart < $RESTART_COOLDOWN seconds)"
            fi
        else
            log_message "${RED}ALERT" "Container $container failed after $MAX_RESTART_ATTEMPTS attempts. Manual intervention required."
            return 1
        fi
    else
        if [ "$(get_restart_count $container)" != "0" ]; then
            update_restart_tracking $container 0 0
            log_message "${GREEN}INFO" "Reset restart counter for $container - running stable"
        fi
    fi
}

check_metrics() {
    local metrics=$(curl -s localhost:9090/metrics)
    if [ -z "$metrics" ]; then
        log_message "${RED}ALERT" "Failed to fetch metrics"
        return 1
    fi
    
    if echo "$metrics" | grep -E '^circuit_breaker_status.*} 0' > /dev/null; then
        local service=$(echo "$metrics" | grep -E '^circuit_breaker_status.*} 0' | sed -E 's/.*service="([^"]+)".*/\1/')
        if [ ! -z "$service" ]; then
            log_message "${RED}ALERT" "Circuit breaker OPEN for service: ${service}"
            
            case $service in
                "stripe")
                    check_container_health "src-api-1"
                    ;;
                "database")
                    check_container_health "src-metrics-1"
                    ;;
            esac
        fi
    else
        log_message "${GREEN}INFO" "Circuit breakers healthy"
    fi
    
    local latency=$(echo "$metrics" | grep -E '^http_request_duration_seconds.*le="2.5"' | awk '{print $2}' || echo "0")
    if [ ! -z "$latency" ] && [ "$latency" != "0" ]; then
        if (( $(echo "$latency > $ALERT_THRESHOLD_LATENCY" | bc -l) )); then
            log_message "${YELLOW}WARN" "High latency detected: ${latency}s"
        else
            log_message "${GREEN}INFO" "Latency normal: ${latency}s"
        fi
    fi
}

monitor_resources() {
    check_container_health "src-api-1"
    check_container_health "src-metrics-1"
    
    local stats=$(docker stats --no-stream src-api-1 src-metrics-1)
    
    echo "$stats" | tail -n +2 | while read -r line; do
        local container_name=$(echo "$line" | awk '{print $2}')
        local cpu_usage=$(echo "$line" | awk '{print $3}' | sed 's/%//')
        local mem_usage=$(echo "$line" | awk '{print $7}' | sed 's/%.*//')
        
        if [ ! -z "$mem_usage" ]; then
            if (( $(echo "$mem_usage > $ALERT_THRESHOLD_MEMORY" | bc -l) )); then
                log_message "${RED}ALERT" "High memory usage for ${container_name}: Memory ${mem_usage}%, CPU ${cpu_usage}%"
            else
                log_message "${GREEN}INFO" "Memory usage for ${container_name}: Memory ${mem_usage}%, CPU ${cpu_usage}%"
            fi
        fi
    done
}

cleanup() {
    echo -e "\nMonitoring stopped. Check $LOG_FILE for details."
    rm -f $RESTART_TRACKING_FILE
    exit 0
}
trap cleanup INT

# Handle test mode
if [ "$1" = "--test" ]; then
    log_message "${GREEN}INFO" "Running in test mode..."
    check_metrics
    monitor_resources
    exit 0
fi

log_message "${GREEN}INFO" "Starting continuous monitoring..."
log_message "${GREEN}INFO" "Monitoring circuit breakers, latency, and resources..."

while true; do
    check_metrics
    monitor_resources
    sleep $METRICS_INTERVAL
done 