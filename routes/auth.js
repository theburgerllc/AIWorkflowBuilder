const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { mondayConfig } = require('../config/monday');
const logger = require('../utils/logger');
const cache = require('../utils/cache');
const crypto = require('crypto');

// Generate state parameter for CSRF protection
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * GET /auth/monday - Initiate OAuth flow
 */
router.get('/monday', (req, res) => {
  try {
    const state = generateState();

    // Store state for verification
    cache.set(`oauth_state_${state}`, true, 600); // 10 min expiry

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: mondayConfig.clientId,
      redirect_uri: process.env.REDIRECT_URI,
      scope: mondayConfig.requiredScopes.join(' '),
      state: state,
      response_type: 'code'
    });

    const authUrl = `${mondayConfig.oauthUrl}?${params.toString()}`;

    logger.info('Initiating OAuth flow', { state });
    res.redirect(authUrl);
  } catch (error) {
    logger.error('OAuth initiation failed:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

/**
 * GET /auth/monday/callback - OAuth callback handler
 */
router.get('/monday/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      logger.error('OAuth error:', error);
      return res.status(400).json({ error: `OAuth failed: ${error}` });
    }

    // Verify state parameter
    if (!state || !cache.get(`oauth_state_${state}`)) {
      logger.error('Invalid state parameter');
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Clear state from cache
    cache.del(`oauth_state_${state}`);

    // Exchange code for token
    const tokenResponse = await axios.post(mondayConfig.tokenUrl, {
      client_id: mondayConfig.clientId,
      client_secret: mondayConfig.clientSecret,
      code: code,
      redirect_uri: process.env.REDIRECT_URI
    });

    const { access_token, scope } = tokenResponse.data;

    // Verify we got all required scopes
    const grantedScopes = scope.split(' ');
    const missingScopes = mondayConfig.requiredScopes.filter(
      s => !grantedScopes.includes(s)
    );

    if (missingScopes.length > 0) {
      logger.warn('Missing required scopes:', missingScopes);
    }

    // Get user info using the token
    const userResponse = await axios.post(
      mondayConfig.apiUrl,
      {
        query: `query { me { id account { id } } }`
      },
      {
        headers: {
          'Authorization': access_token,
          'Content-Type': 'application/json'
        }
      }
    );

    const { id: userId, account: { id: accountId } } = userResponse.data.data.me;

    // Store token securely (TODO: Use secure storage in production)
    const cacheKey = `monday_token_${accountId}_${userId}`;
    cache.set(cacheKey, access_token); // No expiry - tokens are permanent

    logger.info('OAuth flow completed successfully', { accountId, userId });

    // TODO: Redirect to app UI in Phase 3
    res.json({
      success: true,
      message: 'Authentication successful',
      accountId,
      userId
    });

  } catch (error) {
    logger.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /auth/refresh - Refresh authentication (placeholder)
 */
router.post('/refresh', async (req, res) => {
  // Monday.com tokens don't expire, but keep endpoint for future use
  res.json({ message: 'Token refresh not required for Monday.com' });
});

/**
 * POST /auth/logout - Clear stored tokens
 */
router.post('/logout', (req, res) => {
  const { accountId, userId } = req.body;

  if (accountId && userId) {
    const cacheKey = `monday_token_${accountId}_${userId}`;
    cache.del(cacheKey);
  }

  res.json({ success: true });
});

module.exports = router;