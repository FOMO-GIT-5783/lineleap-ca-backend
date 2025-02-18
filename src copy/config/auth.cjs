const { auth } = require('express-openid-connect');
const { requiresAuth } = require('express-openid-connect');

const getConfig = () => {
    // For test environment, use mock configuration
    if (process.env.NODE_ENV === 'test') {
        return {
            authRequired: false,
            auth0Logout: true,
            secret: 'test-secret-very-long-at-least-32-characters',
            baseURL: process.env.BASE_URL || 'http://localhost:3000',
            clientID: 'test-client-id',
            issuerBaseURL: 'https://test.auth0.com',
            routes: {
                login: '/login',
                callback: '/callback',
                logout: '/logout'
            }
        };
    }

    // Production/staging configuration
    return {
        authRequired: false,
        auth0Logout: true,
        baseURL: process.env.BASE_URL,
        clientID: process.env.AUTH0_CLIENT_ID,
        issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
        secret: process.env.AUTH0_SECRET,
        routes: {
            login: '/login',
            callback: '/callback',
            logout: '/logout'
        }
    };
};

const config = getConfig();

const auth0 = {
    middleware: auth(config),
    requiresAuth: requiresAuth,
    checkConnection: async () => {
        return Promise.resolve();
    }
};

module.exports = {
    auth0,
    config
}; 