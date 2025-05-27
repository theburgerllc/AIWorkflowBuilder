// services/context.js
const { Logger } = require('@mondaycom/apps-sdk');
const AI_CONFIG = require('../config/ai');

class ContextService {
  constructor(mondayClient) {
    this.mondayClient = mondayClient;
    this.logger = new Logger('context-service');
    this.cache = new Map();
    this.cacheTimestamps = new Map();
  }

  /**
   * Gather comprehensive context for AI analysis
   * @param {Object} params - Context parameters
   * @param {string} params.accountId - Monday.com account ID
   * @param {string} [params.boardId] - Specific board ID
   * @param {string} [params.userId] - User ID for permissions
   * @returns {Promise<Object>} - Complete context object
   */
  async gatherContext({ accountId, boardId, userId }) {
    try {
      this.logger.info('Gathering context', { accountId, boardId, userId });

      const context = {
        account: await this._getAccountInfo(accountId),
        user: userId ? await this._getUserInfo(userId) : null,
        boards: await this._getBoardsContext(accountId, boardId),
        users: await this._getUsersContext(accountId),
        permissions: await this._getPermissionsContext(accountId, userId),
        timestamp: Date.now()
      };

      // Add current board as primary context if specified
      if (boardId) {
        context.currentBoard = context.boards.find(b => b.id === boardId);
      }

      this.logger.info('Context gathered successfully', {
        boardCount: context.boards.length,
        userCount: context.users.length,
        hasCurrentBoard: !!context.currentBoard
      });

      return context;
    } catch (error) {
      this.logger.error('Failed to gather context', { error: error.message });
      throw new Error(`Context gathering failed: ${error.message}`);
    }
  }

  /**
   * Get cached context or fetch fresh if expired
   */
  async getCachedContext(key, fetchFunction, ttl = 300000) {
    const now = Date.now();
    const cached = this.cache.get(key);
    const timestamp = this.cacheTimestamps.get(key);

    if (cached && timestamp && (now - timestamp) < ttl) {
      this.logger.info('Using cached context', { key });
      return cached;
    }

    this.logger.info('Fetching fresh context', { key });
    const fresh = await fetchFunction();
    this.cache.set(key, fresh);
    this.cacheTimestamps.set(key, now);

    return fresh;
  }

  /**
   * Get account information
   * @private
   */
  async _getAccountInfo(accountId) {
    const cacheKey = `account_${accountId}`;

    return this.getCachedContext(cacheKey, async () => {
      try {
        const query = `
          query {
            account {
              id
              name
              plan {
                max_users
                tier
              }
              products {
                kind
              }
            }
          }
        `;

        const response = await this.mondayClient.api(query);
        return response.data.account;
      } catch (error) {
        this.logger.warn('Failed to fetch account info', { error: error.message });
        return { id: accountId, name: 'Unknown Account' };
      }
    }, AI_CONFIG.context.userContextTTL);
  }

  /**
   * Get user information and permissions
   * @private
   */
  async _getUserInfo(userId) {
    const cacheKey = `user_${userId}`;

    return this.getCachedContext(cacheKey, async () => {
      try {
        const query = `
          query {
            users(ids: [${userId}]) {
              id
              name
              email
              is_admin
              is_guest
              enabled
              teams {
                id
                name
              }
            }
          }
        `;

        const response = await this.mondayClient.api(query);
        return response.data.users[0];
      } catch (error) {
        this.logger.warn('Failed to fetch user info', { userId, error: error.message });
        return { id: userId, name: 'Unknown User', is_admin: false };
      }
    }, AI_CONFIG.context.userContextTTL);
  }

