const OrderStateMachine = {
    placed: {
        allowedTransitions: ['verified'],
        validate: async (order) => {
            // Validate required fields present
            if (!order.items || !order.venueId || !order.userId) {
                throw new Error('Missing required fields');
            }
        }
    },
    verified: {
        allowedTransitions: ['completed'],
        validate: async (order) => {
            // Verify bartender validation exists
            if (!order.bartenderVerification?.verifiedAt) {
                throw new Error('Missing bartender verification');
            }
        }
    },
    completed: {
        allowedTransitions: [],
        validate: async (order) => {
            // Ensure payment completed
            if (order.type === 'drink' && !order.tipAmount) {
                throw new Error('Missing tip amount');
            }
        }
    }
};
