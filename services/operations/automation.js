// operations/automation-operations.js
import { mondayClient } from '../config/monday-client.js';
import { logOperation, logError } from '../utils/logger.js';

class AutomationOperations {
  constructor() {
    this.client = mondayClient;
    
    // Map NLP intents to Monday automation templates
    this.automationTemplates = {
      // Status change automations
      'status_change_notification': {
        trigger: 'status_changes_to_something',
        action: 'send_notification',
        description: 'Notify when status changes'
      },
      'status_change_move': {
        trigger: 'status_changes_to_something',
        action: 'move_item_to_group',
        description: 'Move item when status changes'
      },
      'status_change_assign': {
        trigger: 'status_changes_to_something',
        action: 'assign_person',
        description: 'Assign person when status changes'
      },
      
      // Date automations
      'due_date_reminder': {
        trigger: 'every_time_period',
        action: 'send_notification',
        condition: 'date_arrives',
        description: 'Send reminder before due date'
      },
      'overdue_notification': {
        trigger: 'date_passed',
        action: 'send_notification',
        description: 'Notify when date is overdue'
      },
      
      // Item creation automations
      'new_item_assign': {
        trigger: 'item_created',
        action: 'assign_person',
        description: 'Auto-assign new items'
      },
      'new_item_status': {
        trigger: 'item_created',
        action: 'change_status_column_value',
        description: 'Set default status for new items'
      },
      
      // Recurring automations
      'recurring_task': {
        trigger: 'every_time_period',
        action: 'create_item',
        description: 'Create recurring tasks'
      },
      
      // Cross-board automations
      'sync_status': {
        trigger: 'status_changes_to_something',
        action: 'change_another_status_column_value',
        description: 'Sync status between boards'
      },
      'mirror_updates': {
        trigger: 'column_changes',
        action: 'change_column_value',
        description: 'Mirror column changes'
      }
    };
  }

