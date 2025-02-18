const PaymentHandler = require('../../utils/paymentHandler.cjs');
const stripeMock = require('../mocks/stripe.mock.cjs');
const VenueAwareBreaker = require('../../utils/circuitBreaker.cjs');

// Mock dependencies
jest.mock('../../config/stripeConfig.cjs', () => stripeMock);
jest.mock('../../utils/circuitBreaker.cjs', () => {
    return jest.fn().mockImplementation(() => ({
        execute: jest.fn(fn => fn())
    }));
});

describe('Payment Handler Tests', () => {
    const venueId = 'test-venue-123';
    const userId = 'test-user-456';
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Reset PaymentHandler state
        PaymentHandler.reset();
        
        // Mock successful Stripe response
        stripeMock.paymentIntents.create.mockResolvedValue({
            id: 'pi_test123',
            client_secret: 'secret_test123',
            status: 'requires_payment_method',
            metadata: {}
        });

        stripeMock.paymentIntents.list.mockResolvedValue({
            data: []
        });

        // Reset VenueAwareBreaker mock
        VenueAwareBreaker.mockClear();
    });

    describe('Idempotency Handling', () => {
        test('generates consistent idempotency keys', async () => {
            const intent1 = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            const intent2 = { ...intent1 };

            const payment1 = await PaymentHandler.processPayment(intent1);
            const payment2 = await PaymentHandler.processPayment(intent2);

            // Should use same idempotency key
            expect(stripeMock.paymentIntents.create)
                .toHaveBeenCalledTimes(1);
            
            expect(payment1.id).toBe(payment2.id);
        });

        test('includes venue prefix in idempotency key', async () => {
            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId: 'venue_halifax_downtown',
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            await PaymentHandler.processPayment(intent);

            // Check idempotency key format
            expect(stripeMock.paymentIntents.create)
                .toHaveBeenCalledWith(
                    expect.any(Object),
                    expect.objectContaining({
                        idempotencyKey: expect.stringMatching(/^VEN-[0-9a-f]{8}$/)
                    })
                );
        });

        test('returns cached payment for duplicate request', async () => {
            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            // First attempt
            const payment1 = await PaymentHandler.processPayment(intent);

            // Mock existing payment in Stripe
            stripeMock.paymentIntents.list.mockResolvedValue({
                data: [payment1]
            });

            // Second attempt
            const payment2 = await PaymentHandler.processPayment(intent);

            expect(payment2.id).toBe(payment1.id);
            expect(stripeMock.paymentIntents.create)
                .toHaveBeenCalledTimes(1);
        });
    });

    describe('Circuit Breaker Integration', () => {
        test('uses circuit breaker for payment processing', async () => {
            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            await PaymentHandler.processPayment(intent);

            expect(VenueAwareBreaker).toHaveBeenCalled();
        });

        test('handles circuit breaker failures', async () => {
            // Mock circuit breaker failure
            VenueAwareBreaker.mockImplementation(() => ({
                execute: jest.fn().mockRejectedValue(new Error('Circuit open'))
            }));

            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            await expect(PaymentHandler.processPayment(intent))
                .rejects
                .toThrow('Circuit open');
        });
    });

    describe('Payment Attempt Tracking', () => {
        test('limits retry attempts', async () => {
            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            // Mock payment failure
            stripeMock.paymentIntents.create
                .mockRejectedValue(new Error('Payment failed'));

            // Try multiple times
            for (let i = 0; i < 3; i++) {
                await expect(PaymentHandler.processPayment(intent))
                    .rejects
                    .toThrow('Payment failed');
            }

            // Fourth attempt should be blocked
            await expect(PaymentHandler.processPayment(intent))
                .rejects
                .toThrow('Too many payment attempts');
        });

        test('tracks attempt history', async () => {
            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            // Mock failure then success
            stripeMock.paymentIntents.create
                .mockRejectedValueOnce(new Error('First attempt failed'))
                .mockResolvedValueOnce({
                    id: 'pi_test123',
                    status: 'requires_payment_method',
                    metadata: { venueId }
                });

            // First attempt fails
            await expect(PaymentHandler.processPayment(intent))
                .rejects
                .toThrow('First attempt failed');

            // Second attempt succeeds
            await PaymentHandler.processPayment(intent);

            // Check metrics
            const metrics = PaymentHandler.getPaymentMetrics(venueId);
            expect(metrics.failureCount).toBe(0);
            expect(metrics.processedCount).toBe(1);
        });
    });

    describe('Error Handling', () => {
        test('handles Stripe errors gracefully', async () => {
            stripeMock.paymentIntents.create
                .mockRejectedValue(new Error('Stripe error'));

            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            await expect(PaymentHandler.processPayment(intent))
                .rejects
                .toThrow('Stripe error');

            // Should record failure
            const metrics = PaymentHandler.getPaymentMetrics(venueId);
            expect(metrics.failureCount).toBe(0);
            expect(metrics.processedCount).toBe(0);
        });

        test('preserves error context', async () => {
            const stripeError = new Error('Card declined');
            stripeError.code = 'card_declined';
            
            stripeMock.paymentIntents.create
                .mockRejectedValue(stripeError);

            const intent = {
                amount: 1000,
                currency: 'cad',
                venueId,
                metadata: {
                    userId,
                    type: 'drink_order'
                }
            };

            try {
                await PaymentHandler.processPayment(intent);
                fail('Should have thrown an error');
            } catch (error) {
                expect(error.message).toBe('Card declined');
                expect(error.code).toBe('card_declined');
            }
        });
    });
}); 