const { verifyAuth0Token } = require('../../utils/auth.cjs');
const jwt = require('jsonwebtoken');

describe('Auth0 Token Validation', () => {
    test('rejects invalid token format', async () => {
        await expect(verifyAuth0Token('invalid.token.here'))
            .rejects
            .toThrow('Invalid token format: missing key ID (kid)');
    });

    test('rejects missing claims', async () => {
        // Create a token without required claims
        const invalidToken = jwt.sign({ foo: 'bar' }, 'secret');
        await expect(verifyAuth0Token(invalidToken))
            .rejects
            .toThrow('Invalid token format: missing key ID (kid)');
    });

    test('rejects null token', async () => {
        await expect(verifyAuth0Token(null))
            .rejects
            .toThrow('Token is required');
    });

    test('rejects undefined token', async () => {
        await expect(verifyAuth0Token(undefined))
            .rejects
            .toThrow('Token is required');
    });
}); 