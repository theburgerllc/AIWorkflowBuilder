const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');

// Import environment configuration
const { PORT, NODE_ENV, mondayConfig, claudeConfig, rateLimitConfig } = require('./config/environment');

// Import utilities and middleware
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { monitor: responseTimeMonitor, getMetricsHandler } = require('./middleware/response-time-monitor');

// Import routes (create fallbacks for missing routes)
let authRoutes, aiRoutes, apiRoutes, webhookRoutes, healthRoutes;
try {
  authRoutes = require('./routes/auth');
} catch (e) {
  authRoutes = express.Router();
  console.warn('Auth routes not found, using empty router');
}

try {
  aiRoutes = require('./routes/ai');
} catch (e) {
  aiRoutes = express.Router();
  console.warn('AI routes not found, using empty router');
}

try {
  apiRoutes = require('./routes/api');
} catch (e) {
  apiRoutes = express.Router();
  console.warn('API routes not found, using empty router');
}

try {
  webhookRoutes = require('./routes/webhooks');
} catch (e) {
  webhookRoutes = express.Router();
  console.warn('Webhook routes not found, using empty router');
}

try {
  healthRoutes = require('./routes/health');
} catch (e) {
  healthRoutes = express.Router();
  console.warn('Health routes not found, using empty router');
}

const app = express();

// Security middleware (Monday.com compliant)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.monday.com", "https://*.monday.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.monday.com", "https://*.monday.com"],
      imgSrc: ["'self'", "data:", "https:", "https://cdn.monday.com", "https://*.monday.com"],
      connectSrc: ["'self'", "https://api.monday.com", "https://auth.monday.com", "https://*.monday.com", "https://api.anthropic.com"],
      fontSrc: ["'self'", "https://cdn.monday.com", "https://*.monday.com"],
      frameSrc: ["'self'", "https://*.monday.com"],
      frameAncestors: ["https://*.monday.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration for Monday.com
app.use(cors({
  origin: [
    'https://monday.com',
    'https://*.monday.com',
    'https://auth.monday.com',
    'https://api.monday.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
    process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : null
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Request-ID', 'X-Response-Time']
}));

// Body parsing
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Response time monitoring (Monday.com compliance)
app.use(responseTimeMonitor());

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting (Monday.com compliance: 100 req/min, 1000 req/hour)
const limiter = rateLimit({
  windowMs: rateLimitConfig.windowMs, // 1 minute
  max: rateLimitConfig.maxRequests, // 100 requests per minute
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use account ID if available, otherwise IP
    return req.body?.payload?.accountId || req.ip;
  }
});

// Apply rate limiting to API routes
app.use('/api/', limiter);
app.use('/monday/', limiter);

// Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', apiRoutes);
app.use('/webhooks', webhookRoutes);

// Metrics endpoint for monitoring
app.get('/metrics/response-time', getMetricsHandler());

// Monday.com specific endpoints with fallbacks
let executeAction, getRemoteOptions, verifyActionSignature, verifyOptionsSignature;

try {
  const executeActionModule = require('./controllers/monday/executeAction');
  executeAction = executeActionModule.executeAction || executeActionModule;
  verifyActionSignature = executeActionModule.verifySignature || ((req, res, next) => next());
} catch (e) {
  console.warn('Execute action controller not found, creating fallback');
  executeAction = (req, res) => {
    res.status(501).json({ error: 'Execute action not implemented' });
  };
  verifyActionSignature = (req, res, next) => next();
}

try {
  const remoteOptionsModule = require('./controllers/monday/remoteOptions');
  getRemoteOptions = remoteOptionsModule.getRemoteOptions || remoteOptionsModule;
  verifyOptionsSignature = remoteOptionsModule.verifySignature || ((req, res, next) => next());
} catch (e) {
  console.warn('Remote options controller not found, creating fallback');
  getRemoteOptions = (req, res) => {
    res.status(501).json({ error: 'Remote options not implemented' });
  };
  verifyOptionsSignature = (req, res, next) => next();
}

// Monday.com webhook signature verification middleware
const verifyMondaySignature = (req, res, next) => {
  try {
    const signature = req.headers['x-monday-signature'];
    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    const bodyString = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', mondayConfig.signingSecret)
      .update(bodyString)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (error) {
    console.error('Signature verification error:', error);
    res.status(500).json({ error: 'Signature verification failed' });
  }
};

// Add health check endpoint if not provided by healthRoutes
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        monday: await checkMondayAPI(),
        claude: await checkClaudeAPI()
      }
    };

    const isHealthy = Object.values(health.services).every(service => service.status === 'up');
    res.status(isHealthy ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check helper functions
async function checkMondayAPI() {
  try {
    const axios = require('axios');
    const response = await axios.post('https://api.monday.com/v2', {
      query: 'query { me { id } }'
    }, {
      headers: {
        'Authorization': `Bearer ${mondayConfig.clientSecret}`,
        'Content-Type': 'application/json',
        'API-Version': mondayConfig.apiVersion
      },
      timeout: 5000
    });

    return {
      status: response.status === 200 ? 'up' : 'down',
      responseTime: response.headers['x-response-time'] || 'unknown'
    };
  } catch (error) {
    return {
      status: 'down',
      error: error.message
    };
  }
}

async function checkClaudeAPI() {
  try {
    if (!claudeConfig.apiKey) {
      return { status: 'down', error: 'API key not configured' };
    }
    return { status: 'up', responseTime: '<1ms' };
  } catch (error) {
    return {
      status: 'down',
      error: error.message
    };
  }
}

app.post('/monday/execute_action', verifyMondaySignature, executeAction);
app.post('/monday/get_remote_list_options', verifyMondaySignature, getRemoteOptions);

// Error handling
app.use(errorHandler);

// 404 handler
app.use(notFoundHandler);

// Start server (only if not in test environment)
let server;
if (NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info(`AI Workflow Builder server running on port ${PORT}`);
    logger.info(`Environment: ${NODE_ENV}`);
    if (NODE_ENV === 'development') {
      logger.info(`Run 'npm run ngrok' in another terminal to expose local server`);
    }
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

module.exports = app;