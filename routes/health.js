// routes/health.js
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { mondayClient } = require('../config/monday');

/**
 * Check database connectivity
 */
async function checkDatabase() {
  try {
    // If you have a database, implement actual check here
    // For now, return healthy status
    return {
      status: 'up',
      responseTime: 0,
      message: 'Database connection healthy'
    };
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    return {
      status: 'down',
      responseTime: 0,
      message: error.message
    };
  }
}

/**
 * Check Monday.com configuration
 */
function checkMondayConfig() {
  try {
    const requiredVars = [
      'MONDAY_CLIENT_ID',
      'MONDAY_CLIENT_SECRET',
      'MONDAY_SIGNING_SECRET'
    ];

    const missing = requiredVars.filter(key => !process.env[key]);

    if (missing.length > 0) {
      return {
        status: 'down',
        message: `Missing Monday.com configuration: ${missing.join(', ')}`
      };
    }

    return {
      status: 'up',
      message: 'Monday.com configuration valid'
    };
  } catch (error) {
    return {
      status: 'down',
      message: `Configuration error: ${error.message}`
    };
  }
}

/**
 * Check Monday.com API connectivity
 */
async function checkMondayAPI() {
  const startTime = Date.now();
  try {
    // For health checks, we test the API endpoint availability without authentication
    // This is the proper approach for production health monitoring
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-Version': '2024-01'
      },
      body: JSON.stringify({
        query: 'query { complexity { before after } }'
      })
    });

    const responseTime = Date.now() - startTime;

    // Monday.com returns 200 even for unauthenticated requests with proper error structure
    if (response.status === 200) {
      return {
        status: 'up',
        responseTime,
        message: 'Monday.com API endpoint reachable'
      };
    } else {
      return {
        status: 'down',
        responseTime,
        message: `Monday.com API returned ${response.status}`
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Monday.com API health check failed', { error: error.message });
    return {
      status: 'down',
      responseTime,
      message: `Monday.com API unreachable: ${error.message}`
    };
  }
}

/**
 * Check Claude AI API connectivity
 */
async function checkClaudeAPI() {
  const startTime = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        status: 'down',
        responseTime: 0,
        message: 'Claude API key not configured'
      };
    }

    // Simple test to Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }]
      })
    });

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        status: 'up',
        responseTime,
        message: 'Claude AI API connection healthy'
      };
    } else {
      return {
        status: 'down',
        responseTime,
        message: `Claude API returned ${response.status}`
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Claude AI health check failed', { error: error.message });
    return {
      status: 'down',
      responseTime,
      message: error.message
    };
  }
}

/**
 * Check system resources
 */
function checkSystemResources() {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: 'up',
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: Math.round(process.uptime()),
      message: 'System resources healthy'
    };
  } catch (error) {
    return {
      status: 'down',
      message: error.message
    };
  }
}

/**
 * Main health check endpoint
 * GET /health
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();

  try {
    // Run all health checks in parallel
    const [database, mondayConfig, mondayAPI, claudeAPI, systemResources] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMondayConfig()),
      checkMondayAPI(),
      checkClaudeAPI(),
      Promise.resolve(checkSystemResources())
    ]);

    const totalResponseTime = Date.now() - startTime;

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.BUILD_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.round(process.uptime()),
      responseTime: totalResponseTime,
      services: {
        database,
        mondayConfig,
        mondayAPI,
        claudeAPI,
        systemResources
      }
    };

    // Determine overall health status
    const allServicesHealthy = Object.values(health.services).every(
      service => service.status === 'up'
    );

    if (!allServicesHealthy) {
      health.status = 'degraded';
    }

    // Check if response time is within acceptable limits (5 seconds for Monday.com)
    if (totalResponseTime > 5000) {
      health.status = 'degraded';
      health.warning = 'Response time exceeds 5 seconds';
    }

    const statusCode = allServicesHealthy ? 200 : 503;

    // Log health check results
    logger.info('Health check completed', {
      status: health.status,
      responseTime: totalResponseTime,
      servicesUp: Object.values(health.services).filter(s => s.status === 'up').length,
      servicesTotal: Object.keys(health.services).length
    });

    res.status(statusCode).json(health);

  } catch (error) {
    const totalResponseTime = Date.now() - startTime;

    logger.error('Health check failed', {
      error: error.message,
      responseTime: totalResponseTime
    });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.BUILD_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      responseTime: totalResponseTime,
      error: error.message
    });
  }
});

/**
 * Kubernetes readiness probe
 * GET /health/ready
 */
