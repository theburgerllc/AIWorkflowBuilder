// services/operation-executor.js
const logger = require('../utils/logger');

// Create fallback operations if files don't exist
let itemOperations, boardOperations, userOperations, bulkOperations, automationOperations;

try {
  itemOperations = require('../operations/item-operations');
} catch (e) {
  itemOperations = {
    createItem: async () => ({ success: false, error: 'Item operations not implemented' }),
    updateItem: async () => ({ success: false, error: 'Item operations not implemented' }),
    deleteItem: async () => ({ success: false, error: 'Item operations not implemented' }),
    duplicateItem: async () => ({ success: false, error: 'Item operations not implemented' }),
    moveItem: async () => ({ success: false, error: 'Item operations not implemented' })
  };
}

try {
  boardOperations = require('../operations/board-operations');
} catch (e) {
  boardOperations = {
    createBoard: async () => ({ success: false, error: 'Board operations not implemented' }),
    updateBoard: async () => ({ success: false, error: 'Board operations not implemented' }),
    deleteBoard: async () => ({ success: false, error: 'Board operations not implemented' }),
    duplicateBoard: async () => ({ success: false, error: 'Board operations not implemented' }),
    addColumn: async () => ({ success: false, error: 'Board operations not implemented' }),
    addGroup: async () => ({ success: false, error: 'Board operations not implemented' })
  };
}

try {
  userOperations = require('../operations/user-operations');
} catch (e) {
  userOperations = {
    assignUser: async () => ({ success: false, error: 'User operations not implemented' }),
    removeUser: async () => ({ success: false, error: 'User operations not implemented' }),
    bulkAssign: async () => ({ success: false, error: 'User operations not implemented' })
  };
}

try {
  bulkOperations = require('../operations/bulk-operations');
} catch (e) {
  bulkOperations = {
    bulkUpdate: async () => ({ success: false, error: 'Bulk operations not implemented' }),
    bulkMove: async () => ({ success: false, error: 'Bulk operations not implemented' }),
    bulkDuplicate: async () => ({ success: false, error: 'Bulk operations not implemented' }),
    bulkDelete: async () => ({ success: false, error: 'Bulk operations not implemented' }),
    crossBoardTransfer: async () => ({ success: false, error: 'Bulk operations not implemented' })
  };
}

try {
  automationOperations = require('../operations/automation-operations');
} catch (e) {
  automationOperations = {
    createAutomation: async () => ({ success: false, error: 'Automation operations not implemented' }),
    mapNLPToAutomation: async () => ({ success: false, error: 'Automation operations not implemented' })
  };
}

class OperationExecutor {
  constructor() {
    this.operations = {
      item: itemOperations,
      board: boardOperations,
      user: userOperations,
      bulk: bulkOperations,
      automation: automationOperations
    };

    this.transactionStack = [];
    this.isInTransaction = false;
  }

