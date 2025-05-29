// nlp/operation-mapper.js
const { Logger } = require('@mondaycom/apps-sdk');
const AI_CONFIG = require('../config/ai');

class OperationMapper {
  constructor() {
    this.logger = new Logger('operation-mapper');
    this.columnTypeMapping = this._initializeColumnTypes();
    this.statusMapping = this._initializeStatusMapping();
  }

  /**
   * Map interpreted operation to Monday.com API calls
   * @param {Object} operation - Interpreted operation
   * @param {Object} context - Monday.com context
   * @returns {Object} - Mapped API operation
   */
  async mapToAPI(operation, context) {
    try {
      this.logger.info('Mapping operation to API', {
        operation: operation.operation,
        confidence: operation.confidence
      });

      const mapper = this._getOperationMapper(operation.operation);
      if (!mapper) {
        throw new Error(`No mapper found for operation: ${operation.operation}`);
      }

      const apiOperation = await mapper.call(this, operation, context);

      // Validate the mapped operation
      const validation = this._validateAPIOperation(apiOperation, context);
      if (!validation.valid) {
        apiOperation.errors = validation.errors;
        apiOperation.warnings = validation.warnings;
      }

      this.logger.info('Operation mapped successfully', {
        apiMethod: apiOperation.method,
        hasErrors: !!apiOperation.errors?.length
      });

      return apiOperation;
    } catch (error) {
      this.logger.error('Operation mapping failed', { error: error.message });
      return {
        method: 'ERROR',
        error: error.message,
        originalOperation: operation
      };
    }
  }

  /**
   * Get operation mapper function
   * @private
   */
  _getOperationMapper(operationType) {
    const mappers = {
      'ITEM_CREATE': this._mapItemCreate,
      'ITEM_UPDATE': this._mapItemUpdate,
      'ITEM_DELETE': this._mapItemDelete,
      'BOARD_CREATE': this._mapBoardCreate,
      'BOARD_UPDATE': this._mapBoardUpdate,
      'COLUMN_CREATE': this._mapColumnCreate,
      'COLUMN_UPDATE': this._mapColumnUpdate,
      'USER_ASSIGN': this._mapUserAssign,
      'STATUS_UPDATE': this._mapStatusUpdate,
      'AUTOMATION_CREATE': this._mapAutomationCreate,
      'BULK_OPERATION': this._mapBulkOperation
    };

    return mappers[operationType];
  }

