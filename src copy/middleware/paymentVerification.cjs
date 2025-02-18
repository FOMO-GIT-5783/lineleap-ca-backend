const { stripe } = require('../config/stripeConfig.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');
const logger = require('../utils/logger.cjs');

const verifyPaymentIntent = async (req, res, next) => {
    try {
        const { paymentIntentId } = req.body;

        if (!paymentIntentId) {
            throw createError.validation(
                ERROR_CODES.MISSING_REQUIRED_FIELD,
                'Payment intent ID is required'
            );
        }

        // Retrieve payment intent from Stripe
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Verify payment intent belongs to the current user
        if (paymentIntent.metadata.userId !== req.user._id.toString()) {
            throw createError.authorization(
                ERROR_CODES.UNAUTHORIZED_PAYMENT,
                'Payment intent does not belong to the current user'
            );
        }

        // Verify payment intent is in the correct state
        if (paymentIntent.status !== 'requires_capture') {
            throw createError.validation(
                ERROR_CODES.INVALID_PAYMENT_STATE,
                'Payment intent is not in a valid state for this operation'
            );
        }

        // Add payment intent to request for downstream use
        req.paymentIntent = paymentIntent;
        next();
    } catch (error) {
        logger.error('Payment intent verification failed:', {
            error: error.message,
            userId: req.user?._id,
            paymentIntentId: req.body?.paymentIntentId
        });
        next(error);
    }
};

module.exports = { verifyPaymentIntent }; 