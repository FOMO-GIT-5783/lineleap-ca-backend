const BaseService = require('../../utils/baseService.cjs');
const logger = require('../../utils/logger.cjs');
const { createError, ERROR_CODES, withTransactionBoundary } = require('../../utils/errors.cjs');
const mongoose = require('mongoose');

const TX_STATES = {
    INITIATED: 'initiated',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    ROLLING_BACK: 'rolling_back',
    ROLLED_BACK: 'rolled_back'
};

class TransactionManager extends BaseService {
    constructor() {
        super('transaction-manager');
        this.logger = logger.child({ service: 'transaction-manager' });
        this.transactions = new Map();
        this.rollbackHandlers = new Map();
    }

    async _init() {
        const events = this.getDependency('events');
        if (events) {
            events.safeOn('payment.rollback.requested', this.handleRollbackRequest.bind(this));
        }

        this.logger.info('Transaction manager initialized');
    }

    async beginTransaction(context = {}) {
        return withTransactionBoundary(async () => {
            const session = await mongoose.startSession();
            session.startTransaction({
                readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' }
            });

            const txId = this.generateTransactionId();
            const transaction = {
                id: txId,
                session,
                state: TX_STATES.INITIATED,
                context,
                operations: [],
                startTime: Date.now(),
                rollbackOperations: []
            };

            this.transactions.set(txId, transaction);

            this.logger.info('Transaction started', {
                transactionId: txId,
                context
            });

            return transaction;
        }, {
            source: 'beginTransaction',
            ...context
        });
    }

    async commitTransaction(txId) {
        return withTransactionBoundary(async () => {
            const transaction = this.transactions.get(txId);
            if (!transaction) {
                throw createError.transaction(
                    ERROR_CODES.TRANSACTION_NOT_FOUND,
                    'Transaction not found',
                    { transactionId: txId }
                );
            }

            try {
                // Verify all operations completed
                for (const operation of transaction.operations) {
                    if (!operation.completed) {
                        throw createError.transaction(
                            ERROR_CODES.TRANSACTION_INCOMPLETE,
                            'Not all operations completed',
                            {
                                transactionId: txId,
                                operation: operation.type
                            }
                        );
                    }
                }

                await transaction.session.commitTransaction();
                transaction.state = TX_STATES.COMPLETED;
                transaction.completedAt = Date.now();

                this.logger.info('Transaction committed', {
                    transactionId: txId,
                    duration: transaction.completedAt - transaction.startTime,
                    operationCount: transaction.operations.length
                });

                // Emit event
                const events = this.getDependency('events');
                events?.emitPaymentEvent('TRANSACTION_COMPLETED', {
                    transactionId: txId,
                    context: transaction.context
                });

                return true;

            } catch (error) {
                this.logger.error('Transaction commit failed:', {
                    error: error.message,
                    transactionId: txId
                });

                await this.rollbackTransaction(txId, error);
                throw error;
            } finally {
                transaction.session.endSession();
                this.transactions.delete(txId);
            }
        }, {
            transactionId: txId,
            source: 'commitTransaction'
        });
    }

    async rollbackTransaction(txId, error) {
        return withTransactionBoundary(async () => {
            const transaction = this.transactions.get(txId);
            if (!transaction) {
                this.logger.warn('Transaction not found for rollback', { txId });
                return false;
            }

            try {
                transaction.state = TX_STATES.ROLLING_BACK;
                transaction.rollbackReason = error?.message;

                // Abort MongoDB transaction
                await transaction.session.abortTransaction();

                // Execute rollback operations in reverse order
                for (const operation of transaction.rollbackOperations.reverse()) {
                    try {
                        await this.executeRollbackOperation(operation, transaction);
                    } catch (rollbackError) {
                        this.logger.error('Rollback operation failed:', {
                            error: rollbackError.message,
                            transactionId: txId,
                            operation: operation.type,
                            originalError: error?.message
                        });

                        // Continue with other rollback operations
                        continue;
                    }
                }

                transaction.state = TX_STATES.ROLLED_BACK;
                transaction.rolledBackAt = Date.now();

                this.logger.info('Transaction rolled back', {
                    transactionId: txId,
                    duration: transaction.rolledBackAt - transaction.startTime,
                    reason: error?.message
                });

                // Emit event
                const events = this.getDependency('events');
                events?.emitPaymentEvent('TRANSACTION_ROLLED_BACK', {
                    transactionId: txId,
                    context: transaction.context,
                    error: error?.message
                });

                return true;

            } catch (rollbackError) {
                this.logger.error('Transaction rollback failed:', {
                    error: rollbackError.message,
                    originalError: error?.message,
                    transactionId: txId
                });

                // Emit critical alert
                const events = this.getDependency('events');
                events?.emitPaymentEvent('TRANSACTION_ROLLBACK_FAILED', {
                    transactionId: txId,
                    context: transaction.context,
                    error: rollbackError.message,
                    originalError: error?.message
                });

                return false;
            } finally {
                transaction.session.endSession();
                this.transactions.delete(txId);
            }
        }, {
            transactionId: txId,
            source: 'rollbackTransaction',
            originalError: error
        });
    }

