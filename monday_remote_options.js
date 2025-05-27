/**
 * Monday.com Remote Options Handler
 * Provides dynamic field options for integration blocks
 */

const { mondayApi } = require('../../config/monday');
const logger = require('../../utils/logger');

class MondayRemoteOptionsHandler {
  constructor() {
    this.optionProviders = {
      'boards': this.getBoardOptions.bind(this),
      'groups': this.getGroupOptions.bind(this),
      'columns': this.getColumnOptions.bind(this),
      'items': this.getItemOptions.bind(this),
      'users': this.getUserOptions.bind(this),
      'workspaces': this.getWorkspaceOptions.bind(this),
      'teams': this.getTeamOptions.bind(this),
      'tags': this.getTagOptions.bind(this),
      'statuses': this.getStatusOptions.bind(this),
      'priorities': this.getPriorityOptions.bind(this),
      'subscribers': this.getSubscriberOptions.bind(this),
      'board_types': this.getBoardTypeOptions.bind(this),
      'column_types': this.getColumnTypeOptions.bind(this)
    };
  }

  /**
   * Get remote options for a specific field type
   * @param {string} fieldType - Type of field requesting options
   * @param {Object} context - Context data (board_id, group_id, etc.)
   * @param {string} accessToken - Monday.com access token
   * @param {string} searchTerm - Optional search term for filtering
   * @returns {Promise<Array>} Array of options
   */
  async getRemoteOptions(fieldType, context = {}, accessToken, searchTerm = '') {
    try {
      logger.info(`Fetching remote options for field type: ${fieldType}`, { context, searchTerm });

      if (!this.optionProviders[fieldType]) {
        throw new Error(`Unsupported field type: ${fieldType}`);
      }

      const options = await this.optionProviders[fieldType](context, accessToken, searchTerm);
      
      logger.info(`Successfully fetched ${options.length} options for ${fieldType}`);
      return options;

    } catch (error) {
      logger.error(`Failed to fetch remote options for ${fieldType}`, { error: error.message, context });
      throw error;
    }
  }

