// middleware/ai.js
const { Logger } = require('@mondaycom/apps-sdk');
const AI_CONFIG = require('../config/ai');

class AIMiddleware {
  constructor() {
    this.logger = new Logger('ai-middleware');
    this.requestCounts = new Map();
    this.resetCountsInterval = 60000; // Reset every minute
    this.circuitBreaker = new CircuitBreaker();

    // Start rate limit reset timer
    setInterval(() => this._resetRateLimits(), this.resetCountsInterval);
  }

  /**
   * Rate limiting middleware
   */
  rateLimiter() {
    return (req, res, next) => {
      const clientId = this._getClientIdentifier(req);
      const now = Date.now();
      const windowStart = now - this.resetCountsInterval;

      // Get or create request log for client
      if (!this.requestCounts.has(clientId)) {
        this.requestCounts.set(clientId, []);
      }

      const requests = this.requestCounts.get(clientId);

      // Remove old requests outside the window
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      this.requestCounts.set(clientId, validRequests);

      // Check rate limit
      if (validRequests.length >= AI_CONFIG.claude.rateLimitPerMinute) {
        this.logger.warn('Rate limit exceeded', { clientId, requests: validRequests.length });

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests. Limit: ${AI_CONFIG.claude.rateLimitPerMinute} per minute`,
          retryAfter: Math.ceil((validRequests[0] + this.resetCountsInterval - now) / 1000),
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      // Add current request
      validRequests.push(now);
      this.requestCounts.set(clientId, validRequests);

      next();
    };
  }

  /**
   * Request validation middleware
   */
  validateRequest() {
    return (req, res, next) => {
      const errors = [];

      // Validate content type for POST requests
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        if (!req.is('application/json')) {
          errors.push('Content-Type must be application/json');
        }
      }

      // Validate request size
      const contentLength = parseInt(req.get('content-length') || '0');
      if (contentLength > 1024 * 1024) { // 1MB limit
        errors.push('Request body too large (max 1MB)');
      }

      // Validate authentication for protected endpoints
      if (this._requiresAuth(req.path) && !this._isAuthenticated(req)) {
        errors.push('Authentication required');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
          code: 'VALIDATION_FAILED'
        });
      }

      next();
    };
  }

  /**
   * Context pre-loading middleware
   */
  preloadContext() {
    return async (req, res, next) => {
      try {
        // Extract context parameters from request
        const { boardId, accountId, userId } = req.body || req.query;

        if (boardId || accountId) {
          // Store context hint for later use
          req.contextHint = {
            boardId,
            accountId,
            userId,
            timestamp: Date.now()
          };

          this.logger.info('Context hint stored', req.contextHint);
        }

        next();
      } catch (error) {
        this.logger.warn('Context preload failed', { error: error.message });
        // Don't fail the request, just continue without preloaded context
        next();
      }
    };
  }

  /**
   * Request enrichment middleware
   */
  enrichRequest() {
    return (req, res, next) => {
      // Add request metadata
      req.metadata = {
        requestId: this._generateRequestId(),
        timestamp: Date.now(),
        userAgent: req.get('user-agent'),
        ip: req.ip || req.connection.remoteAddress,
        method: req.method,
        path: req.path
      };

      // Add performance tracking
      req.startTime = process.hrtime.bigint();

      // Add correlation ID for tracking across services
      req.correlationId = req.get('x-correlation-id') || req.metadata.requestId;

      this.logger.info('Request enriched', {
        requestId: req.metadata.requestId,
        method: req.method,
        path: req.path,
        correlationId: req.correlationId
      });

      next();
    };
  }

  /**
   * Response caching middleware
   */
  responseCache() {
    const cache = new Map();
    const maxCacheSize = 100;
    const cacheTTL = AI_CONFIG.performance.enableCaching ? 300000 : 0; // 5 minutes

    return (req, res, next) => {
      if (!AI_CONFIG.performance.enableCaching || req.method !== 'GET') {
        return next();
      }

      const cacheKey = this._generateCacheKey(req);
      const cached = cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        this.logger.info('Cache hit', { cacheKey });

        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Key', cacheKey);
        return res.json(cached.data);
      }

      // Override res.json to cache the response
      const originalJson = res.json;
      res.json = function(data) {
        // Cache successful responses only
        if (res.statusCode === 200) {
          // Manage cache size
          if (cache.size >= maxCacheSize) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
          }

          cache.set(cacheKey, {
            data,
            timestamp: Date.now()
          });
        }

        res.set('X-Cache', 'MISS');
        res.set('X-Cache-Key', cacheKey);
        return originalJson.call(this, data);
      };

      next();
    };
  }

  /**
   * Performance monitoring middleware
   */
  performanceMonitor() {
    return (req, res, next) => {
      const startTime = Date.now();

      // Override res.end to measure response time
      const originalEnd = res.end;
      res.end = function(...args) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // Log performance metrics
        const metrics = {
          requestId: req.metadata?.requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          responseTime,
          contentLength: res.get('content-length'),
          timestamp: endTime
        };

        // Log slow requests
        if (responseTime > AI_CONFIG.performance.slowRequestThreshold) {
          req.logger?.warn('Slow request detected', metrics);
        }

        // Log failed requests
        if (res.statusCode >= 400) {
          req.logger?.warn('Request failed', metrics);
        }

        // Add performance headers
        res.set('X-Response-Time', `${responseTime}ms`);
        res.set('X-Request-ID', req.metadata?.requestId);

        return originalEnd.apply(this, args);
      };

      next();
    };
  }

  /**
   * Circuit breaker middleware
   */
  circuitBreakerMiddleware() {
    return (req, res, next) => {
      if (this.circuitBreaker.isOpen()) {
        this.logger.warn('Circuit breaker open, rejecting request');

        return res.status(503).json({
          error: 'Service temporarily unavailable',
          message: 'Circuit breaker is open due to recent failures',
          retryAfter: Math.ceil(this.circuitBreaker.getRetryAfter() / 1000),
          code: 'CIRCUIT_BREAKER_OPEN'
        });
      }

      // Track request for circuit breaker
      const originalEnd = res.end;
      res.end = function(...args) {
        if (res.statusCode >= 500) {
          this.circuitBreaker.recordFailure();
        } else {
          this.circuitBreaker.recordSuccess();
        }

        return originalEnd.apply(this, args);
      }.bind(this);

      next();
    };
  }

  /**
   * Error handling middleware
   */
  errorHandler() {
    return (error, req, res, next) => {
      this.logger.error('Request error', {
        error: error.message,
        stack: error.stack,
        requestId: req.metadata?.requestId,
        path: req.path,
        method: req.method
      });

      // Determine error type and response
      let statusCode = 500;
      let errorCode = 'INTERNAL_ERROR';
      let message = 'An internal error occurred';

      if (error.name === 'ValidationError') {
        statusCode = 400;
        errorCode = 'VALIDATION_ERROR';
        message = error.message;
      } else if (error.name === 'AuthenticationError') {
        statusCode = 401;
        errorCode = 'AUTHENTICATION_ERROR';
        message = 'Authentication failed';
      } else if (error.name === 'AuthorizationError') {
        statusCode = 403;
        errorCode = 'AUTHORIZATION_ERROR';
        message = 'Insufficient permissions';
      } else if (error.name === 'NotFoundError') {
        statusCode = 404;
        errorCode = 'NOT_FOUND';
        message = error.message;
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        statusCode = 503;
        errorCode = 'SERVICE_UNAVAILABLE';
        message = 'External service unavailable';
      }

      const errorResponse = {
        error: message,
        code: errorCode,
        requestId: req.metadata?.requestId,
        timestamp: Date.now()
      };

      // Include stack trace in development
      if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = error.stack;
        errorResponse.details = error.details;
      }

      res.status(statusCode).json(errorResponse);
    };
  }

  /**
   * Get client identifier for rate limiting
   * @private
   */
  _getClientIdentifier(req) {
    // Use account ID if available, otherwise fall back to IP
    const accountId = req.body?.accountId || req.query?.accountId;
    return accountId || req.ip || 'unknown';
  }

  /**
   * Check if endpoint requires authentication
   * @private
   */
  _requiresAuth(path) {
    const publicPaths = ['/health', '/debug'];
    return !publicPaths.some(publicPath => path.startsWith(publicPath));
  }

  /**
   * Check if request is authenticated
   * @private
   */
  _isAuthenticated(req) {
    // Check for JWT token or API key
    const authHeader = req.get('authorization');
    return authHeader && (authHeader.startsWith('Bearer ') || authHeader.length > 32);
  }

  /**
   * Generate cache key for response caching
   * @private
   */
  _generateCacheKey(req) {
    const keyParts = [
      req.method,
      req.path,
      JSON.stringify(req.query),
      req.get('accept-language') || 'en'
    ];

    return Buffer.from(keyParts.join('|')).toString('base64').substring(0, 32);
  }

  /**
   * Generate unique request ID
   * @private
   */
  _generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Reset rate limit counters
   * @private
   */
  _resetRateLimits() {
    const now = Date.now();
    const cutoff = now - this.resetCountsInterval;

    for (const [clientId, requests] of this.requestCounts.entries()) {
      const validRequests = requests.filter(timestamp => timestamp > cutoff);

      if (validRequests.length === 0) {
        this.requestCounts.delete(clientId);
      } else {
        this.requestCounts.set(clientId, validRequests);
      }
    }
  }
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker {
  constructor() {
    this.failureThreshold = AI_CONFIG.performance.failureThreshold;
    this.recoveryTimeout = AI_CONFIG.performance.recoveryTimeout;
    this.failures = 0;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = 0;
    this.logger = new Logger('circuit-breaker');
  }

  isOpen() {
    if (this.state === 'OPEN' && Date.now() > this.nextAttempt) {
      this.state = 'HALF_OPEN';
      this.logger.info('Circuit breaker transitioning to HALF_OPEN');
    }

    return this.state === 'OPEN';
  }

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failures = 0;
      this.logger.info('Circuit breaker reset to CLOSED');
    } else if (this.state === 'CLOSED') {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  recordFailure() {
    this.failures++;

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.recoveryTimeout;
      this.logger.warn('Circuit breaker opened', {
        failures: this.failures,
        nextAttempt: new Date(this.nextAttempt)
      });
    }
  }

  getRetryAfter() {
    return Math.max(0, this.nextAttempt - Date.now());
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      nextAttempt: this.nextAttempt,
      retryAfter: this.getRetryAfter()
    };
  }
}

module.exports = AIMiddleware;