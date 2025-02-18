const redisClient = {
    ping: async () => {
        return Promise.resolve('PONG');
    }
};

module.exports = {
    redisClient
}; 