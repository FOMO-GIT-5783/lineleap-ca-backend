const locks = new Map();
const lockTimeouts = new Map();
const LOCK_TIMEOUT = 30000; // 30 seconds

class LockManager {
    static async acquireLock(type, id) {
        const lockKey = `${type}:${id}`;
        
        if (locks.has(lockKey)) {
            return false;
        }

        locks.set(lockKey, true);
        
        // Set timeout to automatically release lock
        const timeout = setTimeout(() => {
            this.releaseLock(type, id);
        }, LOCK_TIMEOUT);
        
        lockTimeouts.set(lockKey, timeout);
        
        return true;
    }

    static async releaseLock(type, id) {
        const lockKey = `${type}:${id}`;
        
        // Clear timeout if it exists
        const timeout = lockTimeouts.get(lockKey);
        if (timeout) {
            clearTimeout(timeout);
            lockTimeouts.delete(lockKey);
        }
        
        locks.delete(lockKey);
        return true;
    }

    static async isLocked(type, id) {
        const lockKey = `${type}:${id}`;
        return locks.has(lockKey);
    }
}

module.exports = LockManager;