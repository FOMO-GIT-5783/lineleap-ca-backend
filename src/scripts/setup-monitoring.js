// Database monitoring configuration
db.adminCommand({
  setParameter: 1,
  slowOpThresholdMs: 100,  // Log operations slower than 100ms
  profileLevel: 1  // Profile slow operations
});

// Create profiling collection with TTL
db.system.profile.createIndex(
  { "ts": 1 },
  { expireAfterSeconds: 86400 }  // Keep profiling data for 24 hours
);

// Set up slow query logging
db.setProfilingLevel(1, { slowms: 100 });

// Create alert configurations
db.createCollection("alerts");
db.alerts.createIndex({ "timestamp": 1 }, { expireAfterSeconds: 604800 });  // 7 days retention

// Alert thresholds
db.alertConfig.insertMany([
  {
    name: "high_latency",
    threshold: 1000,  // ms
    description: "Operations taking longer than 1 second"
  },
  {
    name: "connection_spike",
    threshold: 100,
    description: "Sudden increase in connection count"
  },
  {
    name: "storage_usage",
    threshold: 0.8,  // 80%
    description: "Storage usage above 80%"
  }
]); 