const { Storage, SecureStorage, Logger } = require('@mondaycom/apps-sdk');
const axios = require('axios');
const logger = require('../utils/logger');

// Create a simple Monday client using axios
const mondayClient = {
  api: async (query, variables = {}) => {
    try {
      const response = await axios.post('https://api.monday.com/v2', {
        query,
        variables
      }, {
        headers: {
          'Content-Type': 'application/json',
          'API-Version': '2024-01'
        }
      });
      return response.data;
    } catch (error) {
      logger.error('Monday API call failed:', error);
      throw error;
    }
  }
};

// Configuration object
const mondayConfig = {
  clientId: process.env.MONDAY_CLIENT_ID,
  clientSecret: process.env.MONDAY_CLIENT_SECRET,
  signingSecret: process.env.MONDAY_SIGNING_SECRET,
  appId: process.env.MONDAY_APP_ID,
  appVersionId: process.env.MONDAY_APP_VERSION_ID,
  apiUrl: process.env.MONDAY_API_URL || 'https://api.monday.com/v2',
  oauthUrl: 'https://auth.monday.com/oauth2/authorize',
  tokenUrl: 'https://auth.monday.com/oauth2/token',

  // Required OAuth scopes for full functionality
  requiredScopes: [
    'me:read',
    'boards:read',
    'boards:write',
    'workspaces:read',
    'workspaces:write',
    'users:read',
    'account:read',
    'updates:read',
    'updates:write',
    'assets:read',
    'tags:read',
    'teams:read',
    'notifications:write',
    'webhooks:write'
  ],

  // Rate limiting configuration
  rateLimits: {
    complexity: 10000000, // 10M complexity per minute
    requests: 5000 // 5K requests per minute
  }
};

// Initialize storage instances
let storage = null;
let secureStorage = null;

/**
 * Initialize Monday storage with access token
 * @param {string} token - Monday access token
 */
function initializeStorage(token) {
  try {
    storage = new Storage(token);
    secureStorage = new SecureStorage();
    logger.info('Monday storage initialized successfully');
    return { storage, secureStorage };
  } catch (error) {
    logger.error('Failed to initialize Monday storage:', error);
    throw error;
  }
}

/**
 * Get Monday SDK instance
 */
function getMondayClient() {
  return mondayClient;
}

/**
 * Validate required environment variables
 */
function validateConfig() {
  const required = [
    'MONDAY_CLIENT_ID',
    'MONDAY_CLIENT_SECRET',
    'MONDAY_SIGNING_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  logger.info('Monday configuration validated successfully');
}

// Validate on module load
try {
  validateConfig();
} catch (error) {
  logger.error('Configuration validation failed:', error);
  // Allow server to start but log critical error
}

module.exports = {
  mondayConfig,
  mondayClient,
  getMondayClient,
  initializeStorage,
  validateConfig
};