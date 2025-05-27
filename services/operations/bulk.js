// operations/bulk-operations.js
import { mondayClient } from '../config/monday-client.js';
import { formatColumnValue } from '../utils/column-formatters.js';
import { logOperation, logError } from '../utils/logger.js';
import itemOperations from './item-operations.js';

class BulkOperations {
  constructor() {
    this.client = mondayClient;
    this.batchSize = 25; // Monday.com recommended batch size
    this.rateLimitDelay = 200; // Delay between batches in ms
  }

  /**
   * Bulk update multiple items
   * @param {array} itemIds - Array of item IDs to update
   * @param {object} columnValues - Column values to apply to all items
   * @returns {object} Bulk update results
   */
  async bulkUpdate(itemIds, columnValues) {
    try {
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error('Item IDs array is required');
      }
      if (!columnValues || Object.keys(columnValues).length === 0) {
        throw new Error('Column values are required');
      }

      const results = [];
      const errors = [];
      const startTime = Date.now();

      // Get board ID from first item to fetch column info
      const boardId = await this.getBoardIdFromItem(itemIds[0]);
      const formattedValues = await this.formatColumnValues(boardId, columnValues);

      // Process items in batches
      for (let i = 0; i < itemIds.length; i += this.batchSize) {
        const batch = itemIds.slice(i, i + this.batchSize);
        
        // Use Promise.allSettled to handle partial failures
        const batchResults = await Promise.allSettled(
          batch.map(itemId => this.updateSingleItem(itemId, formattedValues, boardId))
        );

        // Process batch results
        batchResults.forEach((result, index) => {
          const itemId = batch[index];
          if (result.status === 'fulfilled' && result.value.success) {
            results.push({
              itemId,
              success: true,
              updatedColumns: Object.keys(columnValues)
            });
          } else {
            errors.push({
              itemId,
              error: result.reason || result.value?.error || 'Unknown error'
            });
          }
        });

        // Rate limit protection
        if (i + this.batchSize < itemIds.length) {
          await this.delay(this.rateLimitDelay);
        }
      }

      const duration = Date.now() - startTime;

      logOperation('bulkUpdate', {
        totalItems: itemIds.length,
        successful: results.length,
        failed: errors.length,
        duration,
        columns: Object.keys(columnValues)
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        summary: {
          total: itemIds.length,
          successful: results.length,
          failed: errors.length,
          duration
        },
        operation: 'bulk_update'
      };

    } catch (error) {
      logError('bulkUpdate', error, { itemIds, columnValues });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'bulk_update'
      };
    }
  }

  /**
   * Bulk move items to a different group or board
   * @param {array} itemIds - Array of item IDs to move
   * @param {string} targetGroupId - Target group ID
   * @param {string} targetBoardId - Target board ID (optional)
   * @returns {object} Bulk move results
   */
  async bulkMove(itemIds, targetGroupId, targetBoardId = null) {
    try {
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error('Item IDs array is required');
      }
      if (!targetGroupId) {
        throw new Error('Target group ID is required');
      }

      const results = [];
      const errors = [];

      // Validate target exists
      if (targetBoardId) {
        await this.validateBoardAndGroup(targetBoardId, targetGroupId);
      }

      // Process moves in batches
      for (let i = 0; i < itemIds.length; i += this.batchSize) {
        const batch = itemIds.slice(i, i + this.batchSize);
        
        const batchPromises = batch.map(itemId => 
          itemOperations.moveItem(itemId, targetGroupId, targetBoardId)
            .then(result => {
              if (result.success) {
                results.push({ itemId, success: true });
              } else {
                errors.push({ itemId, error: result.error });
              }
            })
            .catch(error => {
              errors.push({ itemId, error: error.message });
            })
        );

        await Promise.all(batchPromises);
        
        // Rate limit protection
        if (i + this.batchSize < itemIds.length) {
          await this.delay(this.rateLimitDelay);
        }
      }

      logOperation('bulkMove', {
        totalItems: itemIds.length,
        successful: results.length,
        failed: errors.length,
        targetGroupId,
        targetBoardId
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        summary: {
          total: itemIds.length,
          successful: results.length,
          failed: errors.length
        },
        operation: 'bulk_move'
      };

    } catch (error) {
      logError('bulkMove', error, { itemIds, targetGroupId, targetBoardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'bulk_move'
      };
    }
  }

  /**
   * Bulk duplicate items
   * @param {array} itemIds - Array of item IDs to duplicate
   * @param {string} targetBoardId - Target board ID (optional)
   * @returns {object} Bulk duplication results
   */
  async bulkDuplicate(itemIds, targetBoardId = null) {
    try {
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error('Item IDs array is required');
      }

      const results = [];
      const errors = [];
      const newItemIds = [];

      // Get source board ID if not moving to different board
      const sourceBoardId = targetBoardId || await this.getBoardIdFromItem(itemIds[0]);

      // Process duplications in batches
      for (let i = 0; i < itemIds.length; i += this.batchSize) {
        const batch = itemIds.slice(i, i + this.batchSize);
        
        const batchPromises = batch.map(itemId => 
          itemOperations.duplicateItem(sourceBoardId, itemId)
            .then(result => {
              if (result.success) {
                results.push({ 
                  originalItemId: itemId, 
                  newItemId: result.item.id,
                  success: true 
                });
                newItemIds.push(result.item.id);
              } else {
                errors.push({ itemId, error: result.error });
              }
            })
            .catch(error => {
              errors.push({ itemId, error: error.message });
            })
        );

        await Promise.all(batchPromises);
        
        // Rate limit protection
        if (i + this.batchSize < itemIds.length) {
          await this.delay(this.rateLimitDelay);
        }
      }

      logOperation('bulkDuplicate', {
        totalItems: itemIds.length,
        successful: results.length,
        failed: errors.length,
        targetBoardId
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        newItemIds,
        summary: {
          total: itemIds.length,
          successful: results.length,
          failed: errors.length
        },
        operation: 'bulk_duplicate'
      };

    } catch (error) {
      logError('bulkDuplicate', error, { itemIds, targetBoardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'bulk_duplicate'
      };
    }
  }

  /**
   * Bulk delete items with confirmation
   * @param {array} itemIds - Array of item IDs to delete
   * @param {string} confirmationToken - Confirmation token for safety
   * @returns {object} Bulk deletion results
   */
  async bulkDelete(itemIds, confirmationToken) {
    try {
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error('Item IDs array is required');
      }
      
      // Validate confirmation token
      const expectedToken = this.generateConfirmationToken(itemIds);
      if (confirmationToken !== expectedToken) {
        throw new Error('Invalid confirmation token. Deletion aborted for safety.');
      }

      const results = [];
      const errors = [];

      // Process deletions in batches
      for (let i = 0; i < itemIds.length; i += this.batchSize) {
        const batch = itemIds.slice(i, i + this.batchSize);
        
        const batchPromises = batch.map(itemId => 
          itemOperations.deleteItem(itemId)
            .then(result => {
              if (result.success) {
                results.push({ itemId, success: true });
              } else {
                errors.push({ itemId, error: result.error });
              }
            })
            .catch(error => {
              errors.push({ itemId, error: error.message });
            })
        );

        await Promise.all(batchPromises);
        
        // Rate limit protection
        if (i + this.batchSize < itemIds.length) {
          await this.delay(this.rateLimitDelay);
        }
      }

      logOperation('bulkDelete', {
        totalItems: itemIds.length,
        successful: results.length,
        failed: errors.length
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        summary: {
          total: itemIds.length,
          successful: results.length,
          failed: errors.length
        },
        operation: 'bulk_delete'
      };

    } catch (error) {
      logError('bulkDelete', error, { itemIds });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'bulk_delete'
      };
    }
  }

  /**
   * Transfer items between boards based on criteria
   * @param {string} sourceBoardId - Source board ID
   * @param {string} targetBoardId - Target board ID
   * @param {object} criteria - Filter criteria
   * @returns {object} Transfer results
   */
  async crossBoardTransfer(sourceBoardId, targetBoardId, criteria) {
    try {
      if (!sourceBoardId || !targetBoardId) {
        throw new Error('Source and target board IDs are required');
      }

      // Get items that match criteria
      const matchingItems = await this.findItemsByCriteria(sourceBoardId, criteria);
      
      if (matchingItems.length === 0) {
        return {
          success: true,
          message: 'No items matched the specified criteria',
          operation: 'cross_board_transfer'
        };
      }

      // Get target board structure
      const targetStructure = await this.getBoardStructure(targetBoardId);
      const targetGroupId = targetStructure.groups[0]?.id;

      if (!targetGroupId) {
        throw new Error('Target board has no groups');
      }

      // Create mapping for columns between boards
      const columnMapping = await this.createColumnMapping(sourceBoardId, targetBoardId);

      const results = [];
      const errors = [];

      // Process transfers
      for (const item of matchingItems) {
        try {
          // Create new item in target board
          const mappedValues = this.mapColumnValues(item.column_values, columnMapping);
          const createResult = await itemOperations.createItem(
            targetBoardId,
            targetGroupId,
            item.name,
            mappedValues
          );

          if (createResult.success) {
            results.push({
              sourceItemId: item.id,
              newItemId: createResult.item.id,
              itemName: item.name
            });

            // Optionally delete from source
            if (criteria.deleteFromSource) {
              await itemOperations.deleteItem(item.id);
            }
          } else {
            errors.push({
              itemId: item.id,
              itemName: item.name,
              error: createResult.error
            });
          }
        } catch (error) {
          errors.push({
            itemId: item.id,
            itemName: item.name,
            error: error.message
          });
        }
      }

      logOperation('crossBoardTransfer', {
        sourceBoardId,
        targetBoardId,
        totalItems: matchingItems.length,
        successful: results.length,
        failed: errors.length
      });

      return {
        success: errors.length === 0,
        results,
        errors,
        summary: {
          total: matchingItems.length,
          successful: results.length,
          failed: errors.length
        },
        operation: 'cross_board_transfer'
      };

    } catch (error) {
      logError('crossBoardTransfer', error, { sourceBoardId, targetBoardId, criteria });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'cross_board_transfer'
      };
    }
  }

  /**
   * Generate confirmation token for dangerous operations
   */
  generateConfirmationToken(itemIds) {
    const sortedIds = [...itemIds].sort().join(',');
    return `DELETE-${itemIds.length}-${sortedIds.substring(0, 10)}`;
  }

  /**
   * Helper methods
   * @private
   */
  async updateSingleItem(itemId, columnValues, boardId) {
    const mutation = `
      mutation UpdateItem($itemId: ID!, $columnValues: String!) {
        change_multiple_column_values(
          item_id: $itemId,
          board_id: $boardId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `;

    const variables = {
      itemId: parseInt(itemId),
      boardId,
      columnValues: JSON.stringify(columnValues)
    };

    const result = await this.client.request(mutation, variables);
    return { success: true, itemId };
  }

  async getBoardIdFromItem(itemId) {
    const query = `
      query GetItemBoard($itemId: ID!) {
        items(ids: [$itemId]) {
          board {
            id
          }
        }
      }
    `;

    const result = await this.client.request(query, { itemId: parseInt(itemId) });
    return result.data.items[0]?.board?.id;
  }

  async formatColumnValues(boardId, columnValues) {
    const boardColumns = await this.getBoardColumns(boardId);
    const formatted = {};
    
    for (const [columnId, value] of Object.entries(columnValues)) {
      const column = boardColumns.find(c => c.id === columnId);
      if (column) {
        formatted[columnId] = formatColumnValue(column.type, value);
      }
    }
    
    return formatted;
  }

  async getBoardColumns(boardId) {
    const query = `
      query GetBoardColumns($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const result = await this.client.request(query, { boardId });
    return result.data.boards[0].columns;
  }

  async validateBoardAndGroup(boardId, groupId) {
    const query = `
      query ValidateBoardAndGroup($boardId: ID!) {
        boards(ids: [$boardId]) {
          groups {
            id
          }
        }
      }
    `;

    const result = await this.client.request(query, { boardId });
    const groups = result.data.boards[0]?.groups || [];
    
    if (!groups.find(g => g.id === groupId)) {
      throw new Error(`Group ${groupId} not found in board ${boardId}`);
    }
  }

  async findItemsByCriteria(boardId, criteria) {
    // Implementation would depend on specific criteria structure
    // For now, returning all items as placeholder
    const query = `
      query GetBoardItems($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 500) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { boardId });
    return result.data.boards[0].items_page.items;
  }

  async getBoardStructure(boardId) {
    const query = `
      query GetBoardStructure($boardId: ID!) {
        boards(ids: [$boardId]) {
          groups {
            id
            title
          }
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const result = await this.client.request(query, { boardId });
    return result.data.boards[0];
  }

  async createColumnMapping(sourceBoardId, targetBoardId) {
    // Get columns from both boards
    const [sourceColumns, targetColumns] = await Promise.all([
      this.getBoardColumns(sourceBoardId),
      this.getBoardColumns(targetBoardId)
    ]);

    // Create mapping based on column titles and types
    const mapping = {};
    sourceColumns.forEach(sourceCol => {
      const targetCol = targetColumns.find(
        tc => tc.title === sourceCol.title && tc.type === sourceCol.type
      );
      if (targetCol) {
        mapping[sourceCol.id] = targetCol.id;
      }
    });

    return mapping;
  }

  mapColumnValues(columnValues, columnMapping) {
    const mapped = {};
    columnValues.forEach(cv => {
      const targetColumnId = columnMapping[cv.id];
      if (targetColumnId && cv.value) {
        mapped[targetColumnId] = cv.value;
      }
    });
    return mapped;
  }

  formatError(error) {
    if (error.response?.errors?.[0]) {
      return error.response.errors[0].message;
    }
    return error.message || 'An unexpected error occurred';
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default new BulkOperations();