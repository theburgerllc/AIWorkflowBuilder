require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { logger } = require('./utils/logger');
const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhooks');
const healthRoutes = require('./routes/health');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting (Monday.com compliance: 100 req/min, 1000 req/hour)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per minute
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

// Monday.com specific endpoints
const { executeAction, verifySignature: verifyActionSignature } = require('./controllers/monday/executeAction');
const { getRemoteOptions, verifySignature: verifyOptionsSignature } = require('./controllers/monday/remoteOptions');

app.post('/monday/execute_action', verifyActionSignature, executeAction);
app.post('/monday/get_remote_list_options', verifyOptionsSignature, getRemoteOptions);

// Error handling
app.use(errorHandler);

// 404 handler
app.use(notFoundHandler);

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Claude for Monday.com server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  if (process.env.NODE_ENV === 'development') {
    logger.info(`Run 'npm run ngrok' in another terminal to expose local server`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;