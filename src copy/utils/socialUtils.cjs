function generateSocialProof(venue) {
    const recentCheckins = venue.checkInHistory
        .filter(ch => ch.timestamp > Date.now() - 3600000)
        .length;
    return recentCheckins > 0 
        ? `${recentCheckins} people here recently`
        : 'Be the first to check in!';
}

module.exports = { generateSocialProof };