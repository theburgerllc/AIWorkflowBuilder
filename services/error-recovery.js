// services/error-recovery.js
const logger = require('../utils/logger');

class ErrorRecoveryService {
  constructor() {
    this.recoveryStrategies = new Map();
    this.initializeStrategies();
  }

  /**
   * Initialize recovery strategies for different error types
   * @private
   */
  initializeStrategies() {
    // Rate limit errors
    this.recoveryStrategies.set('RATE_LIMIT_EXCEEDED', {
      canRecover: true,
      strategy: async (error, context) => {
        const retryAfter = error.retryAfter || 60;
        await this.delay(retryAfter * 1000);
        return { retry: true, delay: 0 };
      }
    });

    // Network errors
    this.recoveryStrategies.set('NETWORK_ERROR', {
      canRecover: true,
      strategy: async (error, context) => {
        // Exponential backoff
        const attempt = context.attempt || 1;
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await this.delay(delay);
        return { retry: true, delay: 0 };
      }
    });

    // Permission errors
    this.recoveryStrategies.set('PERMISSION_DENIED', {
      canRecover: false,
      strategy: async (error, context) => {
        return {
          retry: false,
          suggestion: 'Check your permissions for this operation',
          requiresUserAction: true
        };
      }
    });

    // Invalid data errors
    this.recoveryStrategies.set('INVALID_DATA', {
      canRecover: true,
      strategy: async (error, context) => {
        // Attempt to fix common data issues
        const fixed = await this.attemptDataFix(error, context);
        return fixed ? { retry: true, newData: fixed } : { retry: false };
      }
    });

    // Item not found
    this.recoveryStrategies.set('ITEM_NOT_FOUND', {
      canRecover: false,
      strategy: async (error, context) => {
        return {
          retry: false,
          suggestion: 'The item may have been deleted or moved',
          alternatives: await this.findAlternatives(context)
        };
      }
    });

    // Duplicate item
    this.recoveryStrategies.set('DUPLICATE_ITEM', {
      canRecover: true,
      strategy: async (error, context) => {
        // Suggest updating existing item instead
        return {
          retry: false,
          suggestion: 'Item already exists. Would you like to update it instead?',
          alternativeOperation: {
            type: 'update_item',
            parameters: {
              ...context.operation.parameters,
              itemId: error.existingItemId
            }
          }
        };
      }
    });
  }

  /**
   * Attempt to recover from an error
   * @param {Error} error - The error that occurred
   * @param {object} context - Context about the operation
   * @returns {object} Recovery result
   */
  async attemptRecovery(error, context) {
    try {
      const errorType = this.classifyError(error);
      const strategy = this.recoveryStrategies.get(errorType);

      if (!strategy) {
        return {
          successful: false,
          canRecover: false,
          error: 'No recovery strategy available'
        };
      }

      if (!strategy.canRecover) {
        const result = await strategy.strategy(error, context);
        return {
          successful: false,
          canRecover: false,
          ...result
        };
      }

      // Attempt recovery
      const recoveryResult = await strategy.strategy(error, context);

      if (recoveryResult.retry) {
        // Log recovery attempt
        logger.info('Error recovery successful', {
          errorType,
          operation: context.operation.type,
          success: true
        });

        return {
          successful: true,
          shouldRetry: true,
          ...recoveryResult
        };
      }

      return {
        successful: false,
        canRecover: false,
        ...recoveryResult
      };

    } catch (recoveryError) {
      logger.error('Error recovery failed', {
        recoveryError: recoveryError.message,
        originalError: error.message
      });
      return {
        successful: false,
        canRecover: false,
        error: 'Recovery attempt failed'
      };
    }
  }

