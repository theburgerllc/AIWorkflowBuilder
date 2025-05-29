/**
 * Centralized Environment Configuration
 * Manages all environment variables and provides defaults
 */

const path = require('path');

// Load environment variables
require('dotenv').config();

/**
 * Environment Configuration Object
 */
const environment = {
  // Application Configuration
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3000,
  APP_URL: process.env.APP_URL || process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  APP_BASE_URL: process.env.APP_BASE_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Monday.com Configuration
  MONDAY_CLIENT_ID: process.env.MONDAY_CLIENT_ID,
  MONDAY_CLIENT_SECRET: process.env.MONDAY_CLIENT_SECRET,
  MONDAY_SIGNING_SECRET: process.env.MONDAY_SIGNING_SECRET,
  MONDAY_APP_ID: process.env.MONDAY_APP_ID,
  MONDAY_APP_VERSION_ID: process.env.MONDAY_APP_VERSION_ID,
  MONDAY_API_URL: process.env.MONDAY_API_URL || 'https://api.monday.com/v2',
  MONDAY_API_VERSION: process.env.MONDAY_API_VERSION || '2024-01',

  // OAuth Configuration
  REDIRECT_URI: process.env.REDIRECT_URI || `${process.env.APP_BASE_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`}/auth/monday/callback`,

  // Claude AI Configuration
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
  CLAUDE_API_URL: process.env.CLAUDE_API_URL || 'https://api.anthropic.com',

  // Security Configuration
  JWT_SECRET: process.env.JWT_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  SESSION_SECRET: process.env.SESSION_SECRET,

  // Rate Limiting Configuration
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  RATE_LIMIT_HOUR_MAX: parseInt(process.env.RATE_LIMIT_HOUR_MAX) || 1000,

  // Database Configuration
  DATABASE_URL: process.env.DATABASE_URL,

  // Storage Configuration
  STORAGE_ENCRYPTION_KEY: process.env.STORAGE_ENCRYPTION_KEY,

  // Logging Configuration
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  // Development Configuration
  DEBUG: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
  VERBOSE_LOGGING: process.env.VERBOSE_LOGGING === 'true',

  // Production Configuration
  HTTPS_ONLY: process.env.HTTPS_ONLY === 'true' || process.env.NODE_ENV === 'production',
  TRUST_PROXY: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',

  // Health Check Configuration
  HEALTH_CHECK_TIMEOUT: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000,
  HEALTH_CHECK_INTERVAL: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,

  // Performance Configuration
  RESPONSE_TIME_THRESHOLD: parseInt(process.env.RESPONSE_TIME_THRESHOLD) || 2000, // Monday.com requirement
  RESPONSE_TIME_WARNING: parseInt(process.env.RESPONSE_TIME_WARNING) || 1500,

  // Cache Configuration
  CACHE_TTL: parseInt(process.env.CACHE_TTL) || 300000, // 5 minutes
  CACHE_MAX_SIZE: parseInt(process.env.CACHE_MAX_SIZE) || 1000,

  // Webhook Configuration
  WEBHOOK_TIMEOUT: parseInt(process.env.WEBHOOK_TIMEOUT) || 10000,
  WEBHOOK_RETRY_ATTEMPTS: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS) || 3,

  // Feature Flags
  ENABLE_METRICS: process.env.ENABLE_METRICS !== 'false',
  ENABLE_CACHING: process.env.ENABLE_CACHING !== 'false',
  ENABLE_RATE_LIMITING: process.env.ENABLE_RATE_LIMITING !== 'false',
  ENABLE_RESPONSE_TIME_MONITORING: process.env.ENABLE_RESPONSE_TIME_MONITORING !== 'false'
};

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const required = [
    'MONDAY_CLIENT_ID',
    'MONDAY_CLIENT_SECRET', 
    'MONDAY_SIGNING_SECRET',
    'ANTHROPIC_API_KEY',
    'JWT_SECRET'
  ];

  const missing = required.filter(key => !environment[key]);
  
  if (missing.length > 0 && environment.NODE_ENV !== 'test') {
    console.warn(`Warning: Missing required environment variables: ${missing.join(', ')}`);
    if (environment.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
}

/**
 * Get environment-specific configuration
 */
function getConfig() {
  return {
    ...environment,
    isDevelopment: environment.NODE_ENV === 'development',
    isProduction: environment.NODE_ENV === 'production',
    isTest: environment.NODE_ENV === 'test',
    
    // Computed values
    baseUrl: environment.APP_BASE_URL || environment.APP_URL,
    redirectUri: environment.REDIRECT_URI,
    
    // Monday.com specific
    mondayConfig: {
      clientId: environment.MONDAY_CLIENT_ID,
      clientSecret: environment.MONDAY_CLIENT_SECRET,
      signingSecret: environment.MONDAY_SIGNING_SECRET,
      apiUrl: environment.MONDAY_API_URL,
      apiVersion: environment.MONDAY_API_VERSION,
      appId: environment.MONDAY_APP_ID,
      appVersionId: environment.MONDAY_APP_VERSION_ID
    },
    
    // Claude AI specific
    claudeConfig: {
      apiKey: environment.ANTHROPIC_API_KEY,
      model: environment.CLAUDE_MODEL,
      apiUrl: environment.CLAUDE_API_URL
    },
    
    // Security specific
    securityConfig: {
      jwtSecret: environment.JWT_SECRET,
      encryptionKey: environment.ENCRYPTION_KEY,
      sessionSecret: environment.SESSION_SECRET
    },
    
    // Rate limiting specific
    rateLimitConfig: {
      windowMs: environment.RATE_LIMIT_WINDOW_MS,
      maxRequests: environment.RATE_LIMIT_MAX_REQUESTS,
      hourMax: environment.RATE_LIMIT_HOUR_MAX
    }
  };
}

// Validate environment on load (except in test)
if (environment.NODE_ENV !== 'test') {
  validateEnvironment();
}

module.exports = {
  environment,
  getConfig,
  validateEnvironment,
  ...getConfig()
};
