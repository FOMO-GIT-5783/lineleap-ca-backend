// Users Collection Indexes
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "auth0Id": 1 }, { unique: true, sparse: true });
db.users.createIndex({ "managedVenues": 1 });
db.users.createIndex({ "role": 1 });

// Venues Collection Indexes
db.venues.createIndex({ "location.city": 1 });
db.venues.createIndex({ "name": 1 });
db.venues.createIndex({ "type": 1 });
db.venues.createIndex({ "trendingScore": -1 });
db.venues.createIndex({ "passes.available": 1 });

// Orders Collection Indexes
db.orders.createIndex({ "userId": 1, "createdAt": -1 });
db.orders.createIndex({ "venueId": 1, "createdAt": -1 });
db.orders.createIndex({ "status": 1 });
db.orders.createIndex({ "reference": 1 }, { unique: true });

// Passes Collection Indexes
db.passes.createIndex({ "userId": 1, "status": 1 });
db.passes.createIndex({ "venueId": 1, "status": 1 });
db.passes.createIndex({ "expiryDate": 1 });
db.passes.createIndex({ "passId": 1 }, { unique: true });

// Metrics Collection Indexes
db.metrics.createIndex({ "venueId": 1, "timestamp": -1 });
db.metrics.createIndex({ "type": 1, "timestamp": -1 });
db.metrics.createIndex({ "venueId": 1, "type": 1, "timestamp": -1 }); 