  /**
   * Create an automation from structured data
   * @param {string} boardId - Board ID
   * @param {object} trigger - Trigger configuration
   * @param {array} actions - Array of action configurations
   * @param {string} name - Automation name
   * @returns {object} Created automation details
   */
  async createAutomation(boardId, trigger, actions, name) {
    try {
      if (!boardId || !trigger || !actions || !name) {
        throw new Error('Board ID, trigger, actions, and name are required');
      }

      // Build automation recipe
      const recipe = this.buildRecipe(trigger, actions);
      
      const mutation = `
        mutation CreateAutomation($boardId: ID!, $automationName: String!, $recipe: String!) {
          create_automation(
            board_id: $boardId,
            automation_name: $automationName,
            automation_recipe: $recipe
          ) {
            id
            name
            recipe
            enabled
            created_at
          }
        }
      `;

      const variables = {
        boardId,
        automationName: name,
        recipe
      };

      const result = await this.client.request(mutation, variables);
      
      logOperation('createAutomation', {
        boardId,
        automationId: result.data.create_automation.id,
        name,
        success: true
      });

      return {
        success: true,
        automation: result.data.create_automation,
        operation: 'create_automation'
      };

    } catch (error) {
      logError('createAutomation', error, { boardId, name });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'create_automation'
      };
    }
  }

  /**
   * Map natural language to automation configuration
   * @param {object} nlpInterpretation - NLP analysis result
   * @returns {object} Automation configuration
   */
  async mapNLPToAutomation(nlpInterpretation) {
    try {
      const { intent, entities, confidence } = nlpInterpretation;
      
      // Find matching template
      const template = this.findBestTemplate(intent, entities);
      
      if (!template) {
        return {
          success: false,
          error: 'Could not map request to an automation template',
          suggestions: this.getSuggestions(intent)
        };
      }

      // Build trigger configuration
      const trigger = this.buildTriggerConfig(template.trigger, entities);
      
      // Build action configuration
      const actions = this.buildActionConfig(template.action, entities);
      
      // Generate automation name
      const name = this.generateAutomationName(template, entities);

      return {
        success: true,
        automation: {
          trigger,
          actions,
          name,
          template: template.description,
          confidence
        },
        operation: 'map_nlp_to_automation'
      };

    } catch (error) {
      logError('mapNLPToAutomation', error, { nlpInterpretation });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'map_nlp_to_automation'
      };
    }
  }

  /**
   * Validate an automation recipe before creation
   * @param {object} recipe - Automation recipe to validate
   * @returns {object} Validation result
   */
  async validateAutomationRecipe(recipe) {
    try {
      const issues = [];
      
      // Validate trigger
      if (!recipe.trigger) {
        issues.push('Missing trigger configuration');
      } else {
        const triggerIssues = this.validateTrigger(recipe.trigger);
        issues.push(...triggerIssues);
      }
      
      // Validate actions
      if (!recipe.actions || recipe.actions.length === 0) {
        issues.push('At least one action is required');
      } else {
        recipe.actions.forEach((action, index) => {
          const actionIssues = this.validateAction(action);
          issues.push(...actionIssues.map(issue => `Action ${index + 1}: ${issue}`));
        });
      }
      
      // Check for logical conflicts
      const conflicts = this.checkForConflicts(recipe);
      issues.push(...conflicts);

      return {
        success: issues.length === 0,
        valid: issues.length === 0,
        issues,
        operation: 'validate_automation'
      };

    } catch (error) {
      logError('validateAutomationRecipe', error, { recipe });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'validate_automation'
      };
    }
  }

  /**
   * Test an automation with sample data
   * @param {string} automationId - Automation ID to test
   * @param {object} testData - Test data for the automation
   * @returns {object} Test results
   */
  async testAutomation(automationId, testData) {
    try {
      if (!automationId) {
        throw new Error('Automation ID is required');
      }

      // Get automation details
      const automation = await this.getAutomation(automationId);
      
      if (!automation) {
        throw new Error('Automation not found');
      }

      // Simulate trigger
      const triggerResult = this.simulateTrigger(automation.trigger, testData);
      
      // Simulate actions
      const actionResults = [];
      for (const action of automation.actions) {
        const actionResult = this.simulateAction(action, testData);
        actionResults.push(actionResult);
      }

      const allPassed = triggerResult.passed && 
                       actionResults.every(r => r.passed);

      logOperation('testAutomation', {
        automationId,
        testPassed: allPassed,
        success: true
      });

      return {
        success: true,
        testPassed: allPassed,
        triggerResult,
        actionResults,
        operation: 'test_automation'
      };

    } catch (error) {
      logError('testAutomation', error, { automationId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'test_automation'
      };
    }
  }

  /**
   * Get existing automations for a board
   * @param {string} boardId - Board ID
   * @returns {object} List of automations
   */
  async getBoardAutomations(boardId) {
    try {
      const query = `
        query GetBoardAutomations($boardId: ID!) {
          boards(ids: [$boardId]) {
            id
            name
            automations {
              id
              name
              recipe
              enabled
              created_at
            }
          }
        }
      `;

      const result = await this.client.request(query, { boardId });
      const automations = result.data.boards[0]?.automations || [];

      return {
        success: true,
        automations,
        count: automations.length,
        operation: 'get_board_automations'
      };

    } catch (error) {
      logError('getBoardAutomations', error, { boardId });
      return {
        success: false,
        error: this.formatError(error),
        operation: 'get_board_automations'
      };
    }
  }

  /**
   * Helper method to find best matching template
   * @private
   */
  findBestTemplate(intent, entities) {
    // Match based on intent keywords
    const intentKeywords = intent.toLowerCase().split(/\s+/);
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const [key, template] of Object.entries(this.automationTemplates)) {
      let score = 0;
      
      // Check if template keywords match intent
      const templateKeywords = key.split('_');
      templateKeywords.forEach(keyword => {
        if (intentKeywords.includes(keyword)) {
          score += 2;
        }
      });
      
      // Check description match
      const descWords = template.description.toLowerCase().split(/\s+/);
      intentKeywords.forEach(word => {
        if (descWords.includes(word)) {
          score += 1;
        }
      });
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }
    
    return bestScore > 2 ? bestMatch : null;
  }

  /**
   * Build trigger configuration from template and entities
   * @private
   */
  buildTriggerConfig(triggerType, entities) {
    const config = {
      type: triggerType,
      params: {}
    };

    switch (triggerType) {
      case 'status_changes_to_something':
        config.params.statusColumnId = entities.columnId || 'status';
        config.params.statusLabel = entities.statusValue || 'Done';
        break;
        
      case 'every_time_period':
        config.params.period = entities.period || 'day';
        config.params.time = entities.time || '09:00';
        break;
        
      case 'date_passed':
        config.params.dateColumnId = entities.dateColumn || 'date';
        config.params.daysOffset = entities.daysBefore || 0;
        break;
        
      case 'item_created':
        config.params.groupId = entities.groupId || null;
        break;
    }

    return config;
  }

  /**
   * Build action configuration from template and entities
   * @private
   */
  buildActionConfig(actionType, entities) {
    const config = {
      type: actionType,
      params: {}
    };

    switch (actionType) {
      case 'send_notification':
        config.params.message = entities.message || 'Task update';
        config.params.userId = entities.userId || 'assigned';
        break;
        
      case 'move_item_to_group':
        config.params.groupId = entities.targetGroup || 'new_group';
        break;
        
      case 'assign_person':
        config.params.userId = entities.assignTo || null;
        config.params.columnId = entities.peopleColumn || 'person';
        break;
        
      case 'change_status_column_value':
        config.params.statusColumnId = entities.statusColumn || 'status';
        config.params.statusLabel = entities.newStatus || 'Working on it';
        break;
    }

    return [config]; // Return as array for multiple actions support
  }

  /**
   * Generate a descriptive automation name
   * @private
   */
  generateAutomationName(template, entities) {
    let name = template.description;
    
    // Customize based on entities
    if (entities.statusValue) {
      name = name.replace('status changes', `status changes to ${entities.statusValue}`);
    }
    if (entities.groupName) {
      name = name.replace('to group', `to ${entities.groupName}`);
    }
    
    return name;
  }

  /**
   * Build recipe string for Monday API
   * @private
   */
  buildRecipe(trigger, actions) {
    const triggerRecipe = this.buildTriggerRecipe(trigger);
    const actionRecipes = actions.map(a => this.buildActionRecipe(a));
    
    return `${triggerRecipe} ${actionRecipes.join(' and ')}`;
  }

  /**
   * Validate trigger configuration
   * @private
   */
  validateTrigger(trigger) {
    const issues = [];
    
    if (!trigger.type) {
      issues.push('Trigger type is required');
    }
    
    // Validate required params based on trigger type
    switch (trigger.type) {
      case 'status_changes_to_something':
        if (!trigger.params?.statusLabel) {
          issues.push('Status value is required for status change trigger');
        }
        break;
        
      case 'every_time_period':
        if (!trigger.params?.period) {
          issues.push('Period is required for recurring trigger');
        }
        break;
    }
    
    return issues;
  }

  /**
   * Validate action configuration
   * @private
   */
  validateAction(action) {
    const issues = [];
    
    if (!action.type) {
      issues.push('Action type is required');
    }
    
    // Validate required params based on action type
    switch (action.type) {
      case 'move_item_to_group':
        if (!action.params?.groupId) {
          issues.push('Target group is required for move action');
        }
        break;
        
      case 'assign_person':
        if (!action.params?.userId) {
          issues.push('User ID is required for assign action');
        }
        break;
    }
    
    return issues;
  }

  /**
   * Check for logical conflicts in automation
   * @private
   */
  checkForConflicts(recipe) {
    const conflicts = [];
    
    // Check for infinite loops
    if (recipe.trigger.type === 'status_changes_to_something' &&
        recipe.actions.some(a => a.type === 'change_status_column_value')) {
      if (recipe.trigger.params.statusLabel === recipe.actions[0].params.statusLabel) {
        conflicts.push('This automation could create an infinite loop');
      }
    }
    
    return conflicts;
  }

  /**
   * Get suggestions for failed mapping
   * @private
   */
  getSuggestions(intent) {
    const suggestions = [];
    
    // Analyze intent and suggest similar automations
    const keywords = intent.toLowerCase().split(/\s+/);
    
    if (keywords.includes('notify') || keywords.includes('alert')) {
      suggestions.push('Create notification when status changes');
      suggestions.push('Send reminder before due date');
    }
    
    if (keywords.includes('move') || keywords.includes('organize')) {
      suggestions.push('Move items when status changes');
      suggestions.push('Organize items by completion status');
    }
    
    if (keywords.includes('assign') || keywords.includes('delegate')) {
      suggestions.push('Auto-assign new items to team members');
      suggestions.push('Reassign tasks when status changes');
    }
    
    return suggestions;
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

export default new AutomationOperations();