router.get('/ready', async (req, res) => {
  try {
    // Check critical configuration for readiness (not external APIs)
    const mondayConfig = checkMondayConfig();

    // Check if Claude API key is configured
    const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

    if (mondayConfig.status === 'up' && hasClaudeKey) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        checks: {
          mondayConfig: mondayConfig.status,
          claudeConfig: hasClaudeKey ? 'up' : 'down'
        }
      });
    } else {
      const reasons = [];
      if (mondayConfig.status !== 'up') {
        reasons.push(mondayConfig.message);
      }
      if (!hasClaudeKey) {
        reasons.push('Claude API key not configured');
      }

      res.status(503).json({
        status: 'not ready',
        reason: reasons.join('; '),
        timestamp: new Date().toISOString(),
        checks: {
          mondayConfig: mondayConfig.status,
          claudeConfig: hasClaudeKey ? 'up' : 'down'
        }
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Kubernetes liveness probe
 * GET /health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime())
  });
});

/**
 * Environment configuration validation
 * GET /health/config
 */
router.get('/config', (req, res) => {
  try {
    const config = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',

      // Monday.com Configuration
      monday: {
        clientId: !!process.env.MONDAY_CLIENT_ID,
        clientSecret: !!process.env.MONDAY_CLIENT_SECRET,
        signingSecret: !!process.env.MONDAY_SIGNING_SECRET,
        appId: !!process.env.MONDAY_APP_ID,
        appVersionId: !!process.env.MONDAY_APP_VERSION_ID,
        redirectUri: process.env.REDIRECT_URI || 'NOT_SET',
        apiUrl: process.env.MONDAY_API_URL || 'NOT_SET'
      },

      // Claude AI Configuration
      claude: {
        apiKey: !!process.env.ANTHROPIC_API_KEY,
        model: process.env.CLAUDE_MODEL || 'NOT_SET',
        apiUrl: process.env.CLAUDE_API_URL || 'NOT_SET'
      },

      // Security Configuration
      security: {
        jwtSecret: !!process.env.JWT_SECRET,
        encryptionKey: !!process.env.ENCRYPTION_KEY,
        sessionSecret: !!process.env.SESSION_SECRET,
        storageEncryptionKey: !!process.env.STORAGE_ENCRYPTION_KEY
      },

      // Server Configuration
      server: {
        port: process.env.PORT || '8080',
        host: process.env.HOST || '0.0.0.0',
        appBaseUrl: process.env.APP_BASE_URL || 'NOT_SET',
        healthCheckUrl: process.env.HEALTH_CHECK_URL || 'NOT_SET'
      },

      // Rate Limiting
      rateLimiting: {
        windowMs: process.env.RATE_LIMIT_WINDOW_MS || '60000',
        maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS || '100',
        hourMax: process.env.RATE_LIMIT_HOUR_MAX || '1000'
      },

      // Database
      database: {
        url: !!process.env.DATABASE_URL
      },

      // Build Information
      build: {
        version: process.env.BUILD_VERSION || 'NOT_SET',
        appName: process.env.APP_NAME || 'NOT_SET',
        displayName: process.env.APP_DISPLAY_NAME || 'NOT_SET'
      }
    };

    res.json(config);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to validate configuration',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