  /**
   * Get boards context with structure
   * @private
   */
  async _getBoardsContext(accountId, specificBoardId = null) {
    const cacheKey = specificBoardId ? `board_${specificBoardId}` : `boards_${accountId}`;

    return this.getCachedContext(cacheKey, async () => {
      try {
        const boardsFilter = specificBoardId ? `ids: [${specificBoardId}]` :
          `limit: ${AI_CONFIG.context.maxBoardsToFetch}`;

        const query = `
          query {
            boards(${boardsFilter}) {
              id
              name
              state
              board_kind
              description
              workspace {
                id
                name
              }
              groups {
                id
                title
                color
                position
              }
              columns {
                id
                title
                type
                settings_str
                archived
              }
              items_page(limit: ${Math.min(AI_CONFIG.context.maxItemsPerBoard, 25)}) {
                items {
                  id
                  name
                  state
                  group {
                    id
                    title
                  }
                  column_values {
                    id
                    text
                    type
                  }
                }
              }
              permissions
              board_folder_id
              tags {
                id
                name
                color
              }
            }
          }
        `;

        const response = await this.mondayClient.api(query);
        return this._processBoardsData(response.data.boards);
      } catch (error) {
        this.logger.error('Failed to fetch boards context', { error: error.message });
        return [];
      }
    }, AI_CONFIG.context.boardContextTTL);
  }

  /**
   * Process and optimize boards data
   * @private
   */
  _processBoardsData(boards) {
    return boards.map(board => {
      // Compress large boards to fit token limits
      let processedBoard = {
        id: board.id,
        name: board.name,
        state: board.state,
        kind: board.board_kind,
        description: board.description,
        workspace: board.workspace,
        permissions: board.permissions
      };

      // Limit groups if too many
      if (board.groups && board.groups.length > AI_CONFIG.context.maxGroupsInContext) {
        processedBoard.groups = board.groups
          .slice(0, AI_CONFIG.context.maxGroupsInContext)
          .map(g => ({ id: g.id, title: g.title, color: g.color }));
        processedBoard.groupsCount = board.groups.length;
      } else {
        processedBoard.groups = board.groups;
      }

      // Limit columns if too many
      if (board.columns && board.columns.length > AI_CONFIG.context.maxColumnsInContext) {
        processedBoard.columns = board.columns
          .slice(0, AI_CONFIG.context.maxColumnsInContext)
          .map(c => ({ id: c.id, title: c.title, type: c.type }));
        processedBoard.columnsCount = board.columns.length;
      } else {
        processedBoard.columns = board.columns?.map(c => ({
          id: c.id,
          title: c.title,
          type: c.type,
          settings: this._parseColumnSettings(c.settings_str),
          archived: c.archived
        }));
      }

      // Sample items for context
      if (board.items_page?.items) {
        processedBoard.sampleItems = board.items_page.items.slice(0, 5).map(item => ({
          id: item.id,
          name: item.name,
          state: item.state,
          groupId: item.group?.id,
          groupTitle: item.group?.title
        }));
        processedBoard.totalItems = board.items_page.items.length;
      }

      // Add tags for context
      processedBoard.tags = board.tags?.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color
      }));

