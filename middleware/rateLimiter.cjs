const { metrics } = require('@opentelemetry/api');

class RateLimiter {
  constructor() {
    this.redisStore = new RedisStore({
      client: redisClient.getClient(),
      prefix: 'rl:halifax:',
      windowMs: 60000
    });
    
    this.statsCache = cacheService.getCache('RATE_LIMIT');
    this.suspiciousIPs = new Set();
    
    // Add OpenTelemetry metrics
    this.meter = metrics.getMeter('rate-limiter');
    this.histogram = this.meter.createHistogram('rate_limit_breaches');
    
    this.initializeMetrics();
  }

  async checkLimit(key) {
    const result = await this.redisStore.checkLimit(key);
    
    // Record metrics
    this.histogram.record(result.remaining, {
      key,
      type: result.type
    });

    // Update stats cache
    const stats = this.statsCache.get('rate_limit_metrics') || {};
    stats[key] = (stats[key] || 0) + 1;
    this.statsCache.set('rate_limit_metrics', stats);
    
    return result;
  }

  // Modify existing getAuthLimiter
  getAuthLimiter() {
    return rateLimit({
      store: this.redisStore,
      windowMs: HALIFAX_LIMITS.auth.windowMs,
      max: async (req) => {
        if (await this.isSuspiciousIP(req.ip)) {
          this.histogram.record(0, {
            key: `auth:${req.ip}`,
            type: 'suspicious'
          });
          return 0;
        }
        
        const baseLimit = HALIFAX_LIMITS.auth.max;
        const metrics = this.statsCache.get('rate_limit_metrics') || {};
        const failedAttempts = parseInt(metrics[`auth:${req.ip}`] || 0);
        
        if (failedAttempts > 5) {
          this.histogram.record(baseLimit * 0.5, {
            key: `auth:${req.ip}`,
            type: 'reduced'
          });
          return Math.floor(baseLimit * 0.5);
        }
        
        return baseLimit;
      },
      handler: async (req, res) => {
        await this.trackSuspiciousIP(req.ip);
        
        this.histogram.record(0, {
          key: `auth:${req.ip}`,
          type: 'exceeded'
        });
        
        logger.warn('Auth rate limit exceeded:', {
          ip: req.ip,
          path: req.path,
          userAgent: req.get('user-agent')
        });

        res.status(429).json({
          error: 'Too many authentication attempts',
          retryAfter: res.getHeader('Retry-After')
        });
      }
    });
  }

  // ... existing code ...
} 