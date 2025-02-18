const mongoose = require('mongoose');
const Pass = require('../models/Pass.cjs');
const Venue = require('../models/Venue.cjs');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { PASS_EVENTS } = require('../utils/constants.cjs');
const { MetricRecorder, CORE_METRIC_TYPES } = require('./MetricService.cjs');

class PassService {
    // Purchase new pass
    static async purchasePass({ userId, venueId, passType, price }) {
        const startTime = Date.now();
        
        // Validate venue and pass availability
        const venue = await Venue.findById(venueId);
        if (!venue || !venue.passes.find(p => p.type === passType && p.isAvailable)) {
            throw new Error('Pass not available for this venue');
        }

        // Create pass
        const pass = await Pass.create({
            userId,
            venueId,
            type: passType,
            status: 'active',
            purchasePrice: price,
            purchaseDate: new Date(),
            expiryDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours validity
            redemptionStatus: {
                isRedeemed: false
            }
        });

        // Track metrics
        const metricService = new MetricRecorder();
        await metricService.record(CORE_METRIC_TYPES.PASS.PURCHASE, {
            venueId,
            passType,
            amount: price
        });

        // Emit real-time update
        emitVenueUpdate(venueId, PASS_EVENTS.PASS_CREATED, {
            passId: pass._id,
            type: passType,
            status: 'active'
        });

        return pass;
    }

    // Validate pass for redemption
    static async validatePass(passId, venueId) {
        const pass = await Pass.findOne({
            _id: passId,
            venueId,
            status: 'active',
            'redemptionStatus.isRedeemed': false,
            expiryDate: { $gt: new Date() }
        });

        if (!pass) {
            throw new Error('Pass is not valid for redemption');
        }

        // For Halifax V1, no blackout dates
        // Will be re-implemented in future phases if needed
        return pass;
    }

    // Redeem pass
    static async redeemPass(passId) {
        const pass = await Pass.findById(passId);
        if (!pass) {
            throw new Error('Pass not found');
        }

        const metricService = new MetricRecorder();

        if (pass.redemptionStatus.isRedeemed) {
            throw new Error('Pass already redeemed');
        }

        pass.redemptionStatus = {
            isRedeemed: true,
            redeemedAt: new Date()
        };
        pass.status = 'redeemed';

        await pass.save();

        // Track manual verification ("I Am The Doorman" click)
        await metricService.record(CORE_METRIC_TYPES.PASS.REDEMPTION, {
            venueId: pass.venueId,
            passType: pass.type // 'cover' or 'lineSkip'
        });

        // Emit real-time update
        emitVenueUpdate(pass.venueId, 'passRedeemed', {
            passId: pass._id,
            timestamp: new Date()
        });

        return pass;
    }

    // Get user's passes
    static async getUserPasses(userId, status = 'active') {
        return await Pass.find({
            userId,
            status,
            expiryDate: { $gt: new Date() }
        })
        .populate('venueId', 'name')
        .sort('-purchaseDate');
    }

    // Get venue's active passes
    static async getVenuePasses(venueId, status = 'active') {
        return await Pass.find({
            venueId,
            status,
            expiryDate: { $gt: new Date() }
        })
        .populate('userId', 'name email')
        .sort('-purchaseDate');
    }

    // Check pass availability
    static async checkAvailability(venueId, passType) {
        const venue = await Venue.findById(venueId);
        if (!venue) {
            throw new Error('Venue not found');
        }

        const pass = venue.passes.find(p => p.type === passType);
        if (!pass) {
            throw new Error('Pass type not found');
        }

        return {
            isAvailable: pass.isAvailable,
            price: pass.price,
            restrictions: pass.restrictions
        };
    }

    static async getAvailablePasses(venueId) {
        return Pass.find({
            venueId: new mongoose.Types.ObjectId(venueId),
            isAvailable: true,
            'schedule.active': true
        }).sort({ price: 1 });
    }

    static async getPassById(passId) {
        return Pass.findById(new mongoose.Types.ObjectId(passId))
            .populate('venueId', 'name')
            .populate('userId', 'name email');
    }

    static async createPass(data) {
        const pass = await Pass.create({
            ...data,
            status: PASS_EVENTS.PASS_CREATED
        });
        return pass;
    }
}

module.exports = PassService; 