  /**
   * Main execution entry point
   * @param {object} operation - Operation to execute
   * @returns {object} Execution result
   */
  async execute(operation) {
    const startTime = Date.now();

    try {
      // Validate operation before execution
      const validation = await this.validateOperation(operation);
      if (!validation.valid) {
        throw new Error(`Invalid operation: ${validation.errors.join(', ')}`);
      }

      // Start transaction if operation supports it
      if (operation.transactional) {
        this.beginTransaction();
      }

      // Execute based on operation type
      const result = await this.executeOperation(operation);

      // Commit transaction if successful
      if (operation.transactional && result.success) {
        await this.commitTransaction();
      }

      // Log successful operation
      logger.info('Operation executed successfully', {
        type: operation.type,
        success: true,
        duration: Date.now() - startTime,
        operationId: result.operationId
      });

      return {
        ...result,
        duration: Date.now() - startTime,
        operationId: this.generateOperationId()
      };

    } catch (error) {
      // Rollback transaction on error
      if (operation.transactional && this.isInTransaction) {
        await this.rollbackTransaction();
      }

      logger.error('Operation execution failed', { error: error.message, operation });

      return {
        success: false,
        error: error.message,
        operation: operation.type,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Execute specific operation based on type
   * @private
   */
  async executeOperation(operation) {
    const { type, parameters } = operation;

    // Map operation types to handlers
    const operationMap = {
      // Item operations
      'create_item': () => this.operations.item.createItem(
        parameters.boardId,
        parameters.groupId,
        parameters.itemName,
        parameters.columnValues
      ),
      'update_item': () => this.operations.item.updateItem(
        parameters.boardId,
        parameters.itemId,
        parameters.columnValues
      ),
      'delete_item': () => this.operations.item.deleteItem(
        parameters.itemId
      ),
      'duplicate_item': () => this.operations.item.duplicateItem(
        parameters.boardId,
        parameters.itemId,
        parameters.targetGroupId
      ),
      'move_item': () => this.operations.item.moveItem(
        parameters.itemId,
        parameters.targetGroupId,
        parameters.targetBoardId
      ),

      // Board operations
      'create_board': () => this.operations.board.createBoard(
        parameters.workspaceId,
        parameters.boardName,
        parameters.boardKind,
        parameters.templateId
      ),
      'update_board': () => this.operations.board.updateBoard(
        parameters.boardId,
        parameters.updates
      ),
      'delete_board': () => this.operations.board.deleteBoard(
        parameters.boardId
      ),
      'duplicate_board': () => this.operations.board.duplicateBoard(
        parameters.boardId,
        parameters.targetWorkspaceId,
        parameters.duplicateName
      ),
      'add_column': () => this.operations.board.addColumn(
        parameters.boardId,
        parameters.title,
        parameters.columnType,
        parameters.defaults
      ),
      'add_group': () => this.operations.board.addGroup(
        parameters.boardId,
        parameters.groupName,
        parameters.position,
        parameters.relativeTo
      ),

      // User operations
      'assign_user': () => this.operations.user.assignUser(
        parameters.itemId,
        parameters.userId,
        parameters.columnId
      ),
      'remove_user': () => this.operations.user.removeUser(
        parameters.itemId,
        parameters.userId,
        parameters.columnId
      ),
      'bulk_assign': () => this.operations.user.bulkAssign(
        parameters.itemIds,
        parameters.userId,
        parameters.columnId
      ),

      // Bulk operations
      'bulk_update': () => this.operations.bulk.bulkUpdate(
        parameters.itemIds,
        parameters.columnValues
      ),
      'bulk_move': () => this.operations.bulk.bulkMove(
        parameters.itemIds,
        parameters.targetGroupId,
        parameters.targetBoardId
      ),
      'bulk_duplicate': () => this.operations.bulk.bulkDuplicate(
        parameters.itemIds,
        parameters.targetBoardId
      ),
      'bulk_delete': () => this.operations.bulk.bulkDelete(
        parameters.itemIds,
        parameters.confirmationToken
      ),
      'cross_board_transfer': () => this.operations.bulk.crossBoardTransfer(
        parameters.sourceBoardId,
        parameters.targetBoardId,
        parameters.criteria
      ),

      // Automation operations
      'create_automation': () => this.operations.automation.createAutomation(
        parameters.boardId,
        parameters.trigger,
        parameters.actions,
        parameters.name
      ),
      'map_nlp_to_automation': () => this.operations.automation.mapNLPToAutomation(
        parameters.nlpInterpretation
      )
    };

    const handler = operationMap[type];
    if (!handler) {
      throw new Error(`Unknown operation type: ${type}`);
    }

    return await handler();
  }

  /**
   * Validate operation before execution
   * @private
   */
  async validateOperation(operation) {
    const errors = [];

    // Check required fields
    if (!operation.type) {
      errors.push('Operation type is required');
    }
    if (!operation.parameters) {
      errors.push('Operation parameters are required');
    }

    // Type-specific validation
    const validators = {
      'create_item': (params) => {
        if (!params.boardId) errors.push('Board ID is required');
        if (!params.itemName) errors.push('Item name is required');
      },
      'update_item': (params) => {
        if (!params.boardId) errors.push('Board ID is required');
        if (!params.itemId) errors.push('Item ID is required');
        if (!params.columnValues || Object.keys(params.columnValues).length === 0) {
          errors.push('Column values are required');
        }
      },
      'delete_item': (params) => {
        if (!params.itemId) errors.push('Item ID is required');
      },
      'bulk_delete': (params) => {
        if (!params.itemIds || params.itemIds.length === 0) {
          errors.push('Item IDs are required');
        }
        if (!params.confirmationToken) {
          errors.push('Confirmation token is required for bulk delete');
        }
      },
      'assign_user': (params) => {
        if (!params.itemId) errors.push('Item ID is required');
        if (!params.userId) errors.push('User ID is required');
        if (!params.columnId) errors.push('Column ID is required');
      }
    };

    const validator = validators[operation.type];
    if (validator) {
      validator(operation.parameters);
    }

    // Check permissions
    const permissionCheck = await this.checkPermissions(operation);
    if (!permissionCheck.allowed) {
      errors.push(`Permission denied: ${permissionCheck.reason}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if user has permission to execute operation
   * @private
   */
  async checkPermissions(operation) {
    // For now, return true. In production, check actual permissions
    return {
      allowed: true,
      reason: null
    };
  }

  /**
   * Begin a transaction for rollback capability
   * @private
   */
  beginTransaction() {
    this.isInTransaction = true;
    this.transactionStack = [];
  }

  /**
   * Commit transaction
   * @private
   */
  async commitTransaction() {
    this.isInTransaction = false;
    this.transactionStack = [];
  }

  /**
   * Rollback transaction
   * @private
   */
  async rollbackTransaction() {
    try {
      // Execute rollback operations in reverse order
      for (let i = this.transactionStack.length - 1; i >= 0; i--) {
        const rollbackOp = this.transactionStack[i];
        await this.executeOperation(rollbackOp);
      }
    } catch (error) {
      logger.error('Rollback transaction failed', { error: error.message });
      throw new Error('Failed to rollback transaction completely');
    } finally {
      this.isInTransaction = false;
      this.transactionStack = [];
    }
  }

  /**
   * Add operation to transaction stack for potential rollback
   * @private
   */
  addToTransaction(operation, rollbackOperation) {
    if (this.isInTransaction) {
      this.transactionStack.push(rollbackOperation);
    }
  }

  /**
   * Generate unique operation ID
   * @private
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create undo data for operation
   */
  createUndoData(operation, result) {
    const undoMap = {
      'create_item': {
        type: 'delete_item',
        parameters: {
          itemId: result.item?.id
        }
      },
      'delete_item': {
        type: 'restore_item',
        parameters: {
          itemData: result.deletedItem
        }
      },
      'update_item': {
        type: 'update_item',
        parameters: {
          boardId: operation.parameters.boardId,
          itemId: operation.parameters.itemId,
          columnValues: result.previousValues
        }
      },
      'move_item': {
        type: 'move_item',
        parameters: {
          itemId: operation.parameters.itemId,
          targetGroupId: result.previousGroupId,
          targetBoardId: result.previousBoardId
        }
      }
    };

    return undoMap[operation.type] || null;
  }

  /**
   * Execute batch of operations
   */
  async executeBatch(operations) {
    const results = [];
    const errors = [];

    for (const operation of operations) {
      try {
        const result = await this.execute(operation);
        results.push(result);

        if (!result.success) {
          errors.push({
            operation: operation.type,
            error: result.error
          });
        }
      } catch (error) {
        errors.push({
          operation: operation.type,
          error: error.message
        });
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      summary: {
        total: operations.length,
        successful: results.filter(r => r.success).length,
        failed: errors.length
      }
    };
  }

  /**
   * Health check for operation executor (required by executeAction controller)
   */
  async isHealthy() {
    try {
      // Simple health check - verify operations are available
      return this.operations &&
             this.operations.item &&
             this.operations.board &&
             this.operations.user &&
             this.operations.bulk &&
             this.operations.automation;
    } catch (error) {
      return false;
    }
  }
}

module.exports = OperationExecutor;