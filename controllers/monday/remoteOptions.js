// controllers/monday/remoteOptions.js
const crypto = require('crypto');
const { logger } = require('../../utils/logger');
const ContextService = require('../../services/context');
const { mondayClient } = require('../../config/monday');

class RemoteOptionsController {
  constructor() {
    this.contextService = new ContextService();
  }

  /**
   * Verify Monday.com webhook signature
   */
  verifySignature(req, res, next) {
    try {
      const signature = req.get('authorization');
      const body = JSON.stringify(req.body);
      
      if (!signature) {
        logger.warn('Missing Monday.com signature for remote options');
        return res.status(401).json({ error: 'Missing signature' });
      }

      const receivedSignature = signature.replace('Bearer ', '');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.MONDAY_SIGNING_SECRET)
        .update(body)
        .digest('hex');

      if (receivedSignature !== expectedSignature) {
        logger.warn('Invalid Monday.com signature for remote options');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      next();
    } catch (error) {
      logger.error('Remote options signature verification failed', { error: error.message });
      res.status(500).json({ error: 'Signature verification failed' });
    }
  }

  /**
   * Get remote options for Monday.com dropdowns
   * POST /monday/get_remote_list_options
   */
  async getRemoteOptions(req, res) {
    try {
      const { payload } = req.body;
      
      if (!payload) {
        return res.status(400).json({
          error: 'Missing payload',
          code: 'MISSING_PAYLOAD'
        });
      }

      const {
        fieldType,
        boardId,
        itemId,
        userId,
        accountId,
        columnId,
        recipe
      } = payload;

      logger.info('Remote options requested', {
        fieldType,
        boardId,
        itemId,
        userId,
        accountId,
        columnId
      });

      let options = [];

      // Generate options based on field type
      switch (fieldType) {
        case 'board_selector':
          options = await this.getBoardOptions(accountId);
          break;
          
        case 'column_selector':
          options = await this.getColumnOptions(boardId);
          break;
          
        case 'user_selector':
          options = await this.getUserOptions(accountId);
          break;
          
        case 'group_selector':
          options = await this.getGroupOptions(boardId);
          break;
          
        case 'status_selector':
          options = await this.getStatusOptions(boardId, columnId);
          break;
          
        case 'automation_template':
          options = await this.getAutomationTemplates();
          break;
          
        case 'ai_operation_type':
          options = await this.getAIOperationTypes();
          break;
          
        default:
          logger.warn('Unknown field type for remote options', { fieldType });
          options = [];
      }

      logger.info('Remote options generated', {
        fieldType,
        optionsCount: options.length
      });

      // Return Monday.com compatible response
      res.json({
        options: options
      });

    } catch (error) {
      logger.error('Remote options generation failed', {
        error: error.message,
        stack: error.stack,
        payload: req.body.payload
      });

      res.status(500).json({
        error: 'Failed to generate remote options',
        message: error.message,
        code: 'REMOTE_OPTIONS_FAILED'
      });
    }
  }

  /**
   * Get board options for dropdown
   */
  async getBoardOptions(accountId) {
    try {
      const context = await this.contextService.gatherContext({ accountId });
      
      return context.boards.map(board => ({
        title: board.name,
        value: board.id
      }));
    } catch (error) {
      logger.error('Failed to get board options', { error: error.message });
      return [];
    }
  }

  /**
   * Get column options for dropdown
   */
  async getColumnOptions(boardId) {
    try {
      if (!boardId) return [];

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

      const result = await mondayClient.request(query, { boardId });
      const board = result.data.boards[0];
      
      if (!board) return [];

      return board.columns.map(column => ({
        title: `${column.title} (${column.type})`,
        value: column.id
      }));
    } catch (error) {
      logger.error('Failed to get column options', { error: error.message });
      return [];
    }
  }

  /**
   * Get user options for dropdown
   */
  async getUserOptions(accountId) {
    try {
      const context = await this.contextService.gatherContext({ accountId });
      
      return context.users.map(user => ({
        title: user.name,
        value: user.id
      }));
    } catch (error) {
      logger.error('Failed to get user options', { error: error.message });
      return [];
    }
  }

  /**
   * Get group options for dropdown
   */
  async getGroupOptions(boardId) {
    try {
      if (!boardId) return [];

      const query = `
        query GetBoardGroups($boardId: ID!) {
          boards(ids: [$boardId]) {
            groups {
              id
              title
              color
            }
          }
        }
      `;

      const result = await mondayClient.request(query, { boardId });
      const board = result.data.boards[0];
      
      if (!board) return [];

      return board.groups.map(group => ({
        title: group.title,
        value: group.id
      }));
    } catch (error) {
      logger.error('Failed to get group options', { error: error.message });
      return [];
    }
  }

  /**
   * Get status options for dropdown
   */
  async getStatusOptions(boardId, columnId) {
    try {
      if (!boardId || !columnId) return [];

      const query = `
        query GetColumnSettings($boardId: ID!) {
          boards(ids: [$boardId]) {
            columns(ids: ["${columnId}"]) {
              id
              title
              type
              settings_str
            }
          }
        }
      `;

      const result = await mondayClient.request(query, { boardId });
      const board = result.data.boards[0];
      
      if (!board || !board.columns[0]) return [];

      const column = board.columns[0];
      
      if (column.type !== 'color') return [];

      try {
        const settings = JSON.parse(column.settings_str);
        const labels = settings.labels || {};
        
        return Object.entries(labels).map(([index, label]) => ({
          title: label,
          value: index
        }));
      } catch (parseError) {
        logger.warn('Failed to parse column settings', { parseError: parseError.message });
        return [];
      }
    } catch (error) {
      logger.error('Failed to get status options', { error: error.message });
      return [];
    }
  }

  /**
   * Get automation templates
   */
  async getAutomationTemplates() {
    return [
      { title: 'Create Item', value: 'create_item' },
      { title: 'Update Item', value: 'update_item' },
      { title: 'Move Item', value: 'move_item' },
      { title: 'Assign User', value: 'assign_user' },
      { title: 'Change Status', value: 'change_status' },
      { title: 'Add Update', value: 'add_update' },
      { title: 'Send Notification', value: 'send_notification' },
      { title: 'Create Subitems', value: 'create_subitems' }
    ];
  }

  /**
   * Get AI operation types
   */
  async getAIOperationTypes() {
    return [
      { title: 'Natural Language Processing', value: 'nlp_analysis' },
      { title: 'Smart Automation', value: 'smart_automation' },
      { title: 'Data Analysis', value: 'data_analysis' },
      { title: 'Content Generation', value: 'content_generation' },
      { title: 'Task Prioritization', value: 'task_prioritization' },
      { title: 'Smart Scheduling', value: 'smart_scheduling' },
      { title: 'Risk Assessment', value: 'risk_assessment' },
      { title: 'Performance Insights', value: 'performance_insights' }
    ];
  }
}

// Create singleton instance
const remoteOptionsController = new RemoteOptionsController();

// Export middleware and handler functions
module.exports = {
  verifySignature: remoteOptionsController.verifySignature.bind(remoteOptionsController),
  getRemoteOptions: remoteOptionsController.getRemoteOptions.bind(remoteOptionsController)
};
