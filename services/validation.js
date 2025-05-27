// services/validation-service.js
import { mondayClient } from '../config/monday-client.js';

class ValidationService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Validate operation before execution
   * @param {object} operation - Operation to validate
   * @param {object} context - Execution context
   * @returns {object} Validation result with warnings
   */
  async validateOperation(operation, context) {
    const validations = [];
    const warnings = [];
    
    try {
      // Basic validation
      validations.push(this.validateBasicRequirements(operation));
      
      // Permission validation
      validations.push(await this.validatePermissions(operation, context));
      
      // Resource validation
      validations.push(await this.validateResources(operation));
      
      // Data validation
      validations.push(await this.validateData(operation));
      
      // Constraint validation
      validations.push(await this.validateConstraints(operation));
      
      // Business logic validation
      validations.push(await this.validateBusinessLogic(operation));
      
      // Combine results
      const errors = validations.flatMap(v => v.errors || []);
      const allWarnings = validations.flatMap(v => v.warnings || []);
      
      return {
        valid: errors.length === 0,
        errors,
        warnings: allWarnings,
        canProceed: errors.length === 0 && !allWarnings.some(w => w.blocking)
      };
      
    } catch (error) {
      return {
        valid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings: [],
        canProceed: false
      };
    }
  }

  /**
   * Validate basic operation requirements
   * @private
   */
  validateBasicRequirements(operation) {
    const errors = [];
    const warnings = [];
    
    if (!operation.type) {
      errors.push('Operation type is required');
    }
    
    if (!operation.parameters) {
      errors.push('Operation parameters required');
    }
    
    // Check parameter completeness
    const requiredParams = this.getRequiredParameters(operation.type);
    requiredParams.forEach(param => {
      if (!operation.parameters[param]) {
        errors.push(`Required parameter missing: ${param}`);
      }
    });
    
    return { errors, warnings };
  }

  /**
   * Validate user permissions
   * @private
   */
  async validatePermissions(operation, context) {
    const errors = [];
    const warnings = [];
    
    // Get user permissions
    const permissions = await this.getUserPermissions(context.userId, context.boardId);
    
    // Check operation-specific permissions
    const requiredPermissions = this.getRequiredPermissions(operation.type);
    
    requiredPermissions.forEach(perm => {
      if (!permissions[perm]) {
        errors.push(`Insufficient permissions: ${perm} required`);
      }
    });
    
    // Guest user restrictions
    if (permissions.isGuest) {
      const guestRestricted = ['delete_board', 'manage_users', 'create_automation'];
      if (guestRestricted.includes(operation.type)) {
        errors.push('Guest users cannot perform this operation');
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate resources exist and are accessible
   * @private
   */
  async validateResources(operation) {
    const errors = [];
    const warnings = [];
    const { parameters } = operation;
    
    // Validate board exists
    if (parameters.boardId) {
      const boardExists = await this.checkBoardExists(parameters.boardId);
      if (!boardExists) {
        errors.push(`Board ${parameters.boardId} not found`);
      }
    }
    
    // Validate item exists
    if (parameters.itemId) {
      const itemExists = await this.checkItemExists(parameters.itemId);
      if (!itemExists) {
        errors.push(`Item ${parameters.itemId} not found`);
      }
    }
    
    // Validate group exists
    if (parameters.groupId && parameters.boardId) {
      const groupExists = await this.checkGroupExists(parameters.boardId, parameters.groupId);
      if (!groupExists) {
        errors.push(`Group ${parameters.groupId} not found`);
      }
    }
    
    // Validate user exists
    if (parameters.userId) {
      const userExists = await this.checkUserExists(parameters.userId);
      if (!userExists) {
        errors.push(`User ${parameters.userId} not found`);
      }
    }
    
    // Validate column exists
    if (parameters.columnId && parameters.boardId) {
      const columnInfo = await this.getColumnInfo(parameters.boardId, parameters.columnId);
      if (!columnInfo) {
        errors.push(`Column ${parameters.columnId} not found`);
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate data formats and values
   * @private
   */
  async validateData(operation) {
    const errors = [];
    const warnings = [];
    const { parameters } = operation;
    
    // Validate item name length
    if (parameters.itemName) {
      if (parameters.itemName.length > 255) {
        errors.push('Item name cannot exceed 255 characters');
      }
      if (parameters.itemName.length === 0) {
        errors.push('Item name cannot be empty');
      }
    }
    
    // Validate column values
    if (parameters.columnValues && parameters.boardId) {
      const columnValidation = await this.validateColumnValues(
        parameters.boardId,
        parameters.columnValues
      );
      errors.push(...columnValidation.errors);
      warnings.push(...columnValidation.warnings);
    }
    
    // Validate batch size
    if (parameters.itemIds && Array.isArray(parameters.itemIds)) {
      if (parameters.itemIds.length > 100) {
        warnings.push({
          message: 'Large batch size may cause performance issues',
          count: parameters.itemIds.length,
          recommendation: 'Consider breaking into smaller batches'
        });
      }
      if (parameters.itemIds.length === 0) {
        errors.push('At least one item ID required');
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate business constraints
   * @private
   */
  async validateConstraints(operation) {
    const errors = [];
    const warnings = [];
    const { type, parameters } = operation;
    
    // Board limits
    if (type === 'create_item' && parameters.boardId) {
      const itemCount = await this.getBoardItemCount(parameters.boardId);
      if (itemCount >= 10000) {
        errors.push('Board has reached maximum item limit (10,000)');
      } else if (itemCount >= 9000) {
        warnings.push({
          message: 'Board approaching item limit',
          current: itemCount,
          limit: 10000
        });
      }
    }
    
    // Group limits
    if (type === 'create_group' && parameters.boardId) {
      const groupCount = await this.getBoardGroupCount(parameters.boardId);
      if (groupCount >= 100) {
        errors.push('Board has reached maximum group limit (100)');
      }
    }
    
    // Automation limits
    if (type === 'create_automation' && parameters.boardId) {
      const automationCount = await this.getBoardAutomationCount(parameters.boardId);
      if (automationCount >= 50) {
        warnings.push({
          message: 'High number of automations may affect performance',
          current: automationCount
        });
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate business logic rules
   * @private
   */
  async validateBusinessLogic(operation) {
    const errors = [];
    const warnings = [];
    const { type, parameters } = operation;
    
    // Prevent circular dependencies
    if (type === 'move_item' && parameters.targetBoardId) {
      if (parameters.targetBoardId === parameters.sourceBoardId) {
        warnings.push({
          message: 'Moving item within same board',
          suggestion: 'Consider moving to different group instead'
        });
      }
    }
    
    // Validate automation logic
    if (type === 'create_automation') {
      const automationWarnings = this.validateAutomationLogic(parameters);
      warnings.push(...automationWarnings);
    }
    
    // Check for duplicate operations
    if (type === 'create_item' && parameters.boardId && parameters.itemName) {
      const isDuplicate = await this.checkDuplicateItem(
        parameters.boardId,
        parameters.itemName
      );
      if (isDuplicate) {
        warnings.push({
          message: 'An item with this name already exists',
          suggestion: 'Consider updating the existing item or using a different name',
          blocking: false
        });
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate column values format
   * @private
   */
  async validateColumnValues(boardId, columnValues) {
    const errors = [];
    const warnings = [];
    
    // Get board columns
    const columns = await this.getBoardColumns(boardId);
    
    for (const [columnId, value] of Object.entries(columnValues)) {
      const column = columns.find(c => c.id === columnId);
      
      if (!column) {
        errors.push(`Column ${columnId} not found on board`);
        continue;
      }
      
      // Validate based on column type
      const validation = this.validateColumnValue(column, value);
      if (validation.error) {
        errors.push(`${column.title}: ${validation.error}`);
      }
      if (validation.warning) {
        warnings.push({
          message: `${column.title}: ${validation.warning}`,
          column: columnId
        });
      }
    }
    
    return { errors, warnings };
  }

  /**
   * Validate individual column value
   * @private
   */
  validateColumnValue(column, value) {
    const validators = {
      'text': (val) => {
        if (typeof val !== 'string') {
          return { error: 'Text value must be a string' };
        }
        if (val.length > 5000) {
          return { error: 'Text exceeds maximum length (5000)' };
        }
        return {};
      },
      
      'numbers': (val) => {
        const num = parseFloat(val);
        if (isNaN(num)) {
          return { error: 'Invalid number format' };
        }
        return {};
      },
      
      'status': (val) => {
        if (typeof val === 'string') {
          return { warning: 'Status should be object with label property' };
        }
        if (!val.label) {
          return { error: 'Status requires label property' };
        }
        return {};
      },
      
      'date': (val) => {
        if (typeof val === 'string') {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(val)) {
            return { error: 'Date must be in YYYY-MM-DD format' };
          }
        } else if (val.date) {
          // Date object format
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(val.date)) {
            return { error: 'Date must be in YYYY-MM-DD format' };
          }
        }
        return {};
      },
      
      'people': (val) => {
        if (!val.personsAndTeams || !Array.isArray(val.personsAndTeams)) {
          return { error: 'People column requires personsAndTeams array' };
        }
        const invalidPersons = val.personsAndTeams.filter(
          p => !p.id || !p.kind
        );
        if (invalidPersons.length > 0) {
          return { error: 'Each person must have id and kind properties' };
        }
        return {};
      },
      
      'email': (val) => {
        if (typeof val !== 'string') {
          return { error: 'Email must be a string' };
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (val && !emailRegex.test(val)) {
          return { warning: 'Invalid email format' };
        }
        return {};
      },
      
      'link': (val) => {
        if (typeof val === 'string') {
          return { warning: 'Link should be object with url and text properties' };
        }
        if (!val.url) {
          return { error: 'Link requires url property' };
        }
        return {};
      }
    };
    
    const validator = validators[column.type];
    if (!validator) {
      return { warning: `Validation not implemented for ${column.type} columns` };
    }
    
    return validator(value);
  }

  /**
   * Validate automation logic
   * @private
   */
  validateAutomationLogic(parameters) {
    const warnings = [];
    
    // Check for infinite loops
    if (parameters.trigger?.type === 'status_changes_to_something' &&
        parameters.actions?.some(a => a.type === 'change_status_column_value')) {
      const triggerStatus = parameters.trigger.params?.statusLabel;
      const actionStatus = parameters.actions.find(
        a => a.type === 'change_status_column_value'
      )?.params?.statusLabel;
      
      if (triggerStatus === actionStatus) {
        warnings.push({
          message: 'Automation may create infinite loop',
          details: 'Trigger and action use same status',
          blocking: true
        });
      }
    }
    
    // Check for conflicting actions
    const moveActions = parameters.actions?.filter(a => a.type === 'move_item_to_group');
    if (moveActions?.length > 1) {
      warnings.push({
        message: 'Multiple move actions may conflict',
        suggestion: 'Consider using only one move action'
      });
    }
    
    return warnings;
  }

  /**
   * Helper methods for resource checking
   * @private
   */
  async checkBoardExists(boardId) {
    const cacheKey = `board_${boardId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached !== null) return cached;
    
    try {
      const query = `
        query CheckBoard($boardId: [ID!]) {
          boards(ids: $boardId) {
            id
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      const exists = result.data.boards.length > 0;
      this.setCache(cacheKey, exists);
      return exists;
    } catch {
      return false;
    }
  }

  async checkItemExists(itemId) {
    try {
      const query = `
        query CheckItem($itemId: [ID!]) {
          items(ids: $itemId) {
            id
          }
        }
      `;
      const result = await mondayClient.request(query, { itemId: [itemId] });
      return result.data.items.length > 0;
    } catch {
      return false;
    }
  }

  async checkGroupExists(boardId, groupId) {
    try {
      const query = `
        query CheckGroup($boardId: [ID!]) {
          boards(ids: $boardId) {
            groups {
              id
            }
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      const groups = result.data.boards[0]?.groups || [];
      return groups.some(g => g.id === groupId);
    } catch {
      return false;
    }
  }

  async checkUserExists(userId) {
    try {
      const query = `
        query CheckUser($userId: [ID!]) {
          users(ids: $userId) {
            id
          }
        }
      `;
      const result = await mondayClient.request(query, { userId: [userId] });
      return result.data.users.length > 0;
    } catch {
      return false;
    }
  }

  async getColumnInfo(boardId, columnId) {
    const columns = await this.getBoardColumns(boardId);
    return columns.find(c => c.id === columnId);
  }

  async getBoardColumns(boardId) {
    const cacheKey = `columns_${boardId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const query = `
        query GetColumns($boardId: [ID!]) {
          boards(ids: $boardId) {
            columns {
              id
              title
              type
              settings_str
            }
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      const columns = result.data.boards[0]?.columns || [];
      this.setCache(cacheKey, columns);
      return columns;
    } catch {
      return [];
    }
  }

  async getBoardItemCount(boardId) {
    try {
      const query = `
        query GetItemCount($boardId: [ID!]) {
          boards(ids: $boardId) {
            items_count
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      return result.data.boards[0]?.items_count || 0;
    } catch {
      return 0;
    }
  }

  async getBoardGroupCount(boardId) {
    try {
      const query = `
        query GetGroupCount($boardId: [ID!]) {
          boards(ids: $boardId) {
            groups {
              id
            }
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      return result.data.boards[0]?.groups?.length || 0;
    } catch {
      return 0;
    }
  }

  async getBoardAutomationCount(boardId) {
    // This would require specific API access
    // For now, return a placeholder
    return 0;
  }

  async checkDuplicateItem(boardId, itemName) {
    try {
      const query = `
        query CheckDuplicate($boardId: [ID!]) {
          boards(ids: $boardId) {
            items_page(limit: 10) {
              items {
                name
              }
            }
          }
        }
      `;
      const result = await mondayClient.request(query, { boardId: [boardId] });
      const items = result.data.boards[0]?.items_page?.items || [];
      return items.some(item => item.name.toLowerCase() === itemName.toLowerCase());
    } catch {
      return false;
    }
  }

  async getUserPermissions(userId, boardId) {
    // Simplified permission check
    // In production, this would check actual permissions
    return {
      canRead: true,
      canWrite: true,
      canDelete: true,
      canManageBoard: true,
      isGuest: false
    };
  }

  /**
   * Get required parameters for operation type
   * @private
   */
  getRequiredParameters(operationType) {
    const requirements = {
      'create_item': ['boardId', 'itemName'],
      'update_item': ['boardId', 'itemId', 'columnValues'],
      'delete_item': ['itemId'],
      'move_item': ['itemId', 'targetGroupId'],
      'duplicate_item': ['boardId', 'itemId'],
      'assign_user': ['itemId', 'userId', 'columnId'],
      'create_board': ['boardName'],
      'bulk_update': ['itemIds', 'columnValues'],
      'bulk_delete': ['itemIds', 'confirmationToken'],
      'create_automation': ['boardId', 'trigger', 'actions', 'name']
    };
    
    return requirements[operationType] || [];
  }

  /**
   * Get required permissions for operation type
   * @private
   */
  getRequiredPermissions(operationType) {
    const permissions = {
      'create_item': ['canWrite'],
      'update_item': ['canWrite'],
      'delete_item': ['canDelete'],
      'move_item': ['canWrite'],
      'duplicate_item': ['canWrite'],
      'assign_user': ['canWrite'],
      'create_board': ['canManageBoard'],
      'delete_board': ['canManageBoard'],
      'bulk_update': ['canWrite'],
      'bulk_delete': ['canDelete'],
      'create_automation': ['canManageBoard']
    };
    
    return permissions[operationType] || [];
  }

  /**
   * Cache management
   * @private
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.cache.clear();
  }
}

export default new ValidationService();