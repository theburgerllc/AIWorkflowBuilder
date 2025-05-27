// operations/board-operations.js
import { mondayClient } from '../config/monday-client.js';
import { logOperation, logError } from '../utils/logger.js';

class BoardOperations {
  constructor() {
    this.client = mondayClient;
    this.columnTypes = [
      'text', 'numbers', 'status', 'person', 'date', 'timeline',
      'tags', 'email', 'phone', 'link', 'rating', 'checkbox',
      'dropdown', 'long_text', 'file', 'formula', 'mirror'
    ];
  }

  /**
   * Create a new board
   * @param {string} workspaceId - Workspace ID (optional)
   * @param {string} boardName - Name of the board
   * @param {string} boardKind - Board type (public/private/share)
   * @param {string} templateId - Template ID to use (optional)
   * @returns {object} Created board details
   */
  async createBoard(workspaceId, boardName, boardKind = 'public', templateId = null) {
    try {
      if (!boardName) {
        throw new Error('Board name is required');
      }

      let mutation;
      let variables;

      if (templateId) {
        // Create from template
        mutation = `
          mutation CreateBoardFromTemplate($boardName: String!, $boardKind: BoardKind!, $workspaceId: ID, $templateId: ID!) {
            create_board(
              board_name: $boardName,
              board_kind: $boardKind,
              workspace_id: $workspaceId,
              template_id: $templateId
            ) {
              id
              name
              description
              state
              workspace_id
              columns {
                id
                title
                type
              }
              groups {
                id
                title
                position
              }
            }
          }
        `;
        
        variables = {
          boardName,
          boardKind,
          workspaceId,
          templateId
        };
      } else {
        // Create blank board
        mutation = `
          mutation CreateBoard($boardName: String!, $boardKind: BoardKind!, $workspaceId: ID) {
            create_board(
              board_name: $boardName,
              board_kind: $boardKind,
              workspace_id: $workspaceId
            ) {
              id
              name
              description
              state
              workspace_id
              columns {
                id
                title
                type
              }
              groups {
                id
                title
                position
              }
            }
          }
        `;
        
        variables = {
          boardName,
          boardKind,
          workspaceId
        };
      }

      const result = await this.client.request(mutation, variables);
      const board = result.data.create_board;

      // Add default group if none exist
      if (!board.groups || board.groups.length === 0) {
        await this.addGroup(board.id, 'New Items', 'start');
      }

      logOperation('createBoard', {
        boardId: board.id,
        boardName,
        workspaceId,
        success: true
      });

      return {
        success: true,
        board,
        operation: 'create_board'
      };

    } catch (error) {
      logError('createBoard', error, { boardName, workspaceId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'create_board'
      };
    }
  }

  /**
   * Update board properties
   * @param {string} boardId - Board ID to update
   * @param {object} updates - Updates to apply (name, description)
   * @returns {object} Updated board details
   */
  async updateBoard(boardId, updates) {
    try {
      if (!boardId || !updates) {
        throw new Error('Board ID and updates are required');
      }

      const mutations = [];
      const results = {};

      // Update board name
      if (updates.name) {
        const nameMutation = `
          mutation UpdateBoardName($boardId: ID!, $name: String!) {
            update_board(board_id: $boardId, board_attribute: name, new_value: $name) {
              id
              name
            }
          }
        `;
        
        const nameResult = await this.client.request(nameMutation, {
          boardId,
          name: updates.name
        });
        results.name = nameResult.data.update_board;
      }

      // Update board description
      if (updates.description) {
        const descMutation = `
          mutation UpdateBoardDescription($boardId: ID!, $description: String!) {
            update_board(board_id: $boardId, board_attribute: description, new_value: $description) {
              id
              description
            }
          }
        `;
        
        const descResult = await this.client.request(descMutation, {
          boardId,
          description: updates.description
        });
        results.description = descResult.data.update_board;
      }

      logOperation('updateBoard', {
        boardId,
        updates: Object.keys(updates),
        success: true
      });

      return {
        success: true,
        board: results,
        operation: 'update_board'
      };

    } catch (error) {
      logError('updateBoard', error, { boardId, updates });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'update_board'
      };
    }
  }