      return processedBoard;
    });
  }

  /**
   * Get users context for assignments
   * @private
   */
  async _getUsersContext(accountId) {
    const cacheKey = `users_${accountId}`;

    return this.getCachedContext(cacheKey, async () => {
      try {
        const query = `
          query {
            users(limit: ${AI_CONFIG.context.maxUsersToFetch}) {
              id
              name
              email
              is_admin
              is_guest
              enabled
              photo_thumb
              teams {
                id
                name
              }
            }
          }
        `;

        const response = await this.mondayClient.api(query);
        return response.data.users
          .filter(user => user.enabled)
          .map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.is_admin ? 'admin' : user.is_guest ? 'guest' : 'member',
            teams: user.teams?.map(t => ({ id: t.id, name: t.name }))
          }));
      } catch (error) {
        this.logger.warn('Failed to fetch users context', { error: error.message });
        return [];
      }
    }, AI_CONFIG.context.userContextTTL);
  }

  /**
   * Get permissions context for validation
   * @private
   */
  async _getPermissionsContext(accountId, userId) {
    const cacheKey = `permissions_${accountId}_${userId}`;

    return this.getCachedContext(cacheKey, async () => {
      try {
        // Get user's board permissions
        const query = `
          query {
            me {
              id
              is_admin
              is_guest
              account {
                id
                plan {
                  tier
                }
              }
            }
          }
        `;

        const response = await this.mondayClient.api(query);
        const user = response.data.me;

        return {
          isAdmin: user.is_admin,
          isGuest: user.is_guest,
          canCreateBoards: user.is_admin || !user.is_guest,
          canDeleteItems: user.is_admin || !user.is_guest,
          canManageUsers: user.is_admin,
          canCreateAutomations: user.is_admin || !user.is_guest,
          planTier: user.account?.plan?.tier
        };
      } catch (error) {
        this.logger.warn('Failed to fetch permissions context', { error: error.message });
        return {
          isAdmin: false,
          isGuest: true,
          canCreateBoards: false,
          canDeleteItems: false,
          canManageUsers: false,
          canCreateAutomations: false
        };
      }
    }, AI_CONFIG.context.permissionsTTL);
  }

  /**
   * Parse column settings JSON
   * @private
   */
  _parseColumnSettings(settingsStr) {
    try {
      return settingsStr ? JSON.parse(settingsStr) : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Clear context cache
   */
  clearCache(pattern = null) {
    if (pattern) {
      // Clear specific pattern
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
          this.cacheTimestamps.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
      this.cacheTimestamps.clear();
    }

    this.logger.info('Context cache cleared', { pattern });
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let expired = 0;
    let active = 0;

    for (const [key, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > AI_CONFIG.context.boardContextTTL) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      totalEntries: this.cache.size,
      activeEntries: active,
      expiredEntries: expired,
      memoryUsage: JSON.stringify([...this.cache.values()]).length
    };
  }

  /**
   * Validate context completeness for operation
   */
  validateContextForOperation(context, operationType) {
    const validation = {
      valid: true,
      missing: [],
      warnings: []
    };

    // Check based on operation type
    switch (operationType) {
      case 'ITEM_CREATE':
      case 'ITEM_UPDATE':
        if (!context.currentBoard) {
          validation.missing.push('Board context required');
          validation.valid = false;
        }
        break;

      case 'USER_ASSIGN':
        if (!context.users || context.users.length === 0) {
          validation.missing.push('User context required');
          validation.valid = false;
        }
        break;

      case 'BOARD_CREATE':
        if (!context.permissions || !context.permissions.canCreateBoards) {
          validation.missing.push('Board creation permissions');
          validation.valid = false;
        }
        break;

      case 'AUTOMATION_CREATE':
        if (!context.permissions || !context.permissions.canCreateAutomations) {
          validation.missing.push('Automation creation permissions');
          validation.valid = false;
        }
        break;
    }

    return validation;
  }

  /**
   * Get minimal context for token optimization
   */
  getMinimalContext(fullContext, operationType) {
    const minimal = {
      timestamp: fullContext.timestamp
    };

    // Include only relevant context based on operation
    switch (operationType) {
      case 'ITEM_CREATE':
      case 'ITEM_UPDATE':
      case 'STATUS_UPDATE':
        minimal.currentBoard = fullContext.currentBoard;
        minimal.users = fullContext.users?.slice(0, 10); // Limit users
        break;

      case 'USER_ASSIGN':
        minimal.users = fullContext.users;
        minimal.currentBoard = {
          id: fullContext.currentBoard?.id,
          name: fullContext.currentBoard?.name
        };
        break;

      case 'BOARD_CREATE':
        minimal.account = fullContext.account;
        minimal.permissions = fullContext.permissions;
        minimal.boards = fullContext.boards?.map(b => ({ id: b.id, name: b.name }));
        break;

      default:
        // Return full context for complex operations
        return fullContext;
    }

    minimal.permissions = fullContext.permissions;
    return minimal;
  }
}

module.exports = ContextService;
