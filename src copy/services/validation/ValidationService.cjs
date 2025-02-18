let authMiddleware;

const validateToken = async (token) => {
    authMiddleware = authMiddleware || require('@/middleware/authMiddleware.cjs');

    // Verify token structure first
    if (!token || !token.startsWith('Bearer ')) {
        throw new Error('Invalid token format');
    }

    return authMiddleware.verifyToken(token.split(' ')[1]);
};

module.exports = {
    validateOrder: (order) => ({ valid: true }),
    validatePass: (pass) => ({ valid: true }),
    validateToken
}; 