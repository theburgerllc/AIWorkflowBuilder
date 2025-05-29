// routes/ai.js
const express = require('express');
const router = express.Router();
const { Logger } = require('@mondaycom/apps-sdk');

const OperationInterpreter = require('../nlp/operation-interpreter');
const OperationMapper = require('../nlp/operation-mapper');
const ContextService = require('../services/context');
const ClaudeService = require('../services/claude');
const AI_CONFIG = require('../config/ai');

class AIRoutes {
  constructor(mondayClient) {
    this.mondayClient = mondayClient;
    this.logger = require('../utils/logger');
    this.interpreter = new OperationInterpreter();
    this.mapper = new OperationMapper();
    this.contextService = new ContextService(mondayClient);
    this.claudeService = new ClaudeService();

    this._setupRoutes();
  }

  _setupRoutes() {
    // Main analysis endpoint
    router.post('/analyze-request', this._handleAnalyzeRequest.bind(this));

    // Operation validation endpoint
    router.post('/validate-operation', this._handleValidateOperation.bind(this));

    // Context endpoints
    router.get('/context/:boardId', this._handleGetContext.bind(this));
    router.post('/context/refresh', this._handleRefreshContext.bind(this));

    // Alternative suggestions endpoint
    router.post('/suggest-alternatives', this._handleSuggestAlternatives.bind(this));

    // Ambiguity resolution endpoint
    router.post('/resolve-ambiguity', this._handleResolveAmbiguity.bind(this));

    // Multi-operation detection endpoint
    router.post('/detect-multiple', this._handleDetectMultiple.bind(this));

    // Health check endpoint
    router.get('/health', this._handleHealthCheck.bind(this));

    // Debug endpoints (development only)
    if (process.env.NODE_ENV === 'development') {
      router.post('/debug/parse', this._handleDebugParse.bind(this));
      router.get('/debug/cache-stats', this._handleCacheStats.bind(this));
    }
  }

  /**
   * Main request analysis endpoint
   * POST /api/ai/analyze-request
   */
  async _handleAnalyzeRequest(req, res) {
    const startTime = Date.now();

    try {
      const { userInput, boardId, accountId, userId, contextType = 'full' } = req.body;

      // Validate input
      if (!userInput || userInput.trim().length === 0) {
        return res.status(400).json({
          error: 'User input is required',
          code: 'MISSING_INPUT'
        });
      }

      this.logger.info('Analyzing request', {
        inputLength: userInput.length,
        boardId,
        accountId,
        userId
      });

      // Gather context
      const context = await this.contextService.gatherContext({
        accountId,
        boardId,
        userId
      });

      // Interpret the operation
      const interpretation = await this.interpreter.interpret(userInput, context);

      // Map to API operations if confidence is high enough
      let apiOperation = null;
      if (interpretation.confidence >= AI_CONFIG.confidence.thresholds.requireConfirmation) {
        try {
          apiOperation = await this.mapper.mapToAPI(interpretation, context);
        } catch (mappingError) {
          this.logger.warn('API mapping failed', { error: mappingError.message });
          interpretation.warnings = interpretation.warnings || [];
          interpretation.warnings.push('Failed to map to Monday.com API');
        }
      }

      // Calculate response metadata
      const responseTime = Date.now() - startTime;
      const response = {
        interpretation,
        apiOperation,
        context: this._filterContextForResponse(context, contextType),
        metadata: {
          responseTime,
          confidence: interpretation.confidence,
          requiresConfirmation: interpretation.confidence < AI_CONFIG.confidence.thresholds.autoExecute,
          canAutoExecute: interpretation.confidence >= AI_CONFIG.confidence.thresholds.autoExecute
        }
      };

      // Log performance
      if (responseTime > AI_CONFIG.performance.slowRequestThreshold) {
        this.logger.warn('Slow request detected', { responseTime, userInput: userInput.substring(0, 100) });
      }

      res.json(response);

    } catch (error) {
      this.logger.error('Request analysis failed', { error: error.message, stack: error.stack });

      res.status(500).json({
        error: 'Analysis failed',
        message: error.message,
        code: 'ANALYSIS_FAILED'
      });
    }
  }

  /**
   * Operation validation endpoint
   * POST /api/ai/validate-operation
   */
  async _handleValidateOperation(req, res) {
    try {
      const { operation, context } = req.body;

      if (!operation) {
        return res.status(400).json({
          error: 'Operation is required',
          code: 'MISSING_OPERATION'
        });
      }

      this.logger.info('Validating operation', { operation: operation.operation });

      // Validate with Claude
      const validation = await this.claudeService.validateOperation(operation, context);

      // Additional context-based validation
      const contextValidation = this.contextService.validateContextForOperation(
        context, operation.operation
      );

      // Combine validations
      const combinedValidation = {
        valid: validation.valid && contextValidation.valid,
        errors: [...(validation.errors || []), ...contextValidation.missing],
        warnings: [...(validation.warnings || []), ...contextValidation.warnings],
        suggestions: validation.suggestions || [],
        confidence: validation.confidence || 0
      };

      res.json(combinedValidation);

    } catch (error) {
      this.logger.error('Operation validation failed', { error: error.message });

      res.status(500).json({
        error: 'Validation failed',
        message: error.message,
        code: 'VALIDATION_FAILED'
      });
    }
  }

  /**
   * Get context for specific board
   * GET /api/ai/context/:boardId
   */
  async _handleGetContext(req, res) {
    try {
      const { boardId } = req.params;
      const { accountId, userId } = req.query;

      this.logger.info('Fetching context', { boardId, accountId });

      const context = await this.contextService.gatherContext({
        accountId,
        boardId,
        userId
      });

      res.json({
        context: this._filterContextForResponse(context, 'minimal'),
        cached: false, // TODO: Add cache hit detection
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.error('Context fetch failed', { error: error.message });

      res.status(500).json({
        error: 'Context fetch failed',
        message: error.message,
        code: 'CONTEXT_FAILED'
      });
    }
  }

  /**
   * Refresh context cache
   * POST /api/ai/context/refresh
   */
  async _handleRefreshContext(req, res) {
    try {
      const { pattern } = req.body;

      this.contextService.clearCache(pattern);

      this.logger.info('Context cache refreshed', { pattern });

      res.json({
        success: true,
        message: 'Context cache refreshed',
        pattern: pattern || 'all'
      });

    } catch (error) {
      this.logger.error('Context refresh failed', { error: error.message });

      res.status(500).json({
        error: 'Context refresh failed',
        message: error.message,
        code: 'REFRESH_FAILED'
      });
    }
  }

  /**
   * Generate alternative suggestions
   * POST /api/ai/suggest-alternatives
   */
  async _handleSuggestAlternatives(req, res) {
    try {
      const { userInput, context } = req.body;

      if (!userInput) {
        return res.status(400).json({
          error: 'User input is required',
          code: 'MISSING_INPUT'
        });
      }

      this.logger.info('Generating alternatives', { inputLength: userInput.length });

      const alternatives = await this.claudeService.generateSuggestions(userInput, context);

      res.json({
        alternatives,
        count: alternatives.length,
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.error('Alternative generation failed', { error: error.message });

      res.status(500).json({
        error: 'Alternative generation failed',
        message: error.message,
        code: 'ALTERNATIVES_FAILED'
      });
    }
  }

  /**
   * Resolve ambiguous operations
   * POST /api/ai/resolve-ambiguity
   */
  async _handleResolveAmbiguity(req, res) {
    try {
      const { ambiguousOperation, userResponse, context } = req.body;

      if (!ambiguousOperation || !userResponse) {
        return res.status(400).json({
          error: 'Ambiguous operation and user response are required',
          code: 'MISSING_DATA'
        });
      }

      this.logger.info('Resolving ambiguity', {
        originalOperation: ambiguousOperation.operation
      });

      const resolved = await this.interpreter.resolveAmbiguity(
        ambiguousOperation, userResponse, context
      );

      // Map to API if confidence is sufficient
      let apiOperation = null;
      if (resolved.confidence >= AI_CONFIG.confidence.thresholds.requireConfirmation) {
        apiOperation = await this.mapper.mapToAPI(resolved, context);
      }

      res.json({
        resolved,
        apiOperation,
        confidenceImprovement: resolved.confidence - ambiguousOperation.confidence
      });

    } catch (error) {
      this.logger.error('Ambiguity resolution failed', { error: error.message });

      res.status(500).json({
        error: 'Ambiguity resolution failed',
        message: error.message,
        code: 'RESOLUTION_FAILED'
      });
    }
  }

  /**
   * Detect multiple operations in single request
   * POST /api/ai/detect-multiple
   */
  async _handleDetectMultiple(req, res) {
    try {
      const { userInput, context } = req.body;

      if (!userInput) {
        return res.status(400).json({
          error: 'User input is required',
          code: 'MISSING_INPUT'
        });
      }

      this.logger.info('Detecting multiple operations', { inputLength: userInput.length });

      const operations = await this.interpreter.detectMultipleOperations(userInput, context);

      // Map each operation to API calls
      const apiOperations = [];
      for (const operation of operations) {
        if (operation.confidence >= AI_CONFIG.confidence.thresholds.requireConfirmation) {
          try {
            const apiOp = await this.mapper.mapToAPI(operation, context);
            apiOperations.push(apiOp);
          } catch (mappingError) {
            this.logger.warn('Failed to map operation in sequence', {
              sequence: operation.sequence,
              error: mappingError.message
            });
          }
        }
      }

      res.json({
        operations,
        apiOperations,
        count: operations.length,
        executable: apiOperations.length,
        requiresConfirmation: operations.some(op =>
          op.confidence < AI_CONFIG.confidence.thresholds.autoExecute
        )
      });

    } catch (error) {
      this.logger.error('Multiple operation detection failed', { error: error.message });

      res.status(500).json({
        error: 'Multiple operation detection failed',
        message: error.message,
        code: 'MULTI_DETECTION_FAILED'
      });
    }
  }

  /**
   * Health check endpoint
   * GET /api/ai/health
   */
  async _handleHealthCheck(req, res) {
    try {
      const health = {
        status: 'healthy',
        timestamp: Date.now(),
        services: {}
      };

      // Check Claude service
      try {
        const claudeHealthy = await this.claudeService.healthCheck();
        health.services.claude = claudeHealthy ? 'healthy' : 'unhealthy';
      } catch (error) {
        health.services.claude = 'error';
      }

      // Check context cache
      try {
        const cacheStats = this.contextService.getCacheStats();
        health.services.cache = {
          status: 'healthy',
          stats: cacheStats
        };
      } catch (error) {
        health.services.cache = 'error';
      }

      // Overall status
      const allHealthy = Object.values(health.services).every(service =>
        service === 'healthy' || (service.status === 'healthy')
      );

      if (!allHealthy) {
        health.status = 'degraded';
        res.status(503);
      }

      res.json(health);

    } catch (error) {
      this.logger.error('Health check failed', { error: error.message });

      res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Debug parse endpoint (development only)
   * POST /api/ai/debug/parse
   */
  async _handleDebugParse(req, res) {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const { userInput, includePrompt = false } = req.body;

      const result = {
        input: userInput,
        quickMatch: this.interpreter._quickPatternMatch(userInput),
        timestamp: Date.now()
      };

      if (includePrompt) {
        result.prompt = this.claudeService._buildOperationPrompt(userInput, {});
      }

      res.json(result);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Debug cache stats endpoint (development only)
   * GET /api/ai/debug/cache-stats
   */
  async _handleCacheStats(req, res) {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const stats = this.contextService.getCacheStats();
      res.json({
        cache: stats,
        config: {
          ttls: {
            board: AI_CONFIG.context.boardContextTTL,
            user: AI_CONFIG.context.userContextTTL,
            permissions: AI_CONFIG.context.permissionsTTL
          },
          limits: {
            maxBoards: AI_CONFIG.context.maxBoardsToFetch,
            maxUsers: AI_CONFIG.context.maxUsersToFetch,
            maxItems: AI_CONFIG.context.maxItemsPerBoard
          }
        },
        timestamp: Date.now()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Filter context for response based on type
   * @private
   */
  _filterContextForResponse(context, type = 'full') {
    switch (type) {
      case 'minimal':
        return {
          boardsCount: context.boards?.length || 0,
          usersCount: context.users?.length || 0,
          currentBoardId: context.currentBoard?.id,
          currentBoardName: context.currentBoard?.name,
          permissions: context.permissions,
          timestamp: context.timestamp
        };

      case 'summary':
        return {
          boards: context.boards?.map(b => ({ id: b.id, name: b.name })),
          users: context.users?.map(u => ({ id: u.id, name: u.name })),
          currentBoard: context.currentBoard ? {
            id: context.currentBoard.id,
            name: context.currentBoard.name,
            groupsCount: context.currentBoard.groups?.length,
            columnsCount: context.currentBoard.columns?.length
          } : null,
          permissions: context.permissions,
          timestamp: context.timestamp
        };

      case 'full':
      default:
        return context;
    }
  }

  /**
   * Get router instance
   */
  getRouter() {
    return router;
  }
}

module.exports = AIRoutes;