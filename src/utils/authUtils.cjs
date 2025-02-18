const jwt = require('jsonwebtoken');
const { User } = require('../models/User.cjs');

// Get user from socket
const getUserFromSocket = async (socket) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return null;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return await User.findById(decoded.userId);
    } catch (err) {
        return null;
    }
};

// Check if user is staff member
const isStaffMember = async (socket, venueId) => {
    const user = await getUserFromSocket(socket);
    if (!user) return false;

    return user.role === 'bartender' || user.role === 'venue_owner';
};

module.exports = {
    getUserFromSocket,
    isStaffMember
}; 