const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

async function createEventPass(user, venue, userPass) {
    try {
        console.log('Pass Data Debug:', {
            user: user?._id,
            venue: venue?._id,
            pass: userPass
        });

        // Generate unique pass ID and security token
        const passId = uuidv4();
        const securityToken = crypto.randomBytes(8).toString('hex');
        const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
        
        console.log('Generating QR with URL:', BASE_URL);

        // Create pass data object
        const passData = {
            passId,
            userId: user._id.toString(),
            venueId: venue._id.toString(),
            timestamp: Date.now(),
            token: securityToken
        };

        // Generate QR Code with verification URL
        const verificationUrl = `${BASE_URL}/api/verify/${passId}`;
        console.log('Verification URL:', verificationUrl);
        const qrCode = await QRCode.toDataURL(verificationUrl);

        // Log the beginning part of the generated QR code data URL for debugging
        console.log('QR Generated:', qrCode.substring(0, 50) + '...');

        return {
            qrCode,
            passData
        };
    } catch (err) {
        console.error('Pass generation error:', err);
        throw new Error(`Failed to generate pass: ${err.message}`);
    }
}

module.exports = { createEventPass };