  /**
   * Get board options
   */
  async getBoardOptions(context, accessToken, searchTerm) {
    const query = `
      query {
        boards(limit: 50${searchTerm ? `, filter: {name: "${searchTerm}"}` : ''}) {
          id
          name
          description
          workspace {
            id
            name
          }
          state
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    
    return response.data.boards.map(board => ({
      title: board.name,
      value: board.id,
      description: board.description || `Board in ${board.workspace?.name || 'workspace'}`,
      metadata: {
        workspace_id: board.workspace?.id,
        workspace_name: board.workspace?.name,
        state: board.state
      }
    }));
  }

  /**
   * Get group options for a specific board
   */
  async getGroupOptions(context, accessToken, searchTerm) {
    const { board_id } = context;
    
    if (!board_id) {
      return [];
    }

    const query = `
      query {
        boards(ids: [${board_id}]) {
          groups {
            id
            title
            color
            position
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const groups = response.data.boards[0]?.groups || [];
    
    return groups
      .filter(group => !searchTerm || group.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(group => ({
        title: group.title,
        value: group.id,
        description: `Group in board`,
        metadata: {
          color: group.color,
          position: group.position
        }
      }));
  }

  /**
   * Get column options for a specific board
   */
  async getColumnOptions(context, accessToken, searchTerm) {
    const { board_id, column_type_filter } = context;
    
    if (!board_id) {
      return [];
    }

    const query = `
      query {
        boards(ids: [${board_id}]) {
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const columns = response.data.boards[0]?.columns || [];
    
    return columns
      .filter(column => {
        const matchesSearch = !searchTerm || column.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = !column_type_filter || column.type === column_type_filter;
        return matchesSearch && matchesType;
      })
      .map(column => ({
        title: column.title,
        value: column.id,
        description: `${column.type} column`,
        metadata: {
          type: column.type,
          settings: column.settings_str
        }
      }));
  }

  /**
   * Get item options for a specific board/group
   */
  async getItemOptions(context, accessToken, searchTerm) {
    const { board_id, group_id, limit = 25 } = context;
    
    if (!board_id) {
      return [];
    }

    const query = `
      query {
        boards(ids: [${board_id}]) {
          items(limit: ${limit}${group_id ? `, group_id: "${group_id}"` : ''}) {
            id
            name
            state
            group {
              id
              title
            }
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const items = response.data.boards[0]?.items || [];
    
    return items
      .filter(item => !searchTerm || item.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(item => ({
        title: item.name,
        value: item.id,
        description: `Item in ${item.group?.title || 'group'}`,
        metadata: {
          state: item.state,
          group_id: item.group?.id,
          group_title: item.group?.title
        }
      }));
  }

  /**
   * Get user options
   */
  async getUserOptions(context, accessToken, searchTerm) {
    const { limit = 50 } = context;

    const query = `
      query {
        users(limit: ${limit}) {
          id
          name
          email
          title
          photo_thumb
          is_admin
          is_guest
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const users = response.data.users || [];
    
    return users
      .filter(user => {
        if (!searchTerm) return true;
        const searchLower = searchTerm.toLowerCase();
        return user.name.toLowerCase().includes(searchLower) || 
               user.email.toLowerCase().includes(searchLower);
      })
      .map(user => ({
        title: user.name,
        value: user.id,
        description: user.email || user.title || 'User',
        metadata: {
          email: user.email,
          title: user.title,
          photo: user.photo_thumb,
          is_admin: user.is_admin,
          is_guest: user.is_guest
        }
      }));
  }

  /**
   * Get workspace options
   */
  async getWorkspaceOptions(context, accessToken, searchTerm) {
    const query = `
      query {
        workspaces {
          id
          name
          description
          state
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const workspaces = response.data.workspaces || [];
    
    return workspaces
      .filter(workspace => !searchTerm || workspace.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(workspace => ({
        title: workspace.name,
        value: workspace.id,
        description: workspace.description || 'Workspace',
        metadata: {
          state: workspace.state
        }
      }));
  }

  /**
   * Get team options
   */
  async getTeamOptions(context, accessToken, searchTerm) {
    const query = `
      query {
        teams {
          id
          name
          picture_url
          users {
            id
            name
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const teams = response.data.teams || [];
    
    return teams
      .filter(team => !searchTerm || team.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(team => ({
        title: team.name,
        value: team.id,
        description: `Team with ${team.users?.length || 0} members`,
        metadata: {
          picture_url: team.picture_url,
          member_count: team.users?.length || 0
        }
      }));
  }

  /**
   * Get tag options
   */
  async getTagOptions(context, accessToken, searchTerm) {
    const query = `
      query {
        tags {
          id
          name
          color
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const tags = response.data.tags || [];
    
    return tags
      .filter(tag => !searchTerm || tag.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(tag => ({
        title: tag.name,
        value: tag.id,
        description: 'Tag',
        metadata: {
          color: tag.color
        }
      }));
  }

  /**
   * Get status options for status columns
   */
  async getStatusOptions(context, accessToken, searchTerm) {
    const { board_id, column_id } = context;
    
    if (!board_id || !column_id) {
      return [];
    }

    const query = `
      query {
        boards(ids: [${board_id}]) {
          columns(ids: ["${column_id}"]) {
            settings_str
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const column = response.data.boards[0]?.columns[0];
    
    if (!column?.settings_str) {
      return [];
    }

    try {
      const settings = JSON.parse(column.settings_str);
      const labels = settings.labels || {};
      
      return Object.entries(labels)
        .filter(([index, label]) => !searchTerm || label.toLowerCase().includes(searchTerm.toLowerCase()))
        .map(([index, label]) => ({
          title: label,
          value: index,
          description: 'Status option',
          metadata: {
            index: parseInt(index)
          }
        }));
    } catch (error) {
      logger.error('Failed to parse status column settings', { error: error.message });
      return [];
    }
  }

  /**
   * Get priority options
   */
  async getPriorityOptions(context, accessToken, searchTerm) {
    const priorities = [
      { title: 'Critical', value: 'critical', color: '#ff0000' },
      { title: 'High', value: 'high', color: '#ff6b35' },
      { title: 'Medium', value: 'medium', color: '#ffcc02' },
      { title: 'Low', value: 'low', color: '#00c875' }
    ];

    return priorities
      .filter(priority => !searchTerm || priority.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(priority => ({
        title: priority.title,
        value: priority.value,
        description: `${priority.title} priority`,
        metadata: {
          color: priority.color
        }
      }));
  }

  /**
   * Get subscriber options for a board
   */
  async getSubscriberOptions(context, accessToken, searchTerm) {
    const { board_id } = context;
    
    if (!board_id) {
      return this.getUserOptions(context, accessToken, searchTerm);
    }

    const query = `
      query {
        boards(ids: [${board_id}]) {
          subscribers {
            id
            name
            email
            photo_thumb
          }
        }
      }
    `;

    const response = await mondayApi.execute(query, accessToken);
    const subscribers = response.data.boards[0]?.subscribers || [];
    
    return subscribers
      .filter(user => {
        if (!searchTerm) return true;
        const searchLower = searchTerm.toLowerCase();
        return user.name.toLowerCase().includes(searchLower) || 
               user.email.toLowerCase().includes(searchLower);
      })
      .map(user => ({
        title: user.name,
        value: user.id,
        description: user.email || 'Board subscriber',
        metadata: {
          email: user.email,
          photo: user.photo_thumb
        }
      }));
  }

  /**
   * Get board type options
   */
  async getBoardTypeOptions(context, accessToken, searchTerm) {
    const boardTypes = [
      { title: 'Public Board', value: 'public', description: 'Visible to all workspace members' },
      { title: 'Private Board', value: 'private', description: 'Visible only to board members' },
      { title: 'Shareable Board', value: 'share', description: 'Can be shared with external users' }
    ];

    return boardTypes
      .filter(type => !searchTerm || type.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(type => ({
        title: type.title,
        value: type.value,
        description: type.description
      }));
  }

  /**
   * Get column type options
   */
  async getColumnTypeOptions(context, accessToken, searchTerm) {
    const columnTypes = [
      { title: 'Text', value: 'text', description: 'Simple text input' },
      { title: 'Status', value: 'color', description: 'Status labels with colors' },
      { title: 'Person', value: 'multiple-person', description: 'Assign people' },
      { title: 'Date', value: 'date', description: 'Date picker' },
      { title: 'Timeline', value: 'timerange', description: 'Date range' },
      { title: 'Numbers', value: 'numeric', description: 'Numeric values' },
      { title: 'Checkbox', value: 'boolean', description: 'True/false checkbox' },
      { title: 'Dropdown', value: 'dropdown', description: 'Dropdown selection' },
      { title: 'Email', value: 'email', description: 'Email addresses' },
      { title: 'Phone', value: 'phone', description: 'Phone numbers' },
      { title: 'Link', value: 'link', description: 'URL links' },
      { title: 'Tags', value: 'tag', description: 'Multiple tags' },
      { title: 'Rating', value: 'rating', description: 'Star rating' },
      { title: 'Progress', value: 'progress', description: 'Progress tracking' },
      { title: 'File', value: 'file', description: 'File attachments' },
      { title: 'Location', value: 'location', description: 'Geographic location' },
      { title: 'Formula', value: 'formula', description: 'Calculated values' }
    ];

    return columnTypes
      .filter(type => !searchTerm || type.title.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(type => ({
        title: type.title,
        value: type.value,
        description: type.description
      }));
  }

  /**
   * Get available field types
   */
  getAvailableFieldTypes() {
    return Object.keys(this.optionProviders);
  }

  /**
   * Validate context for field type
   */
  validateContext(fieldType, context) {
    const requiredContext = {
      'groups': ['board_id'],
      'columns': ['board_id'],
      'items': ['board_id'],
      'statuses': ['board_id', 'column_id'],
      'subscribers': ['board_id']
    };

    const required = requiredContext[fieldType];
    if (!required) {
      return true; // No specific context required
    }

    const missing = required.filter(field => !context[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required context for ${fieldType}: ${missing.join(', ')}`);
    }

    return true;
  }
}

module.exports = new MondayRemoteOptionsHandler();