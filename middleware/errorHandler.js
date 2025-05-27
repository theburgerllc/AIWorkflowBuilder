// middleware/errorHandler.js
const { logger } = require('../utils/logger');

/**
 * Global error handler middleware
 * This should be the last middleware in the chain
 */
function errorHandler(error, req, res, next) {
  // Log the error with context
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    requestId: req.metadata?.requestId,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent'),
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Don't send error details if response already sent
  if (res.headersSent) {
    return next(error);
  }

  // Determine error type and appropriate response
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'An internal server error occurred';
  let details = null;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = error.message;
    details = error.details;
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorCode = 'INVALID_ID';
    message = 'Invalid ID format';
  } else if (error.name === 'MongoError' && error.code === 11000) {
    statusCode = 409;
    errorCode = 'DUPLICATE_ENTRY';
    message = 'Duplicate entry';
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  } else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Authentication token expired';
  } else if (error.name === 'AuthenticationError') {
    statusCode = 401;
    errorCode = 'AUTHENTICATION_FAILED';
    message = 'Authentication failed';
  } else if (error.name === 'AuthorizationError') {
    statusCode = 403;
    errorCode = 'INSUFFICIENT_PERMISSIONS';
    message = 'Insufficient permissions';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    errorCode = 'RESOURCE_NOT_FOUND';
    message = error.message || 'Resource not found';
  } else if (error.name === 'ConflictError') {
    statusCode = 409;
    errorCode = 'CONFLICT';
    message = error.message || 'Resource conflict';
  } else if (error.name === 'RateLimitError') {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_EXCEEDED';
    message = 'Rate limit exceeded';
  } else if (error.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'External service unavailable';
  } else if (error.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorCode = 'GATEWAY_TIMEOUT';
    message = 'Request timeout';
  } else if (error.code === 'ENOTFOUND') {
    statusCode = 503;
    errorCode = 'DNS_ERROR';
    message = 'DNS resolution failed';
  } else if (error.status) {
    // Express errors with status property
    statusCode = error.status;
    message = error.message;
    errorCode = `HTTP_${statusCode}`;
  }

  // Build error response
  const errorResponse = {
    error: message,
    code: errorCode,
    timestamp: new Date().toISOString()
  };

  // Add request context
  if (req.metadata?.requestId) {
    errorResponse.requestId = req.metadata.requestId;
  }

  if (req.correlationId) {
    errorResponse.correlationId = req.correlationId;
  }

  // Add details in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
    errorResponse.details = details || error.details;
    
    // Add request details for debugging
    errorResponse.request = {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: sanitizeHeaders(req.headers)
    };
  }

  // Add retry information for certain errors
  if (statusCode === 429 || statusCode === 503) {
    errorResponse.retryAfter = error.retryAfter || 60; // seconds
  }

  // Set appropriate headers
  res.set('Content-Type', 'application/json');
  
  if (statusCode === 429) {
    res.set('Retry-After', errorResponse.retryAfter);
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
}

/**
 * Sanitize headers for logging (remove sensitive information)
 */
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  
  // Remove sensitive headers
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token'
  ];
  
  sensitiveHeaders.forEach(header => {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

/**
 * Handle 404 errors (route not found)
 */
function notFoundHandler(req, res) {
  logger.warn('Route not found', {
    method: req.method,
    path: req.path,
    userAgent: req.get('user-agent'),
    ip: req.ip,
    requestId: req.metadata?.requestId
  });

  res.status(404).json({
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    requestId: req.metadata?.requestId
  });
}

/**
 * Handle uncaught exceptions
 */
function handleUncaughtException(error) {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });

  // Graceful shutdown
  process.exit(1);
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(reason, promise) {
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
    timestamp: new Date().toISOString()
  });

  // Graceful shutdown
  process.exit(1);
}

// Set up global error handlers
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);

module.exports = {
  errorHandler,
  notFoundHandler,
  handleUncaughtException,
  handleUnhandledRejection
};
