// operations/user-operations.js
import { mondayClient } from '../config/monday-client.js';
import { logOperation, logError } from '../utils/logger.js';

class UserOperations {
  constructor() {
    this.client = mondayClient;
    this.cache = new Map(); // Cache user data for performance
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Assign a user to an item
   * @param {string} itemId - Item ID
   * @param {string|number} userId - User ID to assign
   * @param {string} columnId - People column ID
   * @returns {object} Assignment result
   */
  async assignUser(itemId, userId, columnId) {
    try {
      if (!itemId || !userId || !columnId) {
        throw new Error('Item ID, user ID, and column ID are required');
      }

      // Ensure userId is a number
      const numericUserId = parseInt(userId);
      
      // Format the people column value
      const columnValue = {
        [columnId]: {
          personsAndTeams: [
            {
              id: numericUserId,
              kind: 'person'
            }
          ]
        }
      };

      const mutation = `
        mutation AssignUser($itemId: ID!, $columnValues: String!) {
          change_multiple_column_values(
            item_id: $itemId,
            column_values: $columnValues
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

      const variables = {
        itemId: parseInt(itemId),
        columnValues: JSON.stringify(columnValue)
      };

      const result = await this.client.request(mutation, variables);
      
      logOperation('assignUser', {
        itemId,
        userId,
        columnId,
        success: true
      });

      return {
        success: true,
        item: result.data.change_multiple_column_values,
        operation: 'assign_user'
      };

    } catch (error) {
      logError('assignUser', error, { itemId, userId, columnId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'assign_user'
      };
    }
  }

  /**
   * Remove a user from an item
   * @param {string} itemId - Item ID
   * @param {string|number} userId - User ID to remove
   * @param {string} columnId - People column ID
   * @returns {object} Removal result
   */
  async removeUser(itemId, userId, columnId) {
    try {
      if (!itemId || !columnId) {
        throw new Error('Item ID and column ID are required');
      }

      // First, get current assignees
      const currentAssignees = await this.getCurrentAssignees(itemId, columnId);
      
      // Filter out the user to remove
      const numericUserId = parseInt(userId);
      const updatedAssignees = currentAssignees.filter(
        assignee => assignee.id !== numericUserId
      );

      // Update the column with remaining assignees
      const columnValue = {
        [columnId]: {
          personsAndTeams: updatedAssignees
        }
      };

      const mutation = `
        mutation RemoveUser($itemId: ID!, $columnValues: String!) {
          change_multiple_column_values(
            item_id: $itemId,
            column_values: $columnValues
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

      const variables = {
        itemId: parseInt(itemId),
        columnValues: JSON.stringify(columnValue)
      };

      const result = await this.client.request(mutation, variables);
      
      logOperation('removeUser', {
        itemId,
        userId,
        columnId,
        success: true
      });

      return {
        success: true,
        item: result.data.change_multiple_column_values,
        operation: 'remove_user'
      };

    } catch (error) {
      logError('removeUser', error, { itemId, userId, columnId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'remove_user'
      };
    }
  }

  /**
   * Bulk assign a user to multiple items
   * @param {array} itemIds - Array of item IDs
   * @param {string|number} userId - User ID to assign
   * @param {string} columnId - People column ID
   * @returns {object} Bulk assignment results
   */
  async bulkAssign(itemIds, userId, columnId) {
    try {
      if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
        throw new Error('Item IDs array is required');
      }
      if (!userId || !columnId) {
        throw new Error('User ID and column ID are required');
      }

      const numericUserId = parseInt(userId);
      const results = [];
      const errors = [];

      // Process in batches to avoid rate limits
      const batchSize = 10;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        
        const batchPromises = batch.map(itemId => 
          this.assignUser(itemId, numericUserId, columnId)
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
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < itemIds.length) {
          await this.delay(200);
        }
      }

      logOperation('bulkAssign', {
        totalItems: itemIds.length,
        successful: results.length,
        failed: errors.length,
        userId,
        columnId
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
        operation: 'bulk_assign'
      };

    } catch (error) {
      logError('bulkAssign', error, { itemIds, userId, columnId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'bulk_assign'
      };
    }
  }

  /**
   * Get available users for a board
   * @param {string} boardId - Board ID
   * @returns {object} Available users list
   */
  async getAvailableUsers(boardId) {
    try {
      if (!boardId) {
        throw new Error('Board ID is required');
      }

      // Check cache first
      const cacheKey = `users-${boardId}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }

      const query = `
        query GetBoardUsers($boardId: ID!) {
          boards(ids: [$boardId]) {
            subscribers {
              id
              name
              email
              photo_thumb
              title
              is_guest
              teams {
                id
                name
              }
            }
            workspace {
              users_subscribers {
                id
                name
                email
                photo_thumb
                title
                is_guest
                teams {
                  id
                  name
                }
              }
            }
          }
        }
      `;

      const result = await this.client.request(query, { boardId });
      const board = result.data.boards[0];
      
      // Combine board subscribers and workspace users
      const allUsers = new Map();
      
      // Add board subscribers
      board.subscribers.forEach(user => {
        allUsers.set(user.id, {
          ...user,
          source: 'board_subscriber'
        });
      });
      
      // Add workspace users
      if (board.workspace?.users_subscribers) {
        board.workspace.users_subscribers.forEach(user => {
          if (!allUsers.has(user.id)) {
            allUsers.set(user.id, {
              ...user,
              source: 'workspace_user'
            });
          }
        });
      }

      const users = Array.from(allUsers.values());
      
      // Cache the result
      this.setCache(cacheKey, users);

      logOperation('getAvailableUsers', {
        boardId,
        userCount: users.length,
        success: true
      });

      return {
        success: true,
        users,
        operation: 'get_available_users'
      };

    } catch (error) {
      logError('getAvailableUsers', error, { boardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'get_available_users'
      };
    }
  }

  /**
   * Check user permissions for a specific operation
   * @param {string} userId - User ID
   * @param {string} boardId - Board ID
   * @param {string} operation - Operation to check
   * @returns {object} Permission check result
   */
  async checkPermissions(userId, boardId, operation) {
    try {
      if (!userId || !boardId || !operation) {
        throw new Error('User ID, board ID, and operation are required');
      }

      // Get user's role on the board
      const query = `
        query CheckUserPermissions($boardId: ID!) {
          boards(ids: [$boardId]) {
            permissions
            subscribers {
              id
              is_guest
            }
            workspace {
              id
              kind
              account_product {
                kind
              }
            }
          }
          me {
            id
            is_guest
            account {
              tier
            }
          }
        }
      `;

      const result = await this.client.request(query, { boardId });
      const board = result.data.boards[0];
      const currentUser = result.data.me;
      
      // Check if user is the current user
      const isCurrentUser = currentUser.id === parseInt(userId);
      
      // Find user in subscribers
      const userSubscriber = board.subscribers.find(
        sub => sub.id === parseInt(userId)
      );
      
      // Determine permissions based on operation
      const permissions = {
        canRead: true, // All subscribers can read
        canWrite: !userSubscriber?.is_guest,
        canDelete: !userSubscriber?.is_guest && isCurrentUser,
        canManageBoard: isCurrentUser && !currentUser.is_guest,
        canInviteUsers: !userSubscriber?.is_guest,
        isGuest: userSubscriber?.is_guest || false,
        isSubscriber: !!userSubscriber
      };

      // Check specific operation
      const operationPermissions = {
        'create_item': permissions.canWrite,
        'update_item': permissions.canWrite,
        'delete_item': permissions.canDelete,
        'assign_user': permissions.canWrite,
        'manage_board': permissions.canManageBoard,
        'invite_user': permissions.canInviteUsers
      };

      const hasPermission = operationPermissions[operation] || false;

      logOperation('checkPermissions', {
        userId,
        boardId,
        operation,
        hasPermission,
        success: true
      });

      return {
        success: true,
        hasPermission,
        permissions,
        operation: 'check_permissions'
      };

    } catch (error) {
      logError('checkPermissions', error, { userId, boardId, operation });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'check_permissions'
      };
    }
  }

  /**
   * Get current assignees for an item
   * @private
   */
  async getCurrentAssignees(itemId, columnId) {
    const query = `
      query GetItemAssignees($itemId: ID!) {
        items(ids: [$itemId]) {
          column_values(ids: ["${columnId}"]) {
            id
            value
          }
        }
      }
    `;

    const result = await this.client.request(query, { itemId: parseInt(itemId) });
    const columnValue = result.data.items[0]?.column_values[0];
    
    if (columnValue?.value) {
      const parsedValue = JSON.parse(columnValue.value);
      return parsedValue.personsAndTeams || [];
    }
    
    return [];
  }

  /**
   * Cache helper methods
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

export default new UserOperations();