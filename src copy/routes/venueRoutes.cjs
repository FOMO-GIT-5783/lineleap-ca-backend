console.log('Setting up venue routes...');
const express = require('express');
const router = express.Router();
const VenueService = require('../services/venueService.cjs');
const Venue = require('../models/Venue.cjs');
const User = require('../models/User.cjs');
const crypto = require('crypto');  // Required for generating UUIDs
const { requireCustomer, requireVenueOwner, requireAuth } = require('../middleware/authMiddleware.cjs');
const { emitVenueUpdate, emitVenueStats, emitOwnerStats } = require('../websocket/socketManager.cjs');
const { validateVenue } = require('../middleware/validationMiddleware.cjs');
const { generateSocialProof } = require('../utils/socialUtils.cjs');
const { withTransaction } = require('mongoose');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const logger = require('../utils/logger.cjs');
const TRENDING_THRESHOLD = 50;

// Request logging middleware
router.use((req, res, next) => {
    console.log('Venue Routes - Request URL:', {
        original: req.originalUrl,
        path: req.path
    });
    next();
});

// Helper functions
async function updateTrendingScore(venue) {
    const now = new Date();
    const hourAgo = new Date(now - 60 * 60 * 1000);

    const score =
        (venue.likeCount * 0.5) +
        (venue.checkInHistory
            .filter(ch => ch.timestamp > hourAgo)
            .reduce((sum, ch) => sum + ch.count, 0) * 0.5);

    venue.trendingScore = score;
    venue.trending = score > TRENDING_THRESHOLD;
    await venue.save();
}

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

// Add new endpoint to fetch user's passes
router.get('/passes/mine', requireCustomer(), async (req, res) => {
  try {
      // Log the authenticated user details
      console.log('Auth user:', {
          sub: req.oidc.user.sub,
          email: req.oidc.user.email
      });

      // Find user based on Auth0 ID
      const user = await User.findOne({ auth0Id: req.oidc.user.sub });
      
      // Log found user details
      console.log('Found user:', {
          id: user?._id,
          auth0Id: user?.auth0Id,
          passes: user?.passes
      });

      const now = new Date();
      
      // Filter out expired and used passes
      const validPasses = user.passes.filter(pass => 
          pass.status === 'active' && 
          pass.expiresAt > now
      );

      res.json({
          active: validPasses,
          expired: user.passes.filter(p => 
              p.status === 'used' || 
              p.expiresAt <= now
          )
      });
  } catch (err) {
      // Log error details
      console.error('Pass fetch error:', err);
      res.status(500).json({ error: err.message });
  }
});

