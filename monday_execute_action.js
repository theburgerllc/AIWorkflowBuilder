/**
 * Monday.com Action Executor
 * Handles execution of Monday.com actions/mutations for automations
 */

const { mondayApi } = require('../../config/monday');
const logger = require('../../utils/logger');

class MondayActionExecutor {
  constructor() {
    this.supportedActions = {
      'create_item': this.createItem.bind(this),
      'update_item': this.updateItem.bind(this),
      'create_update': this.createUpdate.bind(this),
      'change_column_value': this.changeColumnValue.bind(this),
      'move_item_to_group': this.moveItemToGroup.bind(this),
      'archive_item': this.archiveItem.bind(this),
      'duplicate_item': this.duplicateItem.bind(this),
      'delete_item': this.deleteItem.bind(this),
      'create_board': this.createBoard.bind(this),
      'add_users_to_team': this.addUsersToTeam.bind(this),
      'send_notification': this.sendNotification.bind(this)
    };
  }

  /**
   * Execute a Monday.com action
   * @param {string} actionType - Type of action to execute
   * @param {Object} payload - Action payload with parameters
   * @param {string} accessToken - Monday.com access token
   * @returns {Promise<Object>} Execution result
   */
  async executeAction(actionType, payload, accessToken) {
    try {
      logger.info(`Executing Monday.com action: ${actionType}`, { payload });

      if (!this.supportedActions[actionType]) {
        throw new Error(`Unsupported action type: ${actionType}`);
      }

      const result = await this.supportedActions[actionType](payload, accessToken);
      
      logger.info(`Successfully executed action: ${actionType}`, { result });
      return {
        success: true,
        action: actionType,
        result: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to execute action: ${actionType}`, { error: error.message, payload });
      return {
        success: false,
        action: actionType,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create a new item
   */
  async createItem(payload, accessToken) {
    const { board_id, item_name, column_values, group_id } = payload;
    
    const mutation = `
      mutation {
        create_item(
          board_id: ${board_id}
          item_name: "${item_name}"
          ${column_values ? `column_values: ${JSON.stringify(JSON.stringify(column_values))}` : ''}
          ${group_id ? `group_id: "${group_id}"` : ''}
        ) {
          id
          name
          state
          board {
            id
            name
          }
          group {
            id
            title
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Update an existing item
   */
  async updateItem(payload, accessToken) {
    const { item_id, column_values } = payload;
    
    const mutation = `
      mutation {
        change_multiple_column_values(
          item_id: ${item_id}
          board_id: ${payload.board_id}
          column_values: ${JSON.stringify(JSON.stringify(column_values))}
        ) {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Create an update/comment on an item
   */
  async createUpdate(payload, accessToken) {
    const { item_id, update_text } = payload;
    
    const mutation = `
      mutation {
        create_update(
          item_id: ${item_id}
          body: "${update_text}"
        ) {
          id
          body
          created_at
          creator {
            id
            name
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Change a specific column value
   */
  async changeColumnValue(payload, accessToken) {
    const { board_id, item_id, column_id, value } = payload;
    
    const mutation = `
      mutation {
        change_column_value(
          board_id: ${board_id}
          item_id: ${item_id}
          column_id: "${column_id}"
          value: ${JSON.stringify(JSON.stringify(value))}
        ) {
          id
          name
          column_values(ids: ["${column_id}"]) {
            id
            text
            value
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Move item to a different group
   */
  async moveItemToGroup(payload, accessToken) {
    const { board_id, item_id, group_id } = payload;
    
    const mutation = `
      mutation {
        move_item_to_group(
          item_id: ${item_id}
          group_id: "${group_id}"
        ) {
          id
          name
          group {
            id
            title
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Archive an item
   */
  async archiveItem(payload, accessToken) {
    const { item_id } = payload;
    
    const mutation = `
      mutation {
        archive_item(item_id: ${item_id}) {
          id
          name
          state
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Duplicate an item
   */
  async duplicateItem(payload, accessToken) {
    const { board_id, item_id, with_updates } = payload;
    
    const mutation = `
      mutation {
        duplicate_item(
          board_id: ${board_id}
          item_id: ${item_id}
          ${with_updates !== undefined ? `with_updates: ${with_updates}` : ''}
        ) {
          id
          name
          board {
            id
            name
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Delete an item
   */
  async deleteItem(payload, accessToken) {
    const { item_id } = payload;
    
    const mutation = `
      mutation {
        delete_item(item_id: ${item_id}) {
          id
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Create a new board
   */
  async createBoard(payload, accessToken) {
    const { board_name, board_kind, workspace_id, template_id } = payload;
    
    const mutation = `
      mutation {
        create_board(
          board_name: "${board_name}"
          board_kind: ${board_kind || 'public'}
          ${workspace_id ? `workspace_id: ${workspace_id}` : ''}
          ${template_id ? `template_id: ${template_id}` : ''}
        ) {
          id
          name
          description
          workspace {
            id
            name
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Add users to team/board
   */
  async addUsersToTeam(payload, accessToken) {
    const { board_id, user_ids, kind } = payload;
    
    const mutation = `
      mutation {
        add_users_to_board(
          board_id: ${board_id}
          user_ids: [${user_ids.join(', ')}]
          kind: ${kind || 'subscriber'}
        ) {
          id
          name
          users {
            id
            name
            email
          }
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Send notification to users
   */
  async sendNotification(payload, accessToken) {
    const { text, user_id, target_id, target_type } = payload;
    
    const mutation = `
      mutation {
        create_notification(
          text: "${text}"
          user_id: ${user_id}
          target_id: ${target_id}
          target_type: ${target_type}
        ) {
          text
        }
      }
    `;

    return await mondayApi.execute(mutation, accessToken);
  }

  /**
   * Get supported actions list
   */
  getSupportedActions() {
    return Object.keys(this.supportedActions);
  }

  /**
   * Validate action payload
   */
  validateActionPayload(actionType, payload) {
    const requiredFields = {
      'create_item': ['board_id', 'item_name'],
      'update_item': ['item_id', 'board_id', 'column_values'],
      'create_update': ['item_id', 'update_text'],
      'change_column_value': ['board_id', 'item_id', 'column_id', 'value'],
      'move_item_to_group': ['item_id', 'group_id'],
      'archive_item': ['item_id'],
      'duplicate_item': ['board_id', 'item_id'],
      'delete_item': ['item_id'],
      'create_board': ['board_name'],
      'add_users_to_team': ['board_id', 'user_ids'],
      'send_notification': ['text', 'user_id', 'target_id', 'target_type']
    };

    const required = requiredFields[actionType];
    if (!required) {
      throw new Error(`Unknown action type: ${actionType}`);
    }

    const missing = required.filter(field => !payload.hasOwnProperty(field));
    if (missing.length > 0) {
      throw new Error(`Missing required fields for ${actionType}: ${missing.join(', ')}`);
    }

    return true;
  }
}

module.exports = new MondayActionExecutor();