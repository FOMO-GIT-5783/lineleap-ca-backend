const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/authMiddleware.cjs');
const { validateVenue } = require('../middleware/validationMiddleware.cjs');
const Venue = require('../models/Venue.cjs');
const User = require('../models/User.cjs');
const { getMigrationStats } = require('../middleware/metricsProxy.cjs');

// Apply admin check to all routes
router.use(requireAdmin());

// Get all venues (admin view)
router.get('/venues', async (req, res) => {
    try {
        const venues = await Venue.find().sort({ createdAt: -1 });
        res.json(venues);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new venue
router.post('/venues', validateVenue, async (req, res) => {
    try {
      // Validate required fields
      const requiredFields = [
        'name', 
        'type', 
        'music', 
        'image', 
        'maxCapacity', 
        'passes.price',
        'location.address',
        'location.city',
        'location.province',
        'location.postalCode',
        'operatingHours.open',
        'operatingHours.close',
        'operatingHours.daysOpen'
      ];
  
      const missingFields = requiredFields.filter(field => {
        const value = field.split('.').reduce((obj, key) => obj?.[key], req.body);
        return value === undefined;
      });
  
      if (missingFields.length > 0) {
        return res.status(400).json({ 
          error: 'Missing required fields', 
          fields: missingFields 
        });
      }
  
      // Validate music type
      if (!['Deep House', 'Hip Hop', 'Top 40', 'Latin', 'EDM', 'Mixed'].includes(req.body.music)) {
        return res.status(400).json({ error: 'Invalid music type' });
      }
  
      // Validate venue type
      if (!['Rooftop Lounge', 'Nightclub', 'Bar', 'Lounge'].includes(req.body.type)) {
        return res.status(400).json({ error: 'Invalid venue type' });
      }
  
      const venue = new Venue(req.body);
      await venue.save();
      res.status(201).json(venue);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

// Update venue
router.put('/venues/:id', async (req, res) => {
    try {
      // Validate music type if provided
      if (req.body.music && !['Deep House', 'Hip Hop', 'Top 40', 'Latin', 'EDM', 'Mixed'].includes(req.body.music)) {
        return res.status(400).json({ error: 'Invalid music type' });
      }
  
      // Validate venue type if provided
      if (req.body.type && !['Rooftop Lounge', 'Nightclub', 'Bar', 'Lounge'].includes(req.body.type)) {
        return res.status(400).json({ error: 'Invalid venue type' });
      }
  
      const venue = await Venue.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );
      if (!venue) return res.status(404).json({ error: 'Venue not found' });
      res.json(venue);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

// Manage venue passes
router.patch('/venues/:id/passes', async (req, res) => {
    try {
      const venue = await Venue.findById(req.params.id);
      if (!venue) return res.status(404).json({ error: 'Venue not found' });
  
      const { available, price } = req.body;
      
      // Validate inputs
      if (available !== undefined) {
        if (!Number.isInteger(available)) {
          return res.status(400).json({ error: 'Available passes must be a whole number' });
        }
        if (available < 0) {
          return res.status(400).json({ error: 'Available passes cannot be negative' });
        }
        venue.passes.available = available;
      }
      
      if (price !== undefined) {
        if (typeof price !== 'number') {
          return res.status(400).json({ error: 'Price must be a number' });
        }
        if (price < 0) {
          return res.status(400).json({ error: 'Price cannot be negative' });
        }
        venue.passes.price = price;
      }
  
      await venue.save();
      
      res.json({
        message: 'Passes updated successfully',
        passes: venue.passes
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// Delete venue
router.delete('/venues/:id', async (req, res) => {
    try {
        const venue = await Venue.findByIdAndDelete(req.params.id);
        if (!venue) return res.status(404).json({ error: 'Venue not found' });
        res.json({ message: 'Venue deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all venue owners
router.get('/venue-owners', async (req, res) => {
    try {
        const owners = await User.find({ role: 'owner' }).select('-auth0Id');
        res.json(owners);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add debug route
router.get('/debug/my-user', requireAdmin(), async (req, res) => {
  try {
      const user = await User.findOne({ auth0Id: req.oidc.user.sub });
      res.json({
          auth0Id: user.auth0Id,
          email: user.email,
          role: user.role,
          managedVenues: user.managedVenues
      });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// Assign venue to owner
router.post('/assign-venue/:venueId/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        if (user.role !== 'owner') {
            user.role = 'owner';
        }
        
        if (!user.managedVenues.includes(req.params.venueId)) {
            user.managedVenues.push(req.params.venueId);
        }
        
        await user.save();
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Role Switch Endpoint
// Role Switch Endpoint with Authentication Check and Debug Logging
router.put('/users/:userId/role', requireAdmin(), async (req, res) => {
  try {
      // Add debug logging
      console.log('User attempting role change:', {
          adminId: req.user._id,
          targetUserId: req.params.userId,
          adminRole: req.user.role
      });

      // Verify admin status explicitly
      if (req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Requires admin privileges' });
      }

      const { role } = req.body;
      if (!['admin', 'owner', 'customer'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
      }

      const user = await User.findByIdAndUpdate(
          req.params.userId,
          { role },
          { new: true }
      );

      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json(user);
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// Get admin dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const stats = {
            totalVenues: await Venue.countDocuments(),
            totalOwners: await User.countDocuments({ role: 'owner' }),
            totalCustomers: await User.countDocuments({ role: 'customer' }),
            recentVenues: await Venue.find().sort({ createdAt: -1 }).limit(5),
            recentUsers: await User.find()
                .select('-auth0Id')
                .sort({ createdAt: -1 })
                .limit(5)
        };
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Migration dashboard
router.get('/metrics/migration', requireAdmin(), async (req, res) => {
    try {
        const [migrationStats, kafkaHealth] = await Promise.all([
            getMigrationStats(),
            kafkaBridge.checkHealth()
        ]);

        const dashboard = {
            timestamp: new Date(),
            dualWrite: {
                total: migrationStats.total,
                successRate: migrationStats.successRate,
                latency: migrationStats.latency
            },
            kafka: kafkaHealth,
            validation: {
                active: validationService.validationResults.size > 0,
                results: Array.from(validationService.validationResults.values())
                    .slice(-100) // Last 100 validations
                    .sort((a, b) => b.timestamp - a.timestamp)
            }
        };

        res.json(dashboard);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch migration dashboard',
            details: error.message
        });
    }
});

// Venue-specific validation report
router.get('/metrics/validation/:venueId', requireAdmin(), async (req, res) => {
    try {
        const { venueId } = req.params;
        const { timeRange = '1h' } = req.query;
        
        const report = validationService.getValidationReport(venueId, timeRange);
        res.json(report);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch validation report',
            details: error.message
        });
    }
});

module.exports = router;