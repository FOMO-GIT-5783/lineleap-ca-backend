const mongoose = require('mongoose');
const Pass = require('../models/Pass.cjs');
const Venue = require('../models/Venue.cjs');
const { emitVenueUpdate } = require('../websocket/socketManager.cjs');
const { PASS_EVENTS } = require('../utils/constants.cjs');
const { MetricRecorder, CORE_METRIC_TYPES } = require('./MetricService.cjs');
const createError = require('http-errors');

class PassService {
    // Purchase new pass
    static async purchasePass({ userId, venueId, passType, price, paymentIntentId, idempotencyKey }) {
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
            purchaseAmount: price,
            purchaseDate: new Date(),
            paymentIntentId,
            idempotencyKey
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

    // Self-service pass verification
    static async verifyPass(passId, userId) {
        const pass = await Pass.findById(passId);
        if (!pass) {
            throw createError.notFound('Pass not found');
        }

        // Verify pass ownership
        if (!pass.userId.equals(userId)) {
            throw createError.authorization('Not authorized to verify this pass');
        }

        // Check if pass is active
        if (pass.status !== 'active') {
            throw createError.badRequest('Pass is not active');
        }

        // Check if pass is already used
        if (pass.status === 'used') {
            throw createError.badRequest('Pass has already been used');
        }

        // For drink passes, mark as used immediately
        if (pass.type === 'drink') {
            pass.status = 'used';
        }

        // For skipline/regular passes, check time window
        if (['skipline', 'regular'].includes(pass.type)) {
            const now = new Date();
            if (now < pass.validFrom || now > pass.validUntil) {
                throw createError.badRequest('Pass is not valid at this time');
            }
        }

        // Update verification timestamp
        pass.lastVerifiedAt = new Date();
        await pass.save();

        return pass;
    }

    // Get active passes for venue
    static async getActivePasses(venueId) {
        return Pass.find({
            venueId,
            status: 'active'
        }).populate('userId', 'name email');
    }

    // Update pass status
    static async updatePassStatus(passId, newStatus) {
        const validStatuses = ['active', 'used', 'expired', 'cancelled'];
        if (!validStatuses.includes(newStatus)) {
            throw new Error('Invalid status');
        }

        const pass = await Pass.findByIdAndUpdate(
            passId,
            { 
                status: newStatus,
                ...(newStatus === 'used' ? {
                    usedAt: new Date()
                } : {})
            },
            { new: true }
        );

        if (!pass) {
            throw new Error('Pass not found');
        }

        // Emit real-time update
        emitVenueUpdate(pass.venueId, PASS_EVENTS.PASS_UPDATED, {
            passId: pass._id,
            status: newStatus
        });

        return pass;
    }

    // Use pass (no auth required - used directly on customer's phone)
    static async usePass(passId, deviceId) {
        const pass = await Pass.findById(passId);
        if (!pass) {
            throw createError.notFound('Pass not found');
        }

        // Use the pass with the new method
        await pass.use(deviceId);

        // Track metrics
        const metricService = new MetricRecorder();
        await metricService.record(
            pass.type === 'drink' ? 
                CORE_METRIC_TYPES.PASS.REDEMPTION :
                CORE_METRIC_TYPES.PASS.VALIDATION,
            {
                venueId: pass.venueId,
                passType: pass.type
            }
        );

        // Emit real-time update
        emitVenueUpdate(pass.venueId, 
            pass.type === 'drink' ? 
                PASS_EVENTS.PASS_USED :
                PASS_EVENTS.PASS_VALIDATED,
            {
                passId: pass._id,
                type: pass.type,
                status: pass.status
            }
        );

        return pass;
    }
}

module.exports = PassService; 