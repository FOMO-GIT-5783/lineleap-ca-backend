const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../../app.cjs');
const PaymentProcessor = require('../../services/payment/PaymentProcessor.cjs');
const FeatureManager = require('../../services/payment/FeatureManager.cjs');
const { createTestUser, createTestVenue } = require('../helpers/testSetup.cjs');

describe('Payment Routes Integration', () => {
    let testUser;
    let testVenue;
    let authToken;

    beforeAll(async () => {
        testUser = await createTestUser();
        testVenue = await createTestVenue();
        authToken = testUser.generateAuthToken();
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    describe('Feature Flag Control', () => {
        it('should use legacy routes when feature flag is disabled', async () => {
            // Ensure feature flag is disabled
            await FeatureManager.setFeatureState('USE_NEW_PAYMENT_PROCESSOR', false);

            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: testVenue._id,
                    type: 'pass_purchase',
                    passType: 'VIP'
                });

            expect(response.status).toBe(404); // Should fall through to legacy routes
        });

        it('should use new routes when feature flag is enabled', async () => {
            // Enable feature flag for test venue
            await FeatureManager.setFeatureState('USE_NEW_PAYMENT_PROCESSOR', true, {
                venueId: testVenue._id
            });

            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: testVenue._id,
                    type: 'pass_purchase',
                    passType: 'VIP'
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('clientSecret');
        });
    });

    describe('Pass Purchase Flow', () => {
        beforeEach(async () => {
            await FeatureManager.setFeatureState('USE_NEW_PAYMENT_PROCESSOR', true, {
                venueId: testVenue._id
            });
        });

        it('should create a payment intent for pass purchase', async () => {
            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: testVenue._id,
                    type: 'pass_purchase',
                    passType: 'VIP'
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('clientSecret');
            expect(response.body.data.breakdown).toHaveProperty('total');
        });

        it('should handle webhook for successful pass purchase', async () => {
            const paymentIntent = await PaymentProcessor.processPayment({
                amount: 5000,
                venueId: testVenue._id,
                type: 'pass_purchase',
                metadata: {
                    userId: testUser._id,
                    passType: 'VIP'
                }
            });

            const response = await request(app)
                .post('/api/v2/payments/webhook')
                .set('stripe-signature', 'test_signature')
                .send({
                    type: 'payment_intent.succeeded',
                    data: {
                        object: paymentIntent
                    }
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('received', true);
        });
    });

    describe('Drink Order Flow', () => {
        const testItems = [
            {
                menuItemId: new mongoose.Types.ObjectId(),
                quantity: 2
            }
        ];

        beforeEach(async () => {
            await FeatureManager.setFeatureState('USE_NEW_PAYMENT_PROCESSOR', true, {
                venueId: testVenue._id
            });
        });

        it('should create a payment intent for drink order', async () => {
            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: testVenue._id,
                    type: 'drink_order',
                    items: testItems
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('clientSecret');
            expect(response.body.data.breakdown).toHaveProperty('total');
        });

        it('should handle webhook for successful drink order', async () => {
            const paymentIntent = await PaymentProcessor.processPayment({
                amount: 2000,
                venueId: testVenue._id,
                type: 'drink_order',
                metadata: {
                    userId: testUser._id,
                    items: JSON.stringify(testItems)
                }
            });

            const response = await request(app)
                .post('/api/v2/payments/webhook')
                .set('stripe-signature', 'test_signature')
                .send({
                    type: 'payment_intent.succeeded',
                    data: {
                        object: paymentIntent
                    }
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('received', true);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid payment type', async () => {
            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: testVenue._id,
                    type: 'invalid_type'
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_PAYMENT_TYPE');
        });

        it('should handle missing venue', async () => {
            const response = await request(app)
                .post('/api/v2/payments/create-intent')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    venueId: new mongoose.Types.ObjectId(),
                    type: 'pass_purchase',
                    passType: 'VIP'
                });

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('VENUE_NOT_FOUND');
        });

        it('should handle invalid webhook signatures', async () => {
            const response = await request(app)
                .post('/api/v2/payments/webhook')
                .set('stripe-signature', 'invalid_signature')
                .send({
                    type: 'payment_intent.succeeded',
                    data: { object: {} }
                });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('INVALID_SIGNATURE');
        });
    });
}); 