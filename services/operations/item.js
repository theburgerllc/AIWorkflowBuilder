// operations/item-operations.js
import { mondayClient } from '../config/monday-client.js';
import { formatColumnValue, validateColumnValues } from '../utils/column-formatters.js';
import { logOperation, logError } from '../utils/logger.js';

class ItemOperations {
  constructor() {
    this.client = mondayClient;
    this.retryLimit = 3;
    this.retryDelay = 1000;
  }

  /**
   * Create a new item in a board
   * @param {string} boardId - Target board ID
   * @param {string} groupId - Target group ID (optional)
   * @param {string} itemName - Name of the new item
   * @param {object} columnValues - Column values to set
   * @returns {object} Created item details
   */
  async createItem(boardId, groupId, itemName, columnValues = {}) {
    try {
      // Validate inputs
      if (!boardId || !itemName) {
        throw new Error('Board ID and item name are required');
      }

      // Format column values according to Monday.com requirements
      const formattedValues = await this.formatColumnValues(boardId, columnValues);
      
      // Build the mutation
      const mutation = `
        mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: String, $groupId: String) {
          create_item(
            board_id: $boardId,
            item_name: $itemName,
            column_values: $columnValues,
            group_id: $groupId
          ) {
            id
            name
            created_at
            column_values {
              id
              text
              value
            }
            group {
              id
              title
            }
          }
        }
      `;

      const variables = {
        boardId,
        itemName,
        columnValues: JSON.stringify(formattedValues),
        groupId
      };

      // Execute with retry logic
      const result = await this.executeWithRetry(mutation, variables);
      
      logOperation('createItem', {
        boardId,
        itemName,
        itemId: result.data.create_item.id,
        success: true
      });

      return {
        success: true,
        item: result.data.create_item,
        operation: 'create'
      };

    } catch (error) {
      logError('createItem', error, { boardId, itemName });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'create'
      };
    }
  }

  /**
   * Update an existing item
   * @param {string} boardId - Board ID containing the item
   * @param {string} itemId - Item ID to update
   * @param {object} columnValues - Column values to update
   * @returns {object} Updated item details
   */
  async updateItem(boardId, itemId, columnValues) {
    try {
      if (!boardId || !itemId || !columnValues) {
        throw new Error('Board ID, item ID, and column values are required');
      }

      // Format column values
      const formattedValues = await this.formatColumnValues(boardId, columnValues);
      
      const mutation = `
        mutation UpdateItem($boardId: ID!, $itemId: ID!, $columnValues: String!) {
          change_multiple_column_values(
            board_id: $boardId,
            item_id: $itemId,
            column_values: $columnValues
          ) {
            id
            name
            updated_at
            column_values {
              id
              text
              value
            }
          }
        }
      `;

      const variables = {
        boardId,
        itemId: parseInt(itemId),
        columnValues: JSON.stringify(formattedValues)
      };

      const result = await this.executeWithRetry(mutation, variables);
      
      logOperation('updateItem', {
        boardId,
        itemId,
        updates: Object.keys(columnValues),
        success: true
      });

      return {
        success: true,
        item: result.data.change_multiple_column_values,
        operation: 'update'
      };

    } catch (error) {
      logError('updateItem', error, { boardId, itemId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'update'
      };
    }
  }

  /**
   * Delete an item
   * @param {string} itemId - Item ID to delete
   * @returns {object} Deletion result
   */
  async deleteItem(itemId) {
    try {
      if (!itemId) {
        throw new Error('Item ID is required');
      }

      const mutation = `
        mutation DeleteItem($itemId: ID!) {
          delete_item(item_id: $itemId) {
            id
            name
            state
          }
        }
      `;

      const variables = {
        itemId: parseInt(itemId)
      };

      const result = await this.executeWithRetry(mutation, variables);
      
      logOperation('deleteItem', {
        itemId,
        success: true
      });

      return {
        success: true,
        deletedItem: result.data.delete_item,
        operation: 'delete'
      };

    } catch (error) {
      logError('deleteItem', error, { itemId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'delete'
      };
    }
  }

  /**
   * Duplicate an item
   * @param {string} boardId - Board ID containing the item
   * @param {string} itemId - Item ID to duplicate
   * @param {string} targetGroupId - Target group ID (optional)
   * @returns {object} Duplicated item details
   */
  async duplicateItem(boardId, itemId, targetGroupId = null) {
    try {
      if (!boardId || !itemId) {
        throw new Error('Board ID and item ID are required');
      }

      const mutation = `
        mutation DuplicateItem($boardId: ID!, $itemId: ID!, $withUpdates: Boolean) {
          duplicate_item(
            board_id: $boardId,
            item_id: $itemId,
            with_updates: $withUpdates
          ) {
            id
            name
            created_at
            column_values {
              id
              text
              value
            }
            group {
              id
              title
            }
          }
        }
      `;

      const variables = {
        boardId,
        itemId: parseInt(itemId),
        withUpdates: true
      };

      const result = await this.executeWithRetry(mutation, variables);
      const duplicatedItem = result.data.duplicate_item;

      // Move to target group if specified
      if (targetGroupId && duplicatedItem) {
        await this.moveItem(duplicatedItem.id, targetGroupId);
      }

      logOperation('duplicateItem', {
        boardId,
        itemId,
        newItemId: duplicatedItem.id,
        success: true
      });

      return {
        success: true,
        item: duplicatedItem,
        operation: 'duplicate'
      };

    } catch (error) {
      logError('duplicateItem', error, { boardId, itemId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'duplicate'
      };
    }
  }

  /**
   * Move an item to a different group or board
   * @param {string} itemId - Item ID to move
   * @param {string} targetGroupId - Target group ID
   * @param {string} targetBoardId - Target board ID (optional)
   * @returns {object} Move result
   */
  async moveItem(itemId, targetGroupId, targetBoardId = null) {
    try {
      if (!itemId || !targetGroupId) {
        throw new Error('Item ID and target group ID are required');
      }

      if (targetBoardId) {
        // Moving to a different board
        const mutation = `
          mutation MoveItemToBoard($itemId: ID!, $boardId: ID!, $groupId: String!) {
            move_item_to_board(
              item_id: $itemId,
              board_id: $boardId,
              group_id: $groupId
            ) {
              id
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

        const variables = {
          itemId: parseInt(itemId),
          boardId: targetBoardId,
          groupId: targetGroupId
        };

        const result = await this.executeWithRetry(mutation, variables);
        
        logOperation('moveItem', {
          itemId,
          targetBoardId,
          targetGroupId,
          success: true
        });

        return {
          success: true,
          item: result.data.move_item_to_board,
          operation: 'move'
        };

      } else {
        // Moving within the same board
        const mutation = `
          mutation MoveItemToGroup($itemId: ID!, $groupId: String!) {
            move_item_to_group(
              item_id: $itemId,
              group_id: $groupId
            ) {
              id
              group {
                id
                title
              }
            }
          }
        `;

        const variables = {
          itemId: parseInt(itemId),
          groupId: targetGroupId
        };

        const result = await this.executeWithRetry(mutation, variables);
        
        logOperation('moveItem', {
          itemId,
          targetGroupId,
          success: true
        });

        return {
          success: true,
          item: result.data.move_item_to_group,
          operation: 'move'
        };
      }

    } catch (error) {
      logError('moveItem', error, { itemId, targetGroupId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'move'
      };
    }
  }

  /**
   * Format column values according to Monday.com requirements
   * @private
   */
  async formatColumnValues(boardId, columnValues) {
    const formatted = {};
    
    // Get board columns for proper formatting
    const boardColumns = await this.getBoardColumns(boardId);
    
    for (const [columnId, value] of Object.entries(columnValues)) {
      const column = boardColumns.find(c => c.id === columnId);
      if (column) {
        formatted[columnId] = formatColumnValue(column.type, value);
      }
    }
    
    return formatted;
  }

  /**
   * Get board columns
   * @private
   */
  async getBoardColumns(boardId) {
    const query = `
      query GetBoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const result = await this.client.request(query, { boardId });
    return result.data.boards[0].columns;
  }

  /**
   * Execute GraphQL request with retry logic
   * @private
   */
  async executeWithRetry(query, variables, attempt = 1) {
    try {
      return await this.client.request(query, variables);
    } catch (error) {
      if (attempt < this.retryLimit && this.isRetryableError(error)) {
        await this.delay(this.retryDelay * attempt);
        return this.executeWithRetry(query, variables, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Check if error is retryable
   * @private
   */
  isRetryableError(error) {
    const retryableErrors = ['RATE_LIMIT_EXCEEDED', 'TIMEOUT', 'NETWORK_ERROR'];
    return retryableErrors.some(e => error.message?.includes(e));
  }

  /**
   * Format error for user display
   * @private
   */
  formatError(error) {
    if (error.response?.errors?.[0]) {
      return error.response.errors[0].message;
    }
    return error.message || 'An unexpected error occurred';
  }

  /**
   * Delay helper
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new ItemOperations();