// Keep debug route
router.get('/debug/my-user', requireCustomer(), async (req, res) => {
  try {
      const user = await User.findOne({ auth0Id: req.oidc.user.sub });
      res.json({
          auth0Id: user.auth0Id,
          passes: user.passes,
          _id: user._id
      });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// Public venue listing
router.get('/', async (req, res, next) => {
    try {
        const venues = await VenueService.listVenues();
        res.json({ status: 'success', data: venues });
    } catch (error) {
        next(error);
    }
});

// Public venue search
router.get('/search', async (req, res, next) => {
    try {
        const { q } = req.query;
        const venues = await VenueService.searchVenues(q);
        res.json({ status: 'success', data: venues });
    } catch (error) {
        next(error);
    }
});

// Featured venues
router.get('/featured', async (req, res, next) => {
    try {
        const venues = await VenueService.getFeaturedVenues();
        res.json({ status: 'success', data: venues });
    } catch (error) {
        next(error);
    }
});

// Update purchase endpoint to handle pass types
router.post('/:id/passes', requireCustomer(), async (req, res) => {
    try {
        const { passType = 'fomo' } = req.body;  // default to 'fomo' pass type
        const venue = await Venue.findById(req.params.id);
        if (!venue) return res.status(404).json({ error: 'Venue not found' });
        
        const user = await User.findById(req.user._id);
        
        // Check if user already has an active pass
        if (user.activePass?.status === 'active') {
            return res.status(400).json({ error: 'User already has an active pass' });
        }

        // Assign new pass with type
        user.activePass = {
            venue: venue._id,
            passType,
            status: 'active',
            purchasedAt: new Date(),
            expiresAt: new Date().setHours(6, 0, 0, 0) + 24 * 60 * 60 * 1000, // Next day 6AM
            passData: {
                passId: crypto.randomUUID()
            }
        };

        await user.save();
        
        // Emit venue update for pass purchase
        emitVenueUpdate(venue._id, 'passUpdate', {
            passType,
            venue: venue._id
        });

        res.status(201).json({
            message: 'Pass created successfully',
            pass: user.activePass
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get venue pass availability (public)
router.get('/:id/passes', async (req, res) => {
  try {
      const venue = await Venue.findById(req.params.id);
      if (!venue) return res.status(404).json({ error: 'Venue not found' });
      
      res.json({
          fomo: {
              available: venue.passes.available,
              price: venue.passes.price,
              description: "Purchase this pass to advance to the front of the line. Does not guarantee immediate entry. Must be 19+"
          },
          cover: {
              price: venue.coverPass?.price,
              enabled: venue.coverPass?.enabled,
              description: "Ditch the ATM! Pay for cover on your phone. Must be 19+"
          }
      });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// Check user's pass status (protected)
router.get('/pass-status', requireCustomer(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('activePass.venue', 'name');

    if (!user.activePass) {
      return res.json({
        hasPass: false,
        message: 'No active pass'
      });
    }

    const now = new Date();
    const isExpired = user.activePass.expiresAt && user.activePass.expiresAt < now;

    res.json({
      hasPass: true,
      pass: {
        venue: user.activePass.venue,
        status: user.activePass.status,
        purchasedAt: user.activePass.purchasedAt,
        expiresAt: user.activePass.expiresAt,
        isExpired
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trending Venues 
router.get('/trending', async (req, res) => {
  try {
    const trendingVenues = await Venue.find({ trending: true })
      .sort('-trendingScore')
      .limit(10);
    
    res.json(trendingVenues);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Check-in/out routes
router.post('/check-in/:id', requireCustomer(), async (req, res) => {
  try {
      const venue = await Venue.findById(req.params.id);
      if (!venue) return res.status(404).json({ error: 'Venue not found' });

      const user = await User.findById(req.user._id);

      // Record check-in without capacity
      venue.checkInHistory.push({ 
          count: 1, 
          timestamp: new Date(),
          passType: user.activePass?.passType || 'fomo'
      });

      // Record activity
      user.activityHistory.push({
          type: 'check-in',
          venue: venue._id,
          passType: user.activePass?.passType || 'fomo',
          timestamp: new Date()
      });

      // Update pass status to 'used' if applicable
      if (user.activePass) {
          user.activePass.status = 'used';
      }

      await Promise.all([venue.save(), user.save()]);
      await updateTrendingScore(venue);

      // Replace socialProof string with generateSocialProof
      emitVenueUpdate(venue._id, 'checkIn', {
          socialProof: generateSocialProof(venue),
          passType: user.activePass?.passType || 'fomo'
      });

      emitOwnerStats(venue._id);

      res.json({
          message: 'Check-in successful'
      });
  } catch (err) {
      console.error('Check-in error:', err);
      res.status(500).json({ error: err.message });
  }
});

// Redeem a pass (protected)
router.post('/:id/passes/:passId/redeem', requireCustomer(), async (req, res) => {
  try {
      const user = await User.findOne({
          auth0Id: req.oidc.user.sub,
          'passes': {
              $elemMatch: {
                  passId: req.params.passId,
                  status: 'active'
              }
          }
      });

      if (!user) {
          return res.status(404).json({ error: 'No active pass found' });
      }

      const pass = user.passes.find(p => p.passId === req.params.passId);
      const venue = await Venue.findById(req.params.id);

      // Update pass status and record check-in
      pass.status = 'used';
      venue.checkInHistory.push({
          count: 1,
          timestamp: new Date(),
          passType: pass.type
      });

      await Promise.all([user.save(), venue.save()]);

      // Replace socialProof string with generateSocialProof
      emitVenueUpdate(venue._id, 'checkIn', {
          socialProof: generateSocialProof(venue)
      });

      res.json({ message: 'Pass redeemed successfully' });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// 3. Venue owner routes
router.get('/managed/:venueId', requireVenueOwner(), async (req, res) => {
  try {
    if (!req.user.managedVenues.includes(req.params.venueId)) {
      return res.status(403).json({ error: 'Not authorized to manage this venue' });
    }
    
    const venue = await Venue.findById(req.params.venueId);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json(venue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Analytics route
router.get('/analytics/:id', requireVenueOwner(), async (req, res) => {
  try {
    if (!req.user.managedVenues.includes(req.params.id)) {
      return res.status(403).json({ error: 'Not authorized to view these analytics' });
    }

    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const analytics = {
      likeCount: venue.likeCount,
      trending: venue.trending
    };

    res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pass management for venue owners
router.patch('/:id/cover-pass', requireVenueOwner(), async (req, res) => {
  try {
      const venue = await Venue.findById(req.params.id);
      if (!venue) return res.status(404).json({ error: 'Venue not found' });
      
      // Admin bypass or regular owner check
      if (req.user.role !== 'admin' && !req.user.managedVenues.includes(req.params.id)) {
          return res.status(403).json({ error: 'Not authorized to manage this venue' });
      }

      const { price, enabled } = req.body;
      venue.coverPass = { price, enabled, updatedAt: new Date() };
      await venue.save();
      
      emitVenueUpdate(venue._id, 'coverPassUpdate', { price, enabled });
      res.json(venue);
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// 6. Generic venue route (must be last)
router.get('/:id', requireAuth, async (req, res) => {
  try {
      const venue = await Venue.findById(req.params.id);
      if (!venue) return res.status(404).json({ error: 'Venue not found' });

      let friendsPresent = [];
      if (req.user) {
          const user = await User.findById(req.user._id).populate('friends');
          const friendIds = user.friends.map(f => f._id.toString());
          
          const activeUsers = await User.find({
              'activePass.venue': venue._id,
              'activePass.status': 'used',
              '_id': { $in: friendIds }
          }).select('profile.name activePass.timestamp');
          
          friendsPresent = activeUsers.map(friend => ({
              name: friend.profile.name,
              checkInTime: friend.activePass?.timestamp ? formatTimeAgo(friend.activePass.timestamp) : 'just now'
          }));
      }

      // Calculate activity-based social proof
      const recentCheckIns = venue.checkInHistory
          .filter(ch => ch.timestamp > Date.now() - 3600000);

      const socialProof = recentCheckIns.length > 0 
          ? `${recentCheckIns.length} people here recently`
          : 'Be the first to check in!';

      res.json({
          ...venue.toObject(),
          friendsHere: friendsPresent.length,
          friendsPresent,
          socialProof
      });
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

// Venue routes
router.get('/:venueId', async (req, res, next) => {
    try {
        const venue = await Venue.findById(req.params.venueId);
        if (!venue) {
            throw createError.notFound(
                ERROR_CODES.VENUE_NOT_FOUND,
                'Venue not found'
            );
        }
        res.json({ status: 'success', data: venue });
    } catch (error) {
        next(error);
    }
});

// Menu endpoint (requires customer auth)
router.get('/:id/menu', requireCustomer(), async (req, res, next) => {
    try {
        const venue = await Venue.findById(req.params.id)
            .populate('menu.items')
            .select('menu');
            
        if (!venue) {
            throw createError.notFound(
                ERROR_CODES.VENUE_NOT_FOUND,
                'Venue not found'
            );
        }

        res.json({ 
            status: 'success', 
            data: venue.menu 
        });
    } catch (error) {
        next(error);
    }
});

// Export the update function for use in server.js
const updateVenueMetrics = async () => {
    try {
        const venues = await Venue.find({});
        await Promise.all(venues.map(venue => 
            Venue.findByIdAndUpdate(venue._id, {
                'ordering.quickAccess.recentlyOrdered': 
                    venue.ordering.quickAccess.recentlyOrdered.slice(-4)
            })
        ));
    } catch (error) {
        logger.error('Recent items cleanup error:', error);
    }
};

module.exports = router;



