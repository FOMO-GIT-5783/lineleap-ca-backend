const logger = require('./logger.cjs');

// Simple metrics collection for now
// This can be enhanced later with proper metrics backends
class Metrics {
    constructor() {
        this.counters = new Map();
        this.timings = new Map();
        this.gauges = new Map();
    }

    increment(metric, value = 1) {
        const current = this.counters.get(metric) || 0;
        this.counters.set(metric, current + value);
        logger.debug(`Metric increment: ${metric}`, { value: current + value });
    }

    timing(metric, duration) {
        if (!this.timings.has(metric)) {
            this.timings.set(metric, []);
        }
        const timings = this.timings.get(metric);
        timings.push(duration);
        
        // Keep only last 100 timings
        if (timings.length > 100) {
            timings.shift();
        }

        logger.debug(`Metric timing: ${metric}`, { duration });
    }

    gauge(metric, value) {
        this.gauges.set(metric, value);
        logger.debug(`Metric gauge: ${metric}`, { value });
    }

    getMetric(metric) {
        // Check counters
        if (this.counters.has(metric)) {
            return this.counters.get(metric);
        }

        // Check timings
        if (this.timings.has(metric)) {
            const timings = this.timings.get(metric);
            if (timings.length === 0) return null;

            return {
                avg: timings.reduce((a, b) => a + b, 0) / timings.length,
                min: Math.min(...timings),
                max: Math.max(...timings),
                count: timings.length,
                latest: timings[timings.length - 1]
            };
        }

        // Check gauges
        if (this.gauges.has(metric)) {
            return this.gauges.get(metric);
        }

        return null;
    }

    getMetrics() {
        return {
            counters: Object.fromEntries(this.counters),
            timings: Object.fromEntries(
                Array.from(this.timings.entries()).map(([key, values]) => [
                    key,
                    {
                        avg: values.reduce((a, b) => a + b, 0) / values.length,
                        min: Math.min(...values),
                        max: Math.max(...values),
                        count: values.length
                    }
                ])
            ),
            gauges: Object.fromEntries(this.gauges)
        };
    }

    reset() {
        this.counters.clear();
        this.timings.clear();
        this.gauges.clear();
    }

    getCounters() {
        return Object.fromEntries(this.counters);
    }

    getTimings() {
        return Object.fromEntries(
            Array.from(this.timings.entries()).map(([key, values]) => [
                key,
                {
                    avg: values.reduce((a, b) => a + b, 0) / values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    count: values.length
                }
            ])
        );
    }

    getGauges() {
        return Object.fromEntries(this.gauges);
    }
}

// Export singleton instance
module.exports = new Metrics(); 