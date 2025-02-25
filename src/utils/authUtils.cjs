const { USER_ROLES } = require('./constants.cjs');
const logger = require('./logger.cjs');

/**
 * Middleware to require authentication for protected routes
 */
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized - Authentication required' });
    }
    next();
};

/**
 * Middleware to require customer role
 */
const requireCustomer = () => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== USER_ROLES.CUSTOMER) {
            return res.status(403).json({ error: 'Forbidden - Customer access required' });
        }
        next();
    };
};

/**
 * Middleware to require venue owner role
 */
const requireOwner = () => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== USER_ROLES.OWNER) {
            return res.status(403).json({ error: 'Forbidden - Owner access required' });
        }
        next();
    };
};

/**
 * Middleware to require admin role
 */
const requireAdmin = () => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== USER_ROLES.ADMIN) {
            return res.status(403).json({ error: 'Forbidden - Admin access required' });
        }
        next();
    };
};

/**
 * Check if user has owner access to a specific venue
 */
const hasVenueAccess = (user, venueId) => {
    if (!user || !venueId) return false;
    if (user.role === USER_ROLES.ADMIN) return true;
    if (user.role === USER_ROLES.OWNER) {
        return user.venues && user.venues.includes(venueId);
    }
    return false;
};

/**
 * Middleware to require venue access
 */
const requireVenueAccess = () => {
    return (req, res, next) => {
        const venueId = req.params.venueId || req.body.venueId;
        if (!venueId) {
            return res.status(400).json({ error: 'Bad Request - Venue ID required' });
        }

        if (!hasVenueAccess(req.user, venueId)) {
            return res.status(403).json({ error: 'Forbidden - Venue access required' });
        }
        next();
    };
};

module.exports = {
    requireAuth,
    requireCustomer,
    requireOwner,
    requireAdmin,
    requireVenueAccess,
    hasVenueAccess
}; 