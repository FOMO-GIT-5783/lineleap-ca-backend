const BaseService = require('../../utils/baseService.cjs');

// Core payment processing interface
class IPaymentProcessor extends BaseService {
    constructor(name = 'payment-processor') {
        super(name);
    }

    async processPayment(intent) {
        throw new Error('Not implemented');
    }

    async validatePayment(intent) {
        throw new Error('Not implemented');
    }

    async getPaymentStatus(paymentId) {
        throw new Error('Not implemented');
    }
}

// Locking mechanism interface
class ILockManager extends BaseService {
    constructor(name = 'lock-manager') {
        super(name);
    }

    async acquireLock(key, ttl) {
        throw new Error('acquireLock must be implemented');
    }

    async releaseLock(key) {
        throw new Error('releaseLock must be implemented');
    }

    async isLocked(key) {
        throw new Error('isLocked must be implemented');
    }
}

// Transaction management interface
class ITransactionManager extends BaseService {
    constructor(name = 'transaction-manager') {
        super(name);
    }

    async beginTransaction(context) {
        throw new Error('beginTransaction must be implemented');
    }

    async commitTransaction(transactionId) {
        throw new Error('commitTransaction must be implemented');
    }

    async rollbackTransaction(transactionId) {
        throw new Error('rollbackTransaction must be implemented');
    }

    async getTransactionState(transactionId) {
        throw new Error('getTransactionState must be implemented');
    }
}

// Metrics collection interface
class IPaymentMetrics extends BaseService {
    constructor(name = 'payment-metrics') {
        super(name);
    }

    async recordSuccess(paymentData) {
        throw new Error('recordSuccess must be implemented');
    }

    async recordFailure(paymentData, error) {
        throw new Error('recordFailure must be implemented');
    }

    async getMetrics(timeRange) {
        throw new Error('getMetrics must be implemented');
    }
}

// Rollback management interface
class IRollbackManager extends BaseService {
    constructor(name = 'rollback-manager') {
        super(name);
    }

    async createRollbackPoint(context) {
        throw new Error('createRollbackPoint must be implemented');
    }

    async executeRollback(rollbackId) {
        throw new Error('executeRollback must be implemented');
    }

    async verifyRollbackSuccess(rollbackId) {
        throw new Error('verifyRollbackSuccess must be implemented');
    }
}

// Feature flag interface for gradual rollout
class IFeatureManager extends BaseService {
    constructor(name = 'feature-manager') {
        super(name);
    }

    async isEnabled(feature, context = {}) {
        throw new Error('Not implemented');
    }

    async setFeatureState(feature, enabled, context = {}) {
        throw new Error('Not implemented');
    }

    async getFeatureStates() {
        throw new Error('Not implemented');
    }
}

module.exports = {
    IPaymentProcessor,
    ILockManager,
    ITransactionManager,
    IPaymentMetrics,
    IRollbackManager,
    IFeatureManager
}; 