  /**
   * Delete a board
   * @param {string} boardId - Board ID to delete
   * @returns {object} Deletion result
   */
  async deleteBoard(boardId) {
    try {
      if (!boardId) {
        throw new Error('Board ID is required');
      }

      const mutation = `
        mutation DeleteBoard($boardId: ID!) {
          delete_board(board_id: $boardId) {
            id
            name
            state
          }
        }
      `;

      const result = await this.client.request(mutation, { boardId });
      
      logOperation('deleteBoard', {
        boardId,
        success: true
      });

      return {
        success: true,
        deletedBoard: result.data.delete_board,
        operation: 'delete_board'
      };

    } catch (error) {
      logError('deleteBoard', error, { boardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'delete_board'
      };
    }
  }

  /**
   * Duplicate a board
   * @param {string} boardId - Board ID to duplicate
   * @param {string} targetWorkspaceId - Target workspace ID (optional)
   * @param {string} duplicateName - Name for the duplicate (optional)
   * @returns {object} Duplicated board details
   */
  async duplicateBoard(boardId, targetWorkspaceId = null, duplicateName = null) {
    try {
      if (!boardId) {
        throw new Error('Board ID is required');
      }

      const mutation = `
        mutation DuplicateBoard($boardId: ID!, $duplicateName: String, $workspaceId: ID, $keepSubscribers: Boolean!) {
          duplicate_board(
            board_id: $boardId,
            duplicate_type: duplicate_board_with_structure,
            board_name: $duplicateName,
            workspace_id: $workspaceId,
            keep_subscribers: $keepSubscribers
          ) {
            board {
              id
              name
              workspace_id
              columns {
                id
                title
                type
              }
              groups {
                id
                title
              }
            }
          }
        }
      `;

      const variables = {
        boardId,
        duplicateName,
        workspaceId: targetWorkspaceId,
        keepSubscribers: false
      };

      const result = await this.client.request(mutation, variables);
      
      logOperation('duplicateBoard', {
        sourceBoardId: boardId,
        newBoardId: result.data.duplicate_board.board.id,
        success: true
      });

      return {
        success: true,
        board: result.data.duplicate_board.board,
        operation: 'duplicate_board'
      };

    } catch (error) {
      logError('duplicateBoard', error, { boardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'duplicate_board'
      };
    }
  }

  /**
   * Add a column to a board
   * @param {string} boardId - Board ID
   * @param {string} title - Column title
   * @param {string} columnType - Column type
   * @param {object} defaults - Default values/settings
   * @returns {object} Created column details
   */
  async addColumn(boardId, title, columnType, defaults = {}) {
    try {
      if (!boardId || !title || !columnType) {
        throw new Error('Board ID, title, and column type are required');
      }

      if (!this.columnTypes.includes(columnType)) {
        throw new Error(`Invalid column type: ${columnType}`);
      }

      const mutation = `
        mutation AddColumn($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: String) {
          add_column(
            board_id: $boardId,
            title: $title,
            column_type: $columnType,
            defaults: $defaults
          ) {
            id
            title
            type
            settings_str
          }
        }
      `;

      const variables = {
        boardId,
        title,
        columnType,
        defaults: defaults ? JSON.stringify(defaults) : null
      };

      const result = await this.client.request(mutation, variables);
      
      logOperation('addColumn', {
        boardId,
        columnId: result.data.add_column.id,
        columnType,
        success: true
      });

      return {
        success: true,
        column: result.data.add_column,
        operation: 'add_column'
      };

    } catch (error) {
      logError('addColumn', error, { boardId, title, columnType });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'add_column'
      };
    }
  }

  /**
   * Add a group to a board
   * @param {string} boardId - Board ID
   * @param {string} groupName - Group name
   * @param {string} position - Position (start/end or relative_to_group)
   * @param {string} relativeTo - Group ID to position relative to
   * @returns {object} Created group details
   */
  async addGroup(boardId, groupName, position = 'end', relativeTo = null) {
    try {
      if (!boardId || !groupName) {
        throw new Error('Board ID and group name are required');
      }

      let mutation;
      let variables;

      if (relativeTo) {
        mutation = `
          mutation AddGroupRelative($boardId: ID!, $groupName: String!, $position: String!, $relativeTo: String!) {
            create_group(
              board_id: $boardId,
              group_name: $groupName,
              position: $position,
              relative_to: $relativeTo
            ) {
              id
              title
              position
              color
            }
          }
        `;
        
        variables = {
          boardId,
          groupName,
          position: 'after_at',
          relativeTo
        };
      } else {
        mutation = `
          mutation AddGroup($boardId: ID!, $groupName: String!) {
            create_group(
              board_id: $boardId,
              group_name: $groupName
            ) {
              id
              title
              position
              color
            }
          }
        `;
        
        variables = {
          boardId,
          groupName
        };
      }

      const result = await this.client.request(mutation, variables);
      
      logOperation('addGroup', {
        boardId,
        groupId: result.data.create_group.id,
        groupName,
        success: true
      });

      return {
        success: true,
        group: result.data.create_group,
        operation: 'add_group'
      };

    } catch (error) {
      logError('addGroup', error, { boardId, groupName });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'add_group'
      };
    }
  }

  /**
   * Get board structure (columns and groups)
   * @param {string} boardId - Board ID
   * @returns {object} Board structure
   */
  async getBoardStructure(boardId) {
    try {
      const query = `
        query GetBoardStructure($boardId: ID!) {
          boards(ids: [$boardId]) {
            id
            name
            columns {
              id
              title
              type
              settings_str
            }
            groups {
              id
              title
              position
              color
            }
          }
        }
      `;

      const result = await this.client.request(query, { boardId });
      return result.data.boards[0];

    } catch (error) {
      logError('getBoardStructure', error, { boardId });
      throw error;
    }
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
}

export default new BoardOperations();