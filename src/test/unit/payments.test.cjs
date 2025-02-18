const { mockStripe } = require('../mocks/stripe.mock.cjs');
const IdempotencyService = require('../../services/idempotencyService.cjs');
const Pass = require('../../models/Pass.cjs');
const Order = require('../../models/Order.cjs');
const { calculatePassTotal } = require('../../payments/passPayments.cjs');
const Venue = require('../../models/Venue.cjs');

// Mock Stripe
jest.mock('stripe', () => mockStripe);

describe('Payment System Tests', () => {
    beforeEach(async () => {
        await Pass.deleteMany({});
        await Order.deleteMany({});
        await Venue.deleteMany({});
        mockStripe.reset();
    });

    describe('Pass Purchase Flow', () => {
        test('validates pass types per venue', async () => {
            const venue = await Venue.create({
                name: 'Test Venue',
                passes: [
                    { type: 'VIP', price: 50, isAvailable: true, maxDaily: 100 },
                    { type: 'LineSkip', price: 20, isAvailable: false }
                ]
            });

            // Should succeed for available pass
            const validIntent = await mockStripe.paymentIntents.create({
                amount: 5000,
                currency: 'cad',
                metadata: {
                    type: 'pass_purchase',
                    passType: 'VIP',
                    venueId: venue._id
                }
            });
            expect(validIntent.amount).toBe(5000);

            // Should fail for unavailable pass
            await expect(mockStripe.paymentIntents.create({
                amount: 2000,
                metadata: { passType: 'LineSkip', venueId: venue._id }
            })).rejects.toThrow();
        });

        test('enforces daily pass limits', async () => {
            const venue = await Venue.create({
                name: 'Test Venue',
                passes: [{ type: 'VIP', price: 50, maxDaily: 2 }]
            });

            // Create max allowed passes
            await Pass.create([
                { venueId: venue._id, type: 'VIP', purchaseDate: new Date() },
                { venueId: venue._id, type: 'VIP', purchaseDate: new Date() }
            ]);

            // Should fail when exceeding limit
            await expect(mockStripe.paymentIntents.create({
                amount: 5000,
                metadata: { passType: 'VIP', venueId: venue._id }
            })).rejects.toThrow(/Daily limit reached/);
        });

        test('handles service fees per venue type', async () => {
            const configs = [
                { type: 'VIP', price: 50, serviceFee: { enabled: true, amount: 5 } },
                { type: 'LineSkip', price: 20, serviceFee: { enabled: false } }
            ];

            // Test each config
            for (const config of configs) {
                const total = calculatePassTotal(config);
                expect(total.final).toBe(
                    config.serviceFee?.enabled 
                        ? config.price + config.serviceFee.amount 
                        : config.price
                );
            }
        });
    });

    describe('Payment Processing', () => {
        test('handles refunds correctly', async () => {
            const intent = await mockStripe.paymentIntents.create({
                amount: 5000,
                currency: 'cad',
                metadata: { type: 'pass_purchase' }
            });

            const refund = await mockStripe.refunds.create({
                payment_intent: intent.id
            });

            expect(refund.status).toBe('succeeded');
            expect(refund.amount).toBe(intent.amount);
        });

        test('validates payment methods', async () => {
            await expect(mockStripe.paymentIntents.create({
                amount: 5000,
                payment_method: 'invalid_method'
            })).rejects.toThrow();

            const validIntent = await mockStripe.paymentIntents.create({
                amount: 5000,
                payment_method: 'pm_card_visa'
            });
            expect(validIntent.status).toBe('requires_payment_method');
        });
    });

    describe('Security & Business Rules', () => {
        test('validates pass expiration rules', async () => {
            const venue = await Venue.create({
                name: 'Test Venue',
                passes: [{ 
                    type: 'VIP',
                    price: 50,
                    expiryHours: 24
                }]
            });

            const pass = await Pass.create({
                venueId: venue._id,
                type: 'VIP',
                purchaseDate: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
            });

            expect(pass.isValid()).toBe(false);
        });

        test('enforces pass redemption rules', async () => {
            const pass = await Pass.create({
                type: 'VIP',
                status: 'active'
            });

            // First redemption should succeed
            await pass.redeem('doorman123', 'main-entrance');
            expect(pass.status).toBe('redeemed');

            // Second redemption should fail
            await expect(pass.redeem('doorman123', 'main-entrance'))
                .rejects.toThrow('Pass is not valid for redemption');
        });
    });

    // Keep existing tests
    describe('Idempotency', () => {
        test('handles duplicate pass purchase attempts', async () => {
            const idempotencyKey = 'test-key-123';
            const userId = 'user123';
            const venueId = 'venue123';
            
            const firstLock = await IdempotencyService.acquireLock(idempotencyKey, {
                userId,
                venueId,
                passType: 'VIP'
            });
            expect(firstLock.status).toBe('acquired');

            const secondLock = await IdempotencyService.acquireLock(idempotencyKey, {
                userId,
                venueId,
                passType: 'VIP'
            });
            expect(secondLock.status).toBe('duplicate');
        });
    });

    describe('Network Resilience', () => {
        test('handles concurrent requests safely', async () => {
            const idempotencyKey = 'test-key-concurrent';
            const attempts = 5;

            const results = await Promise.all(
                Array(attempts).fill().map(() => 
                    IdempotencyService.acquireLock(idempotencyKey, {})
                )
            );

            const acquired = results.filter(r => r.status === 'acquired');
            expect(acquired.length).toBe(1);
            
            const duplicates = results.filter(r => r.status === 'duplicate');
            expect(duplicates.length).toBe(attempts - 1);
        });
    });

    // Placeholder test to ensure setup is working
    test('test environment is properly configured', () => {
        expect(process.env.NODE_ENV).toBe('test');
    });
}); 