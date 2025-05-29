// controllers/monday/executeAction.js
const crypto = require('crypto');
const logger = require('../../utils/logger');
const ClaudeService = require('../../services/claude');
const OperationExecutor = require('../../services/operation-executor');
const ValidationService = require('../../services/validation');
const ContextService = require('../../services/context');
const ErrorRecoveryService = require('../../services/error-recovery');

class ExecuteActionController {
  constructor() {
    this.claudeService = new ClaudeService();
    this.operationExecutor = new OperationExecutor();
    this.validationService = new ValidationService();
    this.contextService = new ContextService();
    this.errorRecoveryService = ErrorRecoveryService;
  }

  /**
   * Verify Monday.com webhook signature
   */
  verifySignature(req, res, next) {
    try {
      const signature = req.get('authorization');
      const body = JSON.stringify(req.body);

      if (!signature) {
        logger.warn('Missing Monday.com signature');
        return res.status(401).json({ error: 'Missing signature' });
      }

      // Monday.com sends signature as "Bearer <signature>"
      const receivedSignature = signature.replace('Bearer ', '');

      // Calculate expected signature
      const expectedSignature = crypto
        .createHmac('sha256', process.env.MONDAY_SIGNING_SECRET)
        .update(body)
        .digest('hex');

      if (receivedSignature !== expectedSignature) {
        logger.warn('Invalid Monday.com signature', {
          received: receivedSignature.substring(0, 10) + '...',
          expected: expectedSignature.substring(0, 10) + '...'
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      next();
    } catch (error) {
      logger.error('Signature verification failed', { error: error.message });
      res.status(500).json({ error: 'Signature verification failed' });
    }
  }

  /**
   * Main action execution endpoint for Monday.com
   * POST /monday/execute_action
   */
  async executeAction(req, res) {
    const startTime = Date.now();

    try {
      const { payload } = req.body;

      if (!payload) {
        return res.status(400).json({
          error: 'Missing payload',
          code: 'MISSING_PAYLOAD'
        });
      }

      const {
        inputFields,
        inboundFieldValues,
        recipe,
        triggerEvent,
        boardId,
        itemId,
        userId,
        accountId
      } = payload;

      logger.info('Monday.com action execution started', {
        boardId,
        itemId,
        userId,
        accountId,
        actionType: recipe?.name
      });

      // Extract user input from inputFields
      const userInput = this.extractUserInput(inputFields);
      if (!userInput) {
        return res.status(400).json({
          error: 'No user input found in action fields',
          code: 'MISSING_USER_INPUT'
        });
      }

      // Gather context for AI processing
      const context = await this.contextService.gatherContext({
        accountId,
        boardId,
        userId
      });

      // Add trigger event context
      context.triggerEvent = triggerEvent;
      context.inboundFieldValues = inboundFieldValues;
      context.currentItem = { id: itemId };

      // Process user input with Claude AI
      const aiResponse = await this.claudeService.processUserRequest(userInput, context);

      if (!aiResponse.success) {
        return res.status(400).json({
          error: 'AI processing failed',
          message: aiResponse.error,
          code: 'AI_PROCESSING_FAILED'
        });
      }

      // Validate the proposed operations
      const validation = await this.validationService.validateOperations(
        aiResponse.operations,
        context
      );

      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Operation validation failed',
          details: validation.errors,
          code: 'VALIDATION_FAILED'
        });
      }

      // Execute the operations with error recovery
      const executionResults = [];
      for (const operation of aiResponse.operations) {
        let attempt = 1;
        const maxAttempts = 3;
        let lastError = null;

        while (attempt <= maxAttempts) {
          try {
            const result = await this.operationExecutor.execute(operation, {
              ...context,
              accessToken: req.mondayAccessToken || context.accessToken,
              attempt
            });

            executionResults.push({
              operation: operation.type,
              success: true,
              result: result,
              attempts: attempt
            });
            break; // Success, exit retry loop

          } catch (operationError) {
            lastError = operationError;

            // Attempt error recovery
            const recoveryResult = await this.errorRecoveryService.attemptRecovery(
              operationError,
              { operation, attempt, ...context }
            );

            if (recoveryResult.successful && recoveryResult.shouldRetry && attempt < maxAttempts) {
              logger.info('Retrying operation after recovery', {
                operation: operation.type,
                attempt: attempt + 1,
                recoveryStrategy: recoveryResult.strategy
              });
              attempt++;

              // Apply any data fixes from recovery
              if (recoveryResult.newData) {
                operation.parameters = recoveryResult.newData;
              }

              continue; // Retry the operation
            } else {
              // Recovery failed or not possible
              logger.error('Operation execution failed after recovery attempts', {
                operation: operation.type,
                error: operationError.message,
                attempts: attempt,
                recoveryAttempted: recoveryResult.attempted || false
              });

              executionResults.push({
                operation: operation.type,
                success: false,
                error: operationError.message,
                attempts: attempt,
                recovery: recoveryResult
              });
              break; // Exit retry loop
            }
          }
        }
      }

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      // Log successful execution
      logger.info('Monday.com action execution completed', {
        boardId,
        itemId,
        executionTime,
        operationsCount: aiResponse.operations.length,
        successfulOperations: executionResults.filter(r => r.success).length
      });

      // Return Monday.com compatible response
      res.json({
        success: true,
        message: aiResponse.summary || 'Operations executed successfully',
        executionResults,
        operationsExecuted: aiResponse.operations.length,
        executionTime,
        aiConfidence: aiResponse.confidence
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;

      logger.error('Monday.com action execution failed', {
        error: error.message,
        stack: error.stack,
        executionTime,
        payload: req.body.payload
      });

      // Return Monday.com compatible error response
      res.status(500).json({
        success: false,
        error: 'Action execution failed',
        message: error.message,
        code: 'EXECUTION_FAILED',
        executionTime
      });
    }
  }

  /**
   * Extract user input from Monday.com input fields
   */
  extractUserInput(inputFields) {
    if (!inputFields || typeof inputFields !== 'object') {
      return null;
    }

    // Look for common field names that contain user input
    const inputFieldNames = [
      'user_input',
      'prompt',
      'instruction',
      'command',
      'request',
      'text_input',
      'ai_prompt'
    ];

    for (const fieldName of inputFieldNames) {
      if (inputFields[fieldName] && typeof inputFields[fieldName] === 'string') {
        return inputFields[fieldName].trim();
      }
    }

    // If no specific field found, try to find any text field
    for (const [key, value] of Object.entries(inputFields)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  /**
   * Health check for the action executor
   */
  async healthCheck(req, res) {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          claude: await this.claudeService.isHealthy(),
          operationExecutor: await this.operationExecutor.isHealthy(),
          validation: await this.validationService.isHealthy(),
          context: await this.contextService.isHealthy()
        }
      };

      const isHealthy = Object.values(health.services).every(service => service === true);

      res.status(isHealthy ? 200 : 503).json(health);
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}

// Create singleton instance
const executeActionController = new ExecuteActionController();

// Export middleware and handler functions
module.exports = {
  verifySignature: executeActionController.verifySignature.bind(executeActionController),
  executeAction: executeActionController.executeAction.bind(executeActionController),
  healthCheck: executeActionController.healthCheck.bind(executeActionController)
};
