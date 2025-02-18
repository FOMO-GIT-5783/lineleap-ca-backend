const { v4: uuidv4 } = require('uuid');
const OrderLock = require('../models/OrderLock.cjs');
const logger = require('../utils/logger.cjs');
const { createError, ERROR_CODES } = require('../utils/errors.cjs');

const LOCK_RETENTION = {
  active: 1 * 60 * 60 * 1000,    // 1 hour for active locks
  audit: 24 * 60 * 60 * 1000     // 24 hours for audit trail
};

class IdempotencyService {
  static async acquireLock(idempotencyKey, metadata) {
    try {
      const existingLock = await OrderLock.findOne({ idempotencyKey });
      
      if (existingLock) {
        if (existingLock.status === 'completed' && existingLock.orderId) {
          return { 
            status: 'duplicate',
            orderId: existingLock.orderId 
          };
        }
        
        if (existingLock.status === 'failed') {
          // Allow retry of failed attempts
          await OrderLock.deleteOne({ idempotencyKey });
        } else {
          throw createError.conflict(
            ERROR_CODES.DUPLICATE_REQUEST,
            'Request already in progress'
          );
        }
      }

      const lock = await OrderLock.create({
        idempotencyKey,
        metadata,
        status: 'locked'
      });

      return { 
        status: 'acquired',
        lockId: lock._id 
      };
    } catch (error) {
      logger.error('Lock acquisition failed:', {
        idempotencyKey,
        error
      });
      throw error;
    }
  }

  static async completeLock(idempotencyKey, orderId) {
    try {
      await OrderLock.findOneAndUpdate(
        { idempotencyKey },
        { 
          $set: {
            status: 'completed',
            orderId,
            completedAt: new Date()
          }
        }
      );
    } catch (error) {
      logger.error('Lock completion failed:', {
        idempotencyKey,
        orderId,
        error
      });
    }
  }

  static async failLock(idempotencyKey, error) {
    try {
      await OrderLock.findOneAndUpdate(
        { idempotencyKey },
        { 
          $set: {
            status: 'failed',
            'metadata.error': error.message
          }
        }
      );
    } catch (err) {
      logger.error('Lock failure update failed:', {
        idempotencyKey,
        error: err
      });
    }
  }

  static async cleanupExpiredLocks() {
    try {
      // Release expired active locks
      await OrderLock.updateMany(
        {
          status: 'locked',
          createdAt: { $lt: new Date(Date.now() - LOCK_RETENTION.active) }
        },
        { $set: { status: 'released' } }
      );

      logger.info('Expired locks cleanup completed');
    } catch (error) {
      logger.error('Locks cleanup failed:', error);
    }
  }

  static generateKey() {
    return uuidv4();
  }
}

module.exports = IdempotencyService; 