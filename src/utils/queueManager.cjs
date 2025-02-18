class QueueManager {
    constructor() {
        this.queues = new Map();
    }

    async enqueue(venueId, operation) {
        if (!this.queues.has(venueId)) {
            this.queues.set(venueId, Promise.resolve());
        }

        const queue = this.queues.get(venueId);
        return queue.then(async () => {
            try {
                return await operation();
            } catch (error) {
                throw error;
            }
        });
    }
}

module.exports = QueueManager;