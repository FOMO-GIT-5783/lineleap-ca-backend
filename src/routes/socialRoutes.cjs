const express = require('express');
const router = express.Router();
const { requireCustomer } = require('../middleware/authMiddleware.cjs');
const Venue = require('../models/Venue.cjs');
const User = require('../models/User.cjs');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { userPresence } = require('../websocket/socketManager.cjs');


// Add these helper functions at the top of file
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}

function getTimeGrouping(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const days = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  
  if (days < 1) return 'Today';
  if (days < 7) return 'This Week';
  return 'Earlier';
}


// Like a venue
router.post('/venues/:id/like', requireCustomer(), async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const user = await User.findById(req.user._id);
    
    // Check if already liked
    if (user.likedVenues.includes(venue._id)) {
      return res.status(400).json({ error: 'Already liked this venue' });
    }

    // Add to user's liked venues
    user.likedVenues.push(venue._id);
    await user.save();

    // Increment venue like count
    venue.likeCount += 1;
    await venue.save();

    // Emit update
    emitVenueUpdate(venue._id, 'likeUpdate', {
      likeCount: venue.likeCount
    });

    res.json({ message: 'Venue liked', likeCount: venue.likeCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unlike a venue
router.post('/venues/:id/unlike', requireCustomer(), async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });

    const user = await User.findById(req.user._id);
    
    // Check if not already liked
    if (!user.likedVenues.includes(venue._id)) {
      return res.status(400).json({ error: 'Venue not liked yet' });
    }

    // Remove from user's liked venues
    user.likedVenues = user.likedVenues.filter(v => !v.equals(venue._id));
    await user.save();

    // Decrement venue like count
    venue.likeCount = Math.max(0, venue.likeCount - 1);
    await venue.save();

    res.json({ message: 'Venue unliked', likeCount: venue.likeCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send friend request
router.post('/friends/request/:userId', requireCustomer(), async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // Check if request already exists
    if (targetUser.friendRequests.some(fr => fr.from.equals(req.user._id))) {
      return res.status(400).json({ error: 'Friend request already sent' });
    }

    // Check if already friends
    if (targetUser.friends.includes(req.user._id)) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Add friend request
    targetUser.friendRequests.push({
      from: req.user._id,
      status: 'pending'
    });
    await targetUser.save();

    res.json({ message: 'Friend request sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept/reject friend request
router.post('/friends/respond/:requestId', requireCustomer(), async (req, res) => {
  try {
    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const user = await User.findById(req.user._id);
    const requestIndex = user.friendRequests.findIndex(
      request => request._id.toString() === req.params.requestId  // Fixed this line
    );

    if (requestIndex === -1) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = user.friendRequests[requestIndex];

    if (action === 'accept') {
      // Only add if not already friends
      if (!user.friends.includes(request.from)) {
        user.friends.push(request.from);
      }
      const otherUser = await User.findById(request.from);
      if (!otherUser.friends.includes(user._id)) {
        otherUser.friends.push(user._id);
      }
      await otherUser.save();
    }

    // Remove request
    user.friendRequests.splice(requestIndex, 1);
    await user.save();

    res.json({ message: `Friend request ${action}ed` });
  } catch (err) {
    console.error('Friend response error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Get pending friend requests
router.get('/friends/requests', requireCustomer(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friendRequests.from', 'email profile.name');
    
    res.json({
      pendingRequests: user.friendRequests
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user's friends
router.get('/friends', requireCustomer(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'email profile.name');
    
    res.json({
      friends: user.friends,
      totalFriends: user.friends.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends' presence at venues
router.get('/friends/presence', requireCustomer(), async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'profile.name');
    
    const friendsPresence = user.friends.map(friend => {
      const presence = userPresence.get(friend._id.toString());
      return {
        friendId: friend._id,
        name: friend.profile.name,
        venue: presence?.venueId,
        lastActive: presence?.lastActive
      };
    }).filter(f => f.venue); // Only return friends at venues

    res.json({
      activeCount: friendsPresence.length,
      friends: friendsPresence
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friend activity feed
router.get('/activity-feed', requireCustomer(), async (req, res) => {
  try {
      const user = await User.findById(req.user._id)
          .populate('friends');
      
      // Get all friends' IDs
      const friendIds = user.friends.map(f => f._id);
      
      // Get friends' activities
      const activities = await User.aggregate([
          { $match: { _id: { $in: friendIds } } },
          { $unwind: '$activityHistory' },
          { $sort: { 'activityHistory.timestamp': -1 } },
          { $limit: 50 }
      ]);

      res.json(activities);
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});

router.get('/my-activities', requireCustomer(), async (req, res) => {
  try {
      const user = await User.findById(req.user._id)
          .populate({
              path: 'friends',
              select: 'activityHistory profile.name',
              populate: {
                  path: 'activityHistory.venue',
                  select: 'name'
              }
          })
          .populate('activityHistory.venue', 'name');

      // Combine and format activities
      const friendActivities = user.friends.flatMap(friend => 
          friend.activityHistory.map(activity => ({
              ...activity.toObject(),
              userName: friend.profile.name,
              timeAgo: formatTimeAgo(activity.timestamp),
              grouping: getTimeGrouping(activity.timestamp)
          }))
      );

      const allActivities = [
        ...user.activityHistory.map(activity => ({
            ...activity.toObject(),
            userName: 'You',
            timeAgo: formatTimeAgo(activity.timestamp),
            grouping: getTimeGrouping(activity.timestamp)
        })),
        ...friendActivities
    ].sort((a, b) => b.timestamp - a.timestamp);

      // Group by time
      const groupedActivities = {
          today: allActivities.filter(a => a.grouping === 'Today'),
          thisWeek: allActivities.filter(a => a.grouping === 'This Week'),
          earlier: allActivities.filter(a => a.grouping === 'Earlier')
      };

      res.json(groupedActivities);
  } catch (err) {
      res.status(500).json({ error: err.message });
  }
});




module.exports = router;
