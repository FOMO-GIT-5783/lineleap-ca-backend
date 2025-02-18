const { updateVenuePrice } = require('../services/priceService');

async function verifyPrice(req, res, next) {
    try {
        const { venueId, requestedPrice } = req.body;
        const currentPrice = await updateVenuePrice(venueId);
        
        if (Math.abs(currentPrice - requestedPrice) > 0.01) {
            return res.status(409).json({
                error: 'Price has changed',
                currentPrice
            });
        }
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { verifyPrice };