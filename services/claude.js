// services/claude-service.js
const Anthropic = require('@anthropic-ai/sdk');
const { Logger } = require('@mondaycom/apps-sdk');

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.logger = new Logger('claude-service');
    this.model = 'claude-3-5-sonnet-20241022';
    this.maxTokens = 4000;
    this.temperature = 0.1; // Low temperature for consistent operations
    this.maxRetries = 3;
  }

  /**
   * Analyze user input and extract Monday.com operations
   * @param {string} userInput - Natural language request
   * @param {Object} context - Monday.com context (boards, users, etc.)
   * @returns {Promise<Object>} - Parsed operation with confidence
   */
  async analyzeOperation(userInput, context) {
    try {
      const prompt = this._buildOperationPrompt(userInput, context);

      this.logger.info('Analyzing operation', {
        inputLength: userInput.length,
        contextKeys: Object.keys(context)
      });

      const response = await this._callClaude(prompt);
      const parsedResponse = this._parseResponse(response);

      this.logger.info('Operation analyzed', {
        operation: parsedResponse.operation,
        confidence: parsedResponse.confidence
      });

      return parsedResponse;
    } catch (error) {
      this.logger.error('Failed to analyze operation', { error: error.message });
      throw new Error(`Claude analysis failed: ${error.message}`);
    }
  }

  /**
   * Validate proposed operation parameters
   * @param {Object} operation - Parsed operation object
   * @param {Object} context - Monday.com context
   * @returns {Promise<Object>} - Validation result
   */
  async validateOperation(operation, context) {
    try {
      const prompt = this._buildValidationPrompt(operation, context);
      const response = await this._callClaude(prompt);
      return this._parseValidationResponse(response);
    } catch (error) {
      this.logger.error('Failed to validate operation', { error: error.message });
      throw new Error(`Operation validation failed: ${error.message}`);
    }
  }

  /**
   * Generate suggestions for ambiguous requests
   * @param {string} userInput - Original user input
   * @param {Object} context - Monday.com context
   * @returns {Promise<Array>} - Array of suggested operations
   */
  async generateSuggestions(userInput, context) {
    try {
      const prompt = this._buildSuggestionPrompt(userInput, context);
      const response = await this._callClaude(prompt);
      return this._parseSuggestions(response);
    } catch (error) {
      this.logger.error('Failed to generate suggestions', { error: error.message });
      return [];
    }
  }

  /**
   * Build the main operation analysis prompt
   * @private
   */
  _buildOperationPrompt(userInput, context) {
    const contextSummary = this._compressContext(context);

    return `You are an expert Monday.com operations analyst. Your job is to interpret natural language requests and convert them into structured Monday.com API operations.

CONTEXT INFORMATION:
${contextSummary}

USER REQUEST: "${userInput}"

OPERATION TYPES SUPPORTED:
1. ITEM_CREATE - Create new items/tasks
2. ITEM_UPDATE - Update existing items
3. ITEM_DELETE - Delete items
4. BOARD_CREATE - Create new boards
5. BOARD_UPDATE - Update board settings
6. COLUMN_CREATE - Add new columns
7. COLUMN_UPDATE - Modify column values
8. USER_ASSIGN - Assign users to items
9. STATUS_UPDATE - Change item status
10. AUTOMATION_CREATE - Create board automations
11. BULK_OPERATION - Mass updates/changes

ANALYSIS REQUIREMENTS:
- Identify the primary operation type
- Extract all parameters needed for Monday.com API
- Calculate confidence score (0-100)
- Identify any missing information
- Suggest clarifying questions if needed

RESPONSE FORMAT (JSON):
{
  "operation": "OPERATION_TYPE",
  "confidence": 85,
  "parameters": {
    "boardId": "board_id_here",
    "itemName": "extracted_name",
    "columnValues": {},
    "groupId": "group_id"
  },
  "missingInfo": ["required_but_missing_parameters"],
  "clarifyingQuestions": ["questions_for_user"],
  "warnings": ["potential_issues"],
  "alternatives": [{"operation": "ALT_TYPE", "reason": "why_this_alternative"}]
}

Analyze the request and respond with valid JSON only:`;
  }

  /**
   * Build validation prompt for proposed operations
   * @private
   */
  _buildValidationPrompt(operation, context) {
    return `You are validating a Monday.com operation for execution safety and correctness.

CONTEXT: ${this._compressContext(context)}

PROPOSED OPERATION:
${JSON.stringify(operation, null, 2)}

VALIDATION CHECKLIST:
1. Are all required parameters present?
2. Do parameter values match Monday.com constraints?
3. Does user have necessary permissions?
4. Are there any potential data conflicts?
5. Could this operation cause unintended side effects?

RESPONSE FORMAT (JSON):
{
  "valid": true/false,
  "errors": ["list_of_errors"],
  "warnings": ["list_of_warnings"],
  "suggestions": ["improvement_suggestions"],
  "confidence": 0-100
}

Validate the operation and respond with JSON only:`;
  }

  /**
   * Build suggestion prompt for ambiguous requests
   * @private
   */
  _buildSuggestionPrompt(userInput, context) {
    return `Generate alternative interpretations for an ambiguous Monday.com request.

CONTEXT: ${this._compressContext(context)}
USER INPUT: "${userInput}"

Generate 3-5 possible interpretations, each with:
- Operation type
- Required parameters
- Confidence level
- Brief explanation

RESPONSE FORMAT (JSON):
{
  "suggestions": [
    {
      "operation": "OPERATION_TYPE",
      "parameters": {},
      "confidence": 75,
      "explanation": "brief_explanation"
    }
  ]
}

Generate suggestions in JSON format:`;
  }

  /**
   * Make API call to Claude with retry logic
   * @private
   */
  async _callClaude(prompt, retryCount = 0) {
    try {
      const message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: [{ role: 'user', content: prompt }]
      });

      if (!message.content || message.content.length === 0) {
        throw new Error('Empty response from Claude');
      }

      return message.content[0].text;
    } catch (error) {
      if (retryCount < this.maxRetries) {
        this.logger.warn(`Claude API call failed, retrying (${retryCount + 1}/${this.maxRetries})`, {
          error: error.message
        });
        await this._delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
        return this._callClaude(prompt, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Parse Claude response into structured format
   * @private
   */
  _parseResponse(response) {
    try {
      // Extract JSON from response (Claude sometimes includes extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.operation || typeof parsed.confidence !== 'number') {
        throw new Error('Invalid response format from Claude');
      }

      // Ensure confidence is within bounds
      parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));

      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse Claude response', {
        error: error.message,
        response: response.substring(0, 500)
      });

      // Return default low-confidence response
      return {
        operation: 'UNKNOWN',
        confidence: 0,
        parameters: {},
        missingInfo: ['Unable to parse request'],
        clarifyingQuestions: ['Could you please rephrase your request?'],
        warnings: ['Failed to interpret request'],
        alternatives: []
      };
    }
  }

  /**
   * Parse validation response
   * @private
   */
  _parseValidationResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { valid: false, errors: ['Invalid validation response'] };
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      return { valid: false, errors: ['Failed to parse validation response'] };
    }
  }

  /**
   * Parse suggestions response
   * @private
   */
  _parseSuggestions(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.suggestions || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Compress context for token efficiency
   * @private
   */
  _compressContext(context) {
    const compressed = {
      boards: context.boards?.map(b => ({
        id: b.id,
        name: b.name,
        groups: b.groups?.map(g => ({ id: g.id, title: g.title })),
        columns: b.columns?.map(c => ({ id: c.id, title: c.title, type: c.type }))
      })) || [],
      users: context.users?.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email
      })) || [],
      currentBoard: context.currentBoard || null,
      permissions: context.permissions || {}
    };

    return JSON.stringify(compressed, null, 2);
  }

  /**
   * Utility delay function
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get token count estimate for prompt
   */
  estimateTokens(text) {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Process user request and return operations (required by executeAction controller)
   * @param {string} userInput - Natural language request
   * @param {Object} context - Monday.com context
   * @returns {Promise<Object>} - Processing result with operations
   */
  async processUserRequest(userInput, context) {
    try {
      const analysis = await this.analyzeOperation(userInput, context);

      // Convert single operation to operations array format expected by controller
      const operations = [{
        type: analysis.operation,
        parameters: analysis.parameters || {},
        confidence: analysis.confidence
      }];

      return {
        success: true,
        operations: operations,
        confidence: analysis.confidence,
        summary: `Processed request: ${userInput}`,
        warnings: analysis.warnings || [],
        missingInfo: analysis.missingInfo || []
      };
    } catch (error) {
      this.logger.error('Failed to process user request', { error: error.message });
      return {
        success: false,
        error: error.message,
        operations: [],
        confidence: 0
      };
    }
  }

  /**
   * Check if service is healthy (required by executeAction controller)
   */
  async isHealthy() {
    try {
      const response = await this._callClaude('Respond with "OK" if you can process this message.');
      return response.includes('OK');
    } catch (error) {
      return false;
    }
  }

  /**
   * Health check for Claude service
   */
  async healthCheck() {
    return this.isHealthy();
  }
}

module.exports = ClaudeService;