    async addOperation(txId, operation) {
        return withTransactionBoundary(async () => {
            const transaction = this.transactions.get(txId);
            if (!transaction) {
                throw createError.transaction(
                    ERROR_CODES.TRANSACTION_NOT_FOUND,
                    'Transaction not found',
                    { transactionId: txId }
                );
            }

            // Add main operation
            transaction.operations.push({
                ...operation,
                completed: false,
                startTime: Date.now()
            });

            // Add rollback operation if provided
            if (operation.rollback) {
                transaction.rollbackOperations.push({
                    type: `rollback_${operation.type}`,
                    execute: operation.rollback,
                    context: operation.context
                });
            }

            this.logger.debug('Operation added to transaction', {
                transactionId: txId,
                operationType: operation.type,
                hasRollback: !!operation.rollback
            });
        }, {
            transactionId: txId,
            source: 'addOperation',
            operationType: operation.type
        });
    }

    async executeRollbackOperation(operation, transaction) {
        return withTransactionBoundary(async () => {
            const startTime = Date.now();
            
            try {
                await operation.execute(transaction.context);
                
                this.logger.info('Rollback operation completed', {
                    transactionId: transaction.id,
                    operation: operation.type,
                    duration: Date.now() - startTime
                });
            } catch (error) {
                throw createError.transaction(
                    ERROR_CODES.ROLLBACK_OPERATION_FAILED,
                    `Rollback operation ${operation.type} failed: ${error.message}`,
                    {
                        transactionId: transaction.id,
                        operation: operation.type,
                        duration: Date.now() - startTime
                    }
                );
            }
        }, {
            transactionId: transaction.id,
            source: 'executeRollbackOperation',
            operationType: operation.type
        });
    }

    getTransactionState(txId) {
        const transaction = this.transactions.get(txId);
        if (!transaction) return null;

        return {
            id: transaction.id,
            state: transaction.state,
            context: transaction.context,
            startTime: transaction.startTime,
            completedAt: transaction.completedAt,
            rolledBackAt: transaction.rolledBackAt,
            operationCount: transaction.operations.length,
            rollbackOperations: transaction.rollbackOperations.length,
            duration: Date.now() - transaction.startTime
        };
    }

    generateTransactionId() {
        return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async handleRollbackRequest({ transactionId }) {
        await this.rollbackTransaction(transactionId);
    }

    async _cleanup() {
        // Rollback any active transactions
        const activeTransactions = Array.from(this.transactions.entries())
            .filter(([_, tx]) => tx.state === TX_STATES.IN_PROGRESS);

        await Promise.all(
            activeTransactions.map(([txId]) => this.rollbackTransaction(txId))
        );

        this.transactions.clear();
        this.rollbackHandlers.clear();
        this.logger.info('Transaction manager cleaned up');
    }

    getHealth() {
        return {
            status: this.isReady() ? 'healthy' : 'unhealthy',
            activeTransactions: this.transactions.size,
            states: Array.from(this.transactions.values()).reduce((acc, tx) => {
                acc[tx.state] = (acc[tx.state] || 0) + 1;
                return acc;
            }, {})
        };
    }
}

module.exports = new TransactionManager(); 