  /**
   * Classify error type for recovery strategy
   * @private
   */
  classifyError(error) {
    const errorMessage = error.message || '';

    // Rate limit errors
    if (errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests') ||
        error.status === 429) {
      return 'RATE_LIMIT_EXCEEDED';
    }

    // Network errors
    if (errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        error.code === 'ECONNREFUSED') {
      return 'NETWORK_ERROR';
    }

    // Permission errors
    if (errorMessage.includes('permission') ||
        errorMessage.includes('unauthorized') ||
        error.status === 403) {
      return 'PERMISSION_DENIED';
    }

    // Invalid data
    if (errorMessage.includes('invalid') ||
        errorMessage.includes('validation') ||
        error.status === 400) {
      return 'INVALID_DATA';
    }

    // Not found
    if (errorMessage.includes('not found') ||
        error.status === 404) {
      return 'ITEM_NOT_FOUND';
    }

    // Duplicate
    if (errorMessage.includes('duplicate') ||
        errorMessage.includes('already exists')) {
      return 'DUPLICATE_ITEM';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Attempt to fix common data issues
   * @private
   */
  async attemptDataFix(error, context) {
    const { operation } = context;
    const fixes = {
      // Fix date format issues
      dateFormat: (value) => {
        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return value;
        }
        try {
          const date = new Date(value);
          return date.toISOString().split('T')[0];
        } catch {
          return null;
        }
      },

      // Fix number format issues
      numberFormat: (value) => {
        if (typeof value === 'number') {
          return value.toString();
        }
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed.toString();
      },

      // Fix status format issues
      statusFormat: (value) => {
        if (typeof value === 'string') {
          return { label: value };
        }
        return value;
      },

      // Fix people format issues
      peopleFormat: (value) => {
        if (typeof value === 'number') {
          return { personsAndTeams: [{ id: value, kind: 'person' }] };
        }
        if (Array.isArray(value)) {
          return {
            personsAndTeams: value.map(id => ({ id, kind: 'person' }))
          };
        }
        return value;
      }
    };

    // Try to fix column values
    if (operation.parameters.columnValues) {
      const fixed = {};
      let hasChanges = false;

      for (const [key, value] of Object.entries(operation.parameters.columnValues)) {
        // Determine column type from error message or key
        let fixedValue = value;

        if (key.includes('date')) {
          fixedValue = fixes.dateFormat(value);
        } else if (key.includes('number') || key.includes('count')) {
          fixedValue = fixes.numberFormat(value);
        } else if (key.includes('status')) {
          fixedValue = fixes.statusFormat(value);
        } else if (key.includes('person') || key.includes('people')) {
          fixedValue = fixes.peopleFormat(value);
        }

        if (fixedValue !== value) {
          hasChanges = true;
        }
        fixed[key] = fixedValue;
      }

      if (hasChanges) {
        return {
          ...operation.parameters,
          columnValues: fixed
        };
      }
    }

    return null;
  }

  /**
   * Find alternative operations or items
   * @private
   */
  async findAlternatives(context) {
    const alternatives = [];

    // Suggest similar items
    if (context.operation.parameters.itemId) {
      alternatives.push({
        type: 'search',
        description: 'Search for similar items',
        action: 'search_items'
      });
    }

    // Suggest creating new item
    if (context.operation.type.includes('update') ||
        context.operation.type.includes('move')) {
      alternatives.push({
        type: 'create',
        description: 'Create a new item instead',
        action: 'create_item'
      });
    }

    return alternatives;
  }

  /**
   * Handle partial success in bulk operations
   */
  handlePartialSuccess(results, operation) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    const recovery = {
      partialSuccess: true,
      successful: successful.length,
      failed: failed.length,
      canRetryFailed: true,
      failedItems: failed.map(f => ({
        id: f.itemId,
        error: f.error,
        canRetry: this.canRetryError(f.error)
      }))
    };

    // Group failed items by error type
    const errorGroups = {};
    failed.forEach(f => {
      const errorType = this.classifyError({ message: f.error });
      if (!errorGroups[errorType]) {
        errorGroups[errorType] = [];
      }
      errorGroups[errorType].push(f.itemId);
    });

    recovery.errorGroups = errorGroups;
    recovery.suggestions = this.getRecoverySuggestions(errorGroups);

    return recovery;
  }

  /**
   * Get recovery suggestions based on error groups
   * @private
   */
  getRecoverySuggestions(errorGroups) {
    const suggestions = [];

    if (errorGroups.PERMISSION_DENIED) {
      suggestions.push('Check permissions for the affected items');
    }

    if (errorGroups.RATE_LIMIT_EXCEEDED) {
      suggestions.push('Reduce batch size or add delays between operations');
    }

    if (errorGroups.INVALID_DATA) {
      suggestions.push('Review and fix data format for failed items');
    }

    if (errorGroups.ITEM_NOT_FOUND) {
      suggestions.push('Some items may have been deleted. Refresh and try again');
    }

    return suggestions;
  }

  /**
   * Check if error can be retried
   * @private
   */
  canRetryError(errorMessage) {
    const nonRetryableErrors = [
      'permission denied',
      'not found',
      'already exists',
      'invalid board',
      'invalid column'
    ];

    const lowerError = errorMessage.toLowerCase();
    return !nonRetryableErrors.some(e => lowerError.includes(e));
  }

  /**
   * Create audit log entry for error
   */
  createErrorAudit(error, context, recovery) {
    return {
      timestamp: new Date().toISOString(),
      operation: context.operation,
      error: {
        type: this.classifyError(error),
        message: error.message,
        status: error.status
      },
      recovery: {
        attempted: !!recovery,
        successful: recovery?.successful || false,
        strategy: recovery?.strategy || 'none'
      },
      context: {
        userId: context.userId,
        boardId: context.boardId
      }
    };
  }

  /**
   * Delay helper
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ErrorRecoveryService();