  /**
   * Map item creation operation
   * @private
   */
  async _mapItemCreate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for item creation');
    }

    const apiOp = {
      method: 'create_item',
      mutation: 'create_item',
      variables: {
        board_id: parseInt(board.id),
        item_name: params.itemName || params.name || 'New Item'
      }
    };

    // Add group if specified
    if (params.groupId || params.groupName) {
      const group = this._findGroup(params.groupId || params.groupName, board);
      if (group) {
        apiOp.variables.group_id = group.id;
      }
    }

    // Add column values if specified
    if (params.columnValues || params.fields) {
      const columnValues = await this._mapColumnValues(
        params.columnValues || params.fields,
        board
      );
      if (Object.keys(columnValues).length > 0) {
        apiOp.variables.column_values = JSON.stringify(columnValues);
      }
    }

    // Build GraphQL mutation
    apiOp.query = `
      mutation CreateItem($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON) {
        create_item(
          board_id: $board_id,
          item_name: $item_name,
          group_id: $group_id,
          column_values: $column_values
        ) {
          id
          name
          state
          created_at
          creator {
            id
            name
          }
        }
      }
    `;

    return apiOp;
  }

  /**
   * Map item update operation
   * @private
   */
  async _mapItemUpdate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for item update');
    }

    const item = await this._findItem(params.itemId || params.itemName, board, context);
    if (!item) {
      throw new Error('Item not found for update');
    }

    const apiOp = {
      method: 'change_multiple_column_values',
      mutation: 'change_multiple_column_values',
      variables: {
        item_id: parseInt(item.id),
        board_id: parseInt(board.id)
      }
    };

    // Map column values to update
    if (params.columnValues || params.updates) {
      const columnValues = await this._mapColumnValues(
        params.columnValues || params.updates,
        board
      );
      apiOp.variables.column_values = JSON.stringify(columnValues);
    }

    apiOp.query = `
      mutation UpdateItem($item_id: ID!, $board_id: ID!, $column_values: JSON!) {
        change_multiple_column_values(
          item_id: $item_id,
          board_id: $board_id,
          column_values: $column_values
        ) {
          id
          name
          updated_at
        }
      }
    `;

    return apiOp;
  }

  /**
   * Map status update operation
   * @private
   */
  async _mapStatusUpdate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for status update');
    }

    const item = await this._findItem(params.itemId || params.itemName, board, context);
    if (!item) {
      throw new Error('Item not found for status update');
    }

    // Find status column
    const statusColumn = board.columns?.find(col =>
      col.type === 'color' || col.type === 'status' ||
      col.title.toLowerCase().includes('status')
    );

    if (!statusColumn) {
      throw new Error('No status column found in board');
    }

    // Map status value
    const statusValue = this._mapStatusValue(params.statusValue || params.status, statusColumn);

    const apiOp = {
      method: 'change_simple_column_value',
      mutation: 'change_simple_column_value',
      variables: {
        item_id: parseInt(item.id),
        board_id: parseInt(board.id),
        column_id: statusColumn.id,
        value: statusValue
      },
      query: `
        mutation UpdateStatus($item_id: ID!, $board_id: ID!, $column_id: String!, $value: String!) {
          change_simple_column_value(
            item_id: $item_id,
            board_id: $board_id,
            column_id: $column_id,
            value: $value
          ) {
            id
            name
          }
        }
      `
    };

    return apiOp;
  }

  /**
   * Map user assignment operation
   * @private
   */
  async _mapUserAssign(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for user assignment');
    }

    const item = await this._findItem(params.itemId || params.itemName, board, context);
    if (!item) {
      throw new Error('Item not found for assignment');
    }

    const user = this._findUser(params.userId || params.userName || params.userEmail, context);
    if (!user) {
      throw new Error('User not found for assignment');
    }

    // Find people column
    const peopleColumn = board.columns?.find(col =>
      col.type === 'people' || col.title.toLowerCase().includes('person') ||
      col.title.toLowerCase().includes('assign')
    );

    if (!peopleColumn) {
      throw new Error('No people column found in board');
    }

    const apiOp = {
      method: 'change_simple_column_value',
      mutation: 'change_simple_column_value',
      variables: {
        item_id: parseInt(item.id),
        board_id: parseInt(board.id),
        column_id: peopleColumn.id,
        value: JSON.stringify({ personsAndTeams: [{ id: parseInt(user.id), kind: 'person' }] })
      },
      query: `
        mutation AssignUser($item_id: ID!, $board_id: ID!, $column_id: String!, $value: JSON!) {
          change_column_value(
            item_id: $item_id,
            board_id: $board_id,
            column_id: $column_id,
            value: $value
          ) {
            id
            name
          }
        }
      `
    };

    return apiOp;
  }

  /**
   * Map board creation operation
   * @private
   */
  async _mapBoardCreate(operation, context) {
    const params = operation.parameters;

    const apiOp = {
      method: 'create_board',
      mutation: 'create_board',
      variables: {
        board_name: params.boardName || params.name || 'New Board',
        board_kind: params.boardKind || 'public'
      }
    };

    // Add workspace if specified
    if (params.workspaceId) {
      apiOp.variables.workspace_id = parseInt(params.workspaceId);
    }

    // Add template if specified
    if (params.templateId) {
      apiOp.variables.template_id = parseInt(params.templateId);
    }

    apiOp.query = `
      mutation CreateBoard($board_name: String!, $board_kind: BoardKind!, $workspace_id: ID, $template_id: ID) {
        create_board(
          board_name: $board_name,
          board_kind: $board_kind,
          workspace_id: $workspace_id,
          template_id: $template_id
        ) {
          id
          name
          url
          state
        }
      }
    `;

    return apiOp;
  }

  /**
   * Map column creation operation
   * @private
   */
  async _mapColumnCreate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for column creation');
    }

    const columnType = this._mapColumnType(params.columnType || params.type || 'text');

    const apiOp = {
      method: 'create_column',
      mutation: 'create_column',
      variables: {
        board_id: parseInt(board.id),
        title: params.columnTitle || params.title || 'New Column',
        column_type: columnType
      },
      query: `
        mutation CreateColumn($board_id: ID!, $title: String!, $column_type: ColumnType!) {
          create_column(
            board_id: $board_id,
            title: $title,
            column_type: $column_type
          ) {
            id
            title
            type
          }
        }
      `
    };

    return apiOp;
  }

  /**
   * Find board by ID or name
   * @private
   */
  _findBoard(identifier, context) {
    if (!context.boards) return null;

    // Try by ID first
    if (identifier && !isNaN(identifier)) {
      const board = context.boards.find(b => b.id === identifier.toString());
      if (board) return board;
    }

    // Try by name (case insensitive)
    if (identifier && typeof identifier === 'string') {
      const board = context.boards.find(b =>
        b.name.toLowerCase() === identifier.toLowerCase()
      );
      if (board) return board;
    }

    // Return current board if no identifier provided
    return context.currentBoard || null;
  }

  /**
   * Find group by ID or title
   * @private
   */
  _findGroup(identifier, board) {
    if (!board.groups) return null;

    // Try by ID first
    const byId = board.groups.find(g => g.id === identifier);
    if (byId) return byId;

    // Try by title (case insensitive)
    const byTitle = board.groups.find(g =>
      g.title.toLowerCase() === identifier.toLowerCase()
    );
    return byTitle || null;
  }

  /**
   * Find item by ID or name
   * @private
   */
  async _findItem(identifier, board, context) {
    // This would normally require an API call to get items
    // For now, return a placeholder that will be resolved at runtime
    if (!identifier) return null;

    return {
      id: identifier,
      searchBy: isNaN(identifier) ? 'name' : 'id',
      needsResolution: true
    };
  }

  /**
   * Find user by ID, name, or email
   * @private
   */
  _findUser(identifier, context) {
    if (!context.users) return null;

    // Try by ID first
    if (!isNaN(identifier)) {
      const user = context.users.find(u => u.id === identifier.toString());
      if (user) return user;
    }

    // Try by email
    if (identifier.includes('@')) {
      const user = context.users.find(u =>
        u.email.toLowerCase() === identifier.toLowerCase()
      );
      if (user) return user;
    }

    // Try by name (case insensitive)
    const user = context.users.find(u =>
      u.name.toLowerCase().includes(identifier.toLowerCase()) ||
      identifier.toLowerCase().includes(u.name.toLowerCase())
    );

    return user || null;
  }

  /**
   * Map column values to Monday.com format
   * @private
   */
  async _mapColumnValues(values, board) {
    const mappedValues = {};

    if (!values || !board.columns) return mappedValues;

    for (const [key, value] of Object.entries(values)) {
      // Find column by ID or title
      const column = board.columns.find(col =>
        col.id === key || col.title.toLowerCase() === key.toLowerCase()
      );

      if (!column) continue;

      // Map value based on column type
      const mappedValue = this._mapValueByColumnType(value, column);
      if (mappedValue !== null) {
        mappedValues[column.id] = mappedValue;
      }
    }

    return mappedValues;
  }

  /**
   * Map value based on column type
   * @private
   */
  _mapValueByColumnType(value, column) {
    if (value === null || value === undefined) return null;

    switch (column.type) {
      case 'text':
      case 'long_text':
        return value.toString();

      case 'numbers':
        const num = parseFloat(value);
        return isNaN(num) ? null : num;

      case 'status':
      case 'color':
        return this._mapStatusValue(value, column);

      case 'date':
        return this._mapDateValue(value);

      case 'people':
        return this._mapPeopleValue(value);

      case 'checkbox':
        return { checked: !!value };

      case 'dropdown':
        return { ids: [this._findDropdownOptionId(value, column)] };

      case 'email':
        return { email: value.toString(), text: value.toString() };

      case 'phone':
        return { phone: value.toString(), countryShortName: 'US' };

      case 'link':
        return { url: value.toString(), text: value.toString() };

      case 'rating':
        const rating = parseInt(value);
        return isNaN(rating) ? null : Math.max(1, Math.min(5, rating));

      default:
        return value.toString();
    }
  }

  /**
   * Map status value to Monday.com format
   * @private
   */
  _mapStatusValue(value, column) {
    if (!value) return null;

    const valueStr = value.toString().toLowerCase();

    // Common status mappings
    const statusMap = {
      'done': 'Done',
      'complete': 'Done',
      'completed': 'Done',
      'finished': 'Done',
      'working': 'Working on it',
      'progress': 'Working on it',
      'in progress': 'Working on it',
      'todo': 'To Do',
      'pending': 'To Do',
      'waiting': 'Waiting',
      'blocked': 'Stuck',
      'stuck': 'Stuck'
    };

    // Try exact match first
    if (statusMap[valueStr]) {
      return statusMap[valueStr];
    }

    // Try partial match
    for (const [key, mappedValue] of Object.entries(statusMap)) {
      if (valueStr.includes(key) || key.includes(valueStr)) {
        return mappedValue;
      }
    }

    // Return original value if no mapping found
    return value.toString();
  }

  /**
   * Map date value to Monday.com format
   * @private
   */
  _mapDateValue(value) {
    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) return null;

      return {
        date: date.toISOString().split('T')[0], // YYYY-MM-DD format
        time: date.toTimeString().split(' ')[0]  // HH:MM:SS format
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Map people value to Monday.com format
   * @private
   */
  _mapPeopleValue(value) {
    if (Array.isArray(value)) {
      return {
        personsAndTeams: value.map(v => ({
          id: parseInt(v.id || v),
          kind: 'person'
        }))
      };
    }

    return {
      personsAndTeams: [{
        id: parseInt(value.id || value),
        kind: 'person'
      }]
    };
  }

  /**
   * Find dropdown option ID
   * @private
   */
  _findDropdownOptionId(value, column) {
    try {
      const settings = JSON.parse(column.settings_str || '{}');
      const options = settings.options || [];

      const option = options.find(opt =>
        opt.name.toLowerCase() === value.toString().toLowerCase()
      );

      return option ? option.id : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Map column type to Monday.com format
   * @private
   */
  _mapColumnType(type) {
    const typeMap = {
      'text': 'text',
      'number': 'numbers',
      'numbers': 'numbers',
      'status': 'color',
      'date': 'date',
      'people': 'people',
      'person': 'people',
      'checkbox': 'checkbox',
      'dropdown': 'dropdown',
      'email': 'email',
      'phone': 'phone',
      'link': 'link',
      'url': 'link',
      'rating': 'rating',
      'long_text': 'long_text',
      'textarea': 'long_text'
    };

    return typeMap[type.toLowerCase()] || 'text';
  }

  /**
   * Initialize column type mappings
   * @private
   */
  _initializeColumnTypes() {
    return {
      'text': { apiType: 'text', validation: (val) => typeof val === 'string' },
      'numbers': { apiType: 'numbers', validation: (val) => !isNaN(val) },
      'color': { apiType: 'color', validation: (val) => typeof val === 'string' },
      'date': { apiType: 'date', validation: (val) => !isNaN(Date.parse(val)) },
      'people': { apiType: 'people', validation: (val) => true },
      'checkbox': { apiType: 'checkbox', validation: (val) => typeof val === 'boolean' },
      'dropdown': { apiType: 'dropdown', validation: (val) => typeof val === 'string' },
      'email': { apiType: 'email', validation: (val) => val.includes('@') },
      'phone': { apiType: 'phone', validation: (val) => typeof val === 'string' },
      'link': { apiType: 'link', validation: (val) => typeof val === 'string' },
      'rating': { apiType: 'rating', validation: (val) => !isNaN(val) && val >= 1 && val <= 5 }
    };
  }

  /**
   * Initialize status mappings
   * @private
   */
  _initializeStatusMapping() {
    return {
      // Common status variations
      done: ['done', 'complete', 'completed', 'finished', 'closed'],
      working: ['working', 'progress', 'in progress', 'ongoing', 'active'],
      todo: ['todo', 'to do', 'pending', 'new', 'open'],
      stuck: ['stuck', 'blocked', 'issue', 'problem'],
      waiting: ['waiting', 'hold', 'on hold', 'paused']
    };
  }

  /**
   * Validate API operation before execution
   * @private
   */
  _validateAPIOperation(apiOperation, context) {
    const validation = { valid: true, errors: [], warnings: [] };

    // Check required fields
    if (!apiOperation.method) {
      validation.errors.push('Missing API method');
      validation.valid = false;
    }

    if (!apiOperation.query && !apiOperation.mutation) {
      validation.errors.push('Missing GraphQL query/mutation');
      validation.valid = false;
    }

    // Validate variables
    if (apiOperation.variables) {
      for (const [key, value] of Object.entries(apiOperation.variables)) {
        if (value === null || value === undefined) {
          validation.warnings.push(`Variable ${key} is null/undefined`);
        }
      }
    }

    // Check permissions based on operation
    if (context.permissions) {
      const permissionChecks = {
        'create_board': 'canCreateBoards',
        'delete_item': 'canDeleteItems',
        'create_automation': 'canCreateAutomations'
      };

      const requiredPermission = permissionChecks[apiOperation.method];
      if (requiredPermission && !context.permissions[requiredPermission]) {
        validation.errors.push(`Insufficient permissions for ${apiOperation.method}`);
        validation.valid = false;
      }
    }

    return validation;
  }

  /**
   * Map bulk operations (placeholder for complex operations)
   * @private
   */
  async _mapBulkOperation(operation, context) {
    // TODO: Implement bulk operations
    return {
      method: 'BULK_NOT_IMPLEMENTED',
      error: 'Bulk operations not yet implemented',
      originalOperation: operation
    };
  }

  /**
   * Map automation creation (placeholder for complex operations)
   * @private
   */
  async _mapAutomationCreate(operation, context) {
    // TODO: Implement automation creation
    return {
      method: 'AUTOMATION_NOT_IMPLEMENTED',
      error: 'Automation creation not yet implemented',
      originalOperation: operation
    };
  }

  /**
   * Map item deletion
   * @private
   */
  async _mapItemDelete(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for item deletion');
    }

    const item = await this._findItem(params.itemId || params.itemName, board, context);
    if (!item) {
      throw new Error('Item not found for deletion');
    }

    return {
      method: 'delete_item',
      mutation: 'delete_item',
      variables: {
        item_id: parseInt(item.id)
      },
      query: `
        mutation DeleteItem($item_id: ID!) {
          delete_item(item_id: $item_id) {
            id
          }
        }
      `
    };
  }

  /**
   * Map board update operations
   * @private
   */
  async _mapBoardUpdate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for update');
    }

    const apiOp = {
      method: 'update_board',
      mutation: 'update_board',
      variables: {
        board_id: parseInt(board.id)
      }
    };

    // Add updateable fields
    if (params.name || params.boardName) {
      apiOp.variables.board_attribute = 'name';
      apiOp.variables.new_value = params.name || params.boardName;
    }

    if (params.description) {
      apiOp.variables.board_attribute = 'description';
      apiOp.variables.new_value = params.description;
    }

    apiOp.query = `
      mutation UpdateBoard($board_id: ID!, $board_attribute: BoardAttributes!, $new_value: String!) {
        update_board(
          board_id: $board_id,
          board_attribute: $board_attribute,
          new_value: $new_value
        ) {
          id
          name
          description
        }
      }
    `;

    return apiOp;
  }

  /**
   * Map column update operations
   * @private
   */
  async _mapColumnUpdate(operation, context) {
    const params = operation.parameters;
    const board = this._findBoard(params.boardId || params.boardName, context);

    if (!board) {
      throw new Error('Board not found for column update');
    }

    const column = board.columns?.find(col =>
      col.id === params.columnId ||
      col.title.toLowerCase() === (params.columnTitle || params.columnName || '').toLowerCase()
    );

    if (!column) {
      throw new Error('Column not found for update');
    }

    return {
      method: 'change_column_title',
      mutation: 'change_column_title',
      variables: {
        board_id: parseInt(board.id),
        column_id: column.id,
        title: params.newTitle || params.title
      },
      query: `
        mutation UpdateColumn($board_id: ID!, $column_id: String!, $title: String!) {
          change_column_title(
            board_id: $board_id,
            column_id: $column_id,
            title: $title
          ) {
            id
            title
          }
        }
      `
    };
  }
}

module.exports = OperationMapper;