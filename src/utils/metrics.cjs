// Nightlife-specific utility functions for metrics

/**
 * Check if current time is within peak hours (8PM-3AM)
 */
export function isPeakHour() {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 3; // 8PM-3AM venue hours
}

/**
 * Get surge multiplier based on peak hours
 */
export function getSurgeMultiplier() {
  return isPeakHour() ? 1.5 : 1.0;
}

/**
 * Validate metric type against allowed types
 */
export function validateMetricType(type) {
  const validTypes = Object.values(FOMO_METRIC_TYPES)
    .flatMap(c => Object.values(c));
  
  return validTypes.includes(type);
}

/**
 * Get time window for metric queries
 * @param {string} window - One of: 'realtime', 'hourly', 'daily', 'weekly'
 */
export function getTimeWindow(window) {
  const now = new Date();
  switch (window) {
    case 'realtime':
      return new Date(now - 5 * 60 * 1000); // Last 5 minutes
    case 'hourly':
      return new Date(now - 60 * 60 * 1000); // Last hour
    case 'daily':
      return new Date(now - 24 * 60 * 60 * 1000); // Last 24 hours
    case 'weekly':
      return new Date(now - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    default:
      throw new Error(`Invalid time window: ${window}`);
  }
} 