const jwt = require('jsonwebtoken');
const axios = require('axios');
const logger = require('../utils/logger');
const { mondayConfig } = require('../config/monday');
const cache = require('../utils/cache');

/**
 * Verify JWT from Monday.com webhooks and API calls
 */
async function verifyMondayJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header provided' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Determine which secret to use based on the request source
    const isWebhook = req.path.includes('/webhooks');
    const secret = isWebhook
      ? mondayConfig.signingSecret
      : mondayConfig.clientSecret;

    // Verify and decode the JWT
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256']
    });

    // Validate token hasn't expired
    if (decoded.exp && decoded.exp < Date.now() / 1000) {
      return res.status(401).json({ error: 'Token expired' });
    }

    // Extract important fields
    req.session = {
      accountId: decoded.accountId,
      userId: decoded.userId,
      backToUrl: decoded.backToUrl,
      shortLivedToken: decoded.shortLivedToken
    };

    // Log successful authentication
    logger.debug('JWT verified successfully', {
      accountId: decoded.accountId,
      userId: decoded.userId
    });

    next();
  } catch (error) {
    logger.error('JWT verification failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Verify user has valid Monday access token
 */
async function requireMondayAuth(req, res, next) {
  try {
    const { accountId, userId } = req.session || {};

    if (!accountId || !userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check cache for stored access token
    const cacheKey = `monday_token_${accountId}_${userId}`;
    let accessToken = cache.get(cacheKey);

    if (!accessToken) {
      // TODO: In Phase 2, implement token refresh logic
      return res.status(401).json({ error: 'No valid access token found' });
    }

    // Attach token to request for API calls
    req.mondayAccessToken = accessToken;

    next();
  } catch (error) {
    logger.error('Monday auth check failed:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Extract and validate Monday context from request
 */
function extractMondayContext(req, res, next) {
  try {
    // Extract context from different sources
    const context = {
      accountId: req.body.accountId || req.query.accountId || req.session?.accountId,
      userId: req.body.userId || req.query.userId || req.session?.userId,
      boardId: req.body.boardId || req.query.boardId,
      itemId: req.body.itemId || req.query.itemId,
      instanceId: req.body.instanceId || req.query.instanceId
    };

    // Validate required context
    if (!context.accountId) {
      return res.status(400).json({ error: 'Missing account context' });
    }

    req.mondayContext = context;
    next();
  } catch (error) {
    logger.error('Context extraction failed:', error);
    return res.status(500).json({ error: 'Failed to extract context' });
  }
}

/**
 * Rate limit check per account
 */
async function checkRateLimit(req, res, next) {
  const accountId = req.session?.accountId || req.mondayContext?.accountId;

  if (!accountId) {
    return next();
  }

  const key = `rate_limit_${accountId}`;
  const limit = mondayConfig.rateLimits.requests;
  const windowMs = 60000; // 1 minute

  // Simple rate limiting using cache
  const current = cache.get(key) || 0;

  if (current >= limit) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60
    });
  }

  cache.set(key, current + 1, windowMs / 1000);
  next();
}

module.exports = {
  verifyMondayJWT,
  requireMondayAuth,
  extractMondayContext,
  checkRateLimit
};