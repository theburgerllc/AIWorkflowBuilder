// routes/health.js
const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
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
 * Check Monday.com API connectivity
 */
async function checkMondayAPI() {
  const startTime = Date.now();
  try {
    // Simple query to test Monday.com API
    const query = `query { me { id } }`;
    await mondayClient.request(query);
    
    const responseTime = Date.now() - startTime;
    return {
      status: 'up',
      responseTime,
      message: 'Monday.com API connection healthy'
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error('Monday.com API health check failed', { error: error.message });
    return {
      status: 'down',
      responseTime,
      message: error.message
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
    const [database, mondayAPI, claudeAPI, systemResources] = await Promise.all([
      checkDatabase(),
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
    // Check only critical services for readiness
    const mondayAPI = await checkMondayAPI();
    
    if (mondayAPI.status === 'up') {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        reason: 'Monday.com API unavailable',
        timestamp: new Date().toISOString()
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
 * Detailed health metrics (for monitoring)
 * GET /health/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const health = await router.get('/')._handler(req, { json: () => {} });
    
    // Add additional metrics
    const metrics = {
      ...health,
      process: {
        pid: process.pid,
        platform: process.platform,
        nodeVersion: process.version,
        architecture: process.arch
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        port: process.env.PORT,
        hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
        hasMondayConfig: !!(process.env.MONDAY_CLIENT_ID && process.env.MONDAY_CLIENT_SECRET)
      }
    };

    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
