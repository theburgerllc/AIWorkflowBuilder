// routes/api.js
const express = require('express');
const router = express.Router();
const { Logger } = require('@mondaycom/apps-sdk');

// Import middleware
const aiMiddleware = require('../middleware/ai');
const { requireMondayAuth } = require('../middleware/auth');

// Import services
const OperationExecutor = require('../services/operation-executor');
const ValidationService = require('../services/validation');
const logger = require('../utils/logger');
const operationExecutor = new OperationExecutor();
const validationService = new ValidationService();

// Apply middleware to all API routes
router.use(aiMiddleware.enrichRequest());
router.use(aiMiddleware.rateLimiter());
router.use(aiMiddleware.validateRequest());
router.use(aiMiddleware.performanceMonitor());

/**
 * Execute a validated operation
 * POST /api/execute
 */
router.post('/execute', requireMondayAuth, async (req, res) => {
  try {
    const { operation, context } = req.body;

    if (!operation) {
      return res.status(400).json({
        error: 'Operation is required',
        code: 'MISSING_OPERATION'
      });
    }

    // Validate the operation
    const validation = await validationService.validateOperation(operation);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Operation validation failed',
        details: validation.errors,
        code: 'VALIDATION_FAILED'
      });
    }

    // Execute the operation
    const result = await operationExecutor.execute(operation, {
      ...context,
      accessToken: req.mondayAccessToken,
      accountId: req.session?.accountId,
      userId: req.session?.userId
    });

    res.json({
      success: true,
      result,
      operation: operation.type,
      executionTime: Date.now() - req.startTime
    });

  } catch (error) {
    logger.error('Operation execution failed', {
      error: error.message,
      operation: req.body.operation?.type,
      requestId: req.metadata?.requestId
    });

    res.status(500).json({
      error: 'Operation execution failed',
      message: error.message,
      code: 'EXECUTION_FAILED'
    });
  }
});

/**
 * Validate an operation without executing it
 * POST /api/validate
 */
router.post('/validate', requireMondayAuth, async (req, res) => {
  try {
    const { operation } = req.body;

    if (!operation) {
      return res.status(400).json({
        error: 'Operation is required',
        code: 'MISSING_OPERATION'
      });
    }

    const validation = await validationService.validateOperation(operation);

    res.json({
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      suggestions: validation.suggestions
    });

  } catch (error) {
    logger.error('Operation validation failed', {
      error: error.message,
      requestId: req.metadata?.requestId
    });

    res.status(500).json({
      error: 'Validation failed',
      message: error.message,
      code: 'VALIDATION_ERROR'
    });
  }
});

/**
 * Get operation status
 * GET /api/status/:operationId
 */
router.get('/status/:operationId', requireMondayAuth, async (req, res) => {
  try {
    const { operationId } = req.params;
    const status = await operationExecutor.getStatus(operationId);

    if (!status) {
      return res.status(404).json({
        error: 'Operation not found',
        code: 'OPERATION_NOT_FOUND'
      });
    }

    res.json(status);

  } catch (error) {
    logger.error('Status check failed', {
      error: error.message,
      operationId: req.params.operationId,
      requestId: req.metadata?.requestId
    });

    res.status(500).json({
      error: 'Status check failed',
      message: error.message,
      code: 'STATUS_CHECK_FAILED'
    });
  }
});

/**
 * Cancel a running operation
 * POST /api/cancel/:operationId
 */
router.post('/cancel/:operationId', requireMondayAuth, async (req, res) => {
  try {
    const { operationId } = req.params;
    const result = await operationExecutor.cancel(operationId);

    res.json({
      success: true,
      cancelled: result.cancelled,
      message: result.message
    });

  } catch (error) {
    logger.error('Operation cancellation failed', {
      error: error.message,
      operationId: req.params.operationId,
      requestId: req.metadata?.requestId
    });

    res.status(500).json({
      error: 'Cancellation failed',
      message: error.message,
      code: 'CANCELLATION_FAILED'
    });
  }
});

/**
 * Get API health and metrics
 * GET /api/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    uptime: process.uptime(),
    services: {
      operationExecutor: operationExecutor.isHealthy(),
      validationService: validationService.isHealthy()
    }
  });
});

// Error handling middleware
router.use(aiMiddleware.errorHandler());

module.exports = router;
