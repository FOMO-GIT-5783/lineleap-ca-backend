const Venue = require('../models/Venue.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

class VenueService {
    static async listVenues() {
        const venues = await Venue.find({ status: 'active' })
            .select('name type location music image')
            .lean();
        return venues;
    }

    static async searchVenues(query) {
        if (!query) {
            return [];
        }

        const venues = await Venue.find({
            status: 'active',
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { 'location.city': { $regex: query, $options: 'i' } },
                { type: { $regex: query, $options: 'i' } },
                { music: { $regex: query, $options: 'i' } }
            ]
        })
        .select('name type location music image')
        .lean();

        return venues;
    }

    static async getFeaturedVenues() {
        const venues = await Venue.find({ 
            status: 'active',
            featured: true
        })
        .select('name type location music image')
        .lean();

        return venues;
    }
}

module.exports = VenueService; 