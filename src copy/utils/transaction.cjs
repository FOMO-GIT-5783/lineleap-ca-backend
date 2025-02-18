const mongoose = require('mongoose');

async function withTransaction(callback) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const result = await callback(session);
        await session.commitTransaction();
        return result;
    } catch (err) {
        await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
}

module.exports = { withTransaction };