// nlp/operation-interpreter.js
const ClaudeService = require('../services/claude-service');
const AI_CONFIG = require('../config/ai-settings');
const { Logger } = require('@mondaycom/apps-sdk');

class OperationInterpreter {
  constructor() {
    this.claudeService = new ClaudeService();
    this.logger = new Logger('operation-interpreter');
    this.operationPatterns = this._initializePatterns();
    this.confidenceCalculator = new ConfidenceCalculator();
  }

  /**
   * Main interpretation pipeline
   * @param {string} userInput - Natural language request
   * @param {Object} context - Monday.com context
   * @returns {Promise<Object>} - Interpreted operation with confidence
   */
  async interpret(userInput, context) {
    try {
      this.logger.info('Starting interpretation', { 
        inputLength: userInput.length,
        hasContext: !!context 
      });

      // Step 1: Quick pattern matching for common operations
      const quickMatch = this._quickPatternMatch(userInput);
      
      // Step 2: Claude AI analysis for complex interpretation
      const aiAnalysis = await this.claudeService.analyzeOperation(userInput, context);
      
      // Step 3: Combine and validate results
      const combinedResult = this._combineAnalysis(quickMatch, aiAnalysis, context);
      
      // Step 4: Calculate final confidence score
      combinedResult.confidence = this.confidenceCalculator.calculate(
        combinedResult, userInput, context
      );

      // Step 5: Generate alternatives if confidence is low
      if (combinedResult.confidence < AI_CONFIG.confidence.thresholds.requireConfirmation) {
        combinedResult.alternatives = await this._generateAlternatives(userInput, context);
      }

      this.logger.info('Interpretation complete', {
        operation: combinedResult.operation,
        confidence: combinedResult.confidence,
        hasAlternatives: combinedResult.alternatives?.length > 0
      });

      return combinedResult;
    } catch (error) {
      this.logger.error('Interpretation failed', { error: error.message });
      return this._createErrorResponse(error);
    }
  }

  /**
   * Detect multiple operations in single request
   * @param {string} userInput - Natural language request
   * @param {Object} context - Monday.com context
   * @returns {Promise<Array>} - Array of detected operations
   */
  async detectMultipleOperations(userInput, context) {
    try {
      // Look for operation separators
      const separators = [' and ', ' then ', ', ', ' also ', ' plus '];
      let hasMultiple = separators.some(sep => userInput.toLowerCase().includes(sep));
      
      if (!hasMultiple) {
        // Single operation
        const result = await this.interpret(userInput, context);
        return [result];
      }

      // Multiple operations detected
      const segments = this._segmentInput(userInput, separators);
      const operations = [];

      for (const segment of segments) {
        const operation = await this.interpret(segment.trim(), context);
        operation.sequence = operations.length + 1;
        operations.push(operation);
      }

      return operations;
    } catch (error) {
      this.logger.error('Multi-operation detection failed', { error: error.message });
      return [this._createErrorResponse(error)];
    }
  }

  /**
   * Resolve ambiguous operations with user clarification
   * @param {Object} ambiguousOperation - Operation needing clarification
   * @param {Object} userResponse - User's clarification response
   * @param {Object} context - Monday.com context
   * @returns {Promise<Object>} - Resolved operation
   */
  async resolveAmbiguity(ambiguousOperation, userResponse, context) {
    try {
      const combinedInput = `
        Original request: "${ambiguousOperation.originalInput}"
        User clarification: "${userResponse}"
        Previous interpretation: ${JSON.stringify(ambiguousOperation.parameters)}
      `;

      const resolved = await this.claudeService.analyzeOperation(combinedInput, context);
      
      // Boost confidence since user provided clarification
      resolved.confidence = Math.min(100, resolved.confidence + 15);
      
      this.logger.info('Ambiguity resolved', {
        originalConfidence: ambiguousOperation.confidence,
        resolvedConfidence: resolved.confidence
      });

      return resolved;
    } catch (error) {
      this.logger.error('Ambiguity resolution failed', { error: error.message });
      return ambiguousOperation; // Return original if resolution fails
    }
  }

  /**
   * Quick pattern matching for common operations
   * @private
   */
  _quickPatternMatch(userInput) {
    const input = userInput.toLowerCase().trim();
    const result = {
      operation: null,
      confidence: 0,
      parameters: {},
      method: 'pattern-match'
    };

    // Check each pattern
    for (const [operation, patterns] of Object.entries(this.operationPatterns)) {
      for (const pattern of patterns) {
        const match = input.match(pattern.regex);
        if (match) {
          result.operation = operation;
          result.confidence = pattern.confidence;
          result.parameters = this._extractParametersFromMatch(match, pattern.params);
          result.patternUsed = pattern.description;
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Initialize operation patterns for quick matching
   * @private
   */
  _initializePatterns() {
    return {
      ITEM_CREATE: [
        {
          regex: /create\s+(?:a\s+)?(?:new\s+)?(?:item|task|row)\s+(?:called|named)?\s*["']?([^"']+)["']?/,
          confidence: 85,
          params: ['itemName'],
          description: 'Create item with name'
        },
        {
          regex: /add\s+(?:a\s+)?(?:new\s+)?(?:item|task|row)\s+["']?([^"']+)["']?/,
          confidence: 80,
          params: ['itemName'],
          description: 'Add new item'
        },
        {
          regex: /new\s+(?:item|task|row):\s*["']?([^"']+)["']?/,
          confidence: 90,
          params: ['itemName'],
          description: 'New item with colon syntax'
        }
      ],
      
      STATUS_UPDATE: [
        {
          regex: /(?:set|change|update)\s+(?:the\s+)?status\s+(?:of\s+)?(?:item\s+)?["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/,
          confidence: 90,
          params: ['itemName', 'statusValue'],
          description: 'Change status of specific item'
        },
        {
          regex: /mark\s+["']?([^"']+)["']?\s+as\s+["']?([^"']+)["']?/,
          confidence: 85,
          params: ['itemName', 'statusValue'],
          description: 'Mark item as status'
        }
      ],

      USER_ASSIGN: [
        {
          regex: /assign\s+["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/,
          confidence: 88,
          params: ['itemName', 'userName'],
          description: 'Assign item to user'
        },
        {
          regex: /give\s+["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/,
          confidence: 75,
          params: ['itemName', 'userName'],
          description: 'Give item to user'
        }
      ],

      BOARD_CREATE: [
        {
          regex: /create\s+(?:a\s+)?(?:new\s+)?board\s+(?:called|named)?\s*["']?([^"']+)["']?/,
          confidence: 90,
          params: ['boardName'],
          description: 'Create new board'
        }
      ],

      COLUMN_CREATE: [
        {
          regex: /add\s+(?:a\s+)?(?:new\s+)?column\s+(?:called|named)?\s*["']?([^"']+)["']?/,
          confidence: 85,
          params: ['columnTitle'],
          description: 'Add new column'
        }
      ],

      ITEM_DELETE: [
        {
          regex: /delete\s+(?:the\s+)?(?:item|task|row)\s+["']?([^"']+)["']?/,
          confidence: 85,
          params: ['itemName'],
          description: 'Delete specific item'
        },
        {
          regex: /remove\s+["']?([^"']+)["']?/,
          confidence: 70,
          params: ['itemName'],
          description: 'Remove item'
        }
      ]
    };
  }

  /**
   * Extract parameters from regex match
   * @private
   */
  _extractParametersFromMatch(match, paramNames) {
    const parameters = {};
    paramNames.forEach((paramName, index) => {
      if (match[index + 1]) {
        parameters[paramName] = match[index + 1].trim();
      }
    });
    return parameters;
  }

  /**
   * Combine quick match and AI analysis
   * @private
   */
  _combineAnalysis(quickMatch, aiAnalysis, context) {
    // If quick match has high confidence, use it as base
    if (quickMatch.confidence >= 80) {
      return {
        ...aiAnalysis,
        operation: quickMatch.operation,
        parameters: { ...aiAnalysis.parameters, ...quickMatch.parameters },
        confidence: Math.max(quickMatch.confidence, aiAnalysis.confidence),
        methods: ['pattern-match', 'ai-analysis'],
        patternUsed: quickMatch.patternUsed
      };
    }

    // Otherwise, use AI analysis as primary
    return {
      ...aiAnalysis,
      methods: ['ai-analysis'],
      quickMatchAttempted: quickMatch.operation || 'none'
    };
  }

  /**
   * Generate alternative interpretations
   * @private
   */
  async _generateAlternatives(userInput, context) {
    try {
      const alternatives = await this.claudeService.generateSuggestions(userInput, context);
      return alternatives.slice(0, 3); // Limit to top 3 alternatives
    } catch (error) {
      this.logger.warn('Failed to generate alternatives', { error: error.message });
      return [];
    }
  }

  /**
   * Segment input for multiple operations
   * @private
   */
  _segmentInput(input, separators) {
    let segments = [input];
    
    for (const separator of separators) {
      const newSegments = [];
      for (const segment of segments) {
        newSegments.push(...segment.split(separator));
      }
      segments = newSegments;
    }
    
    return segments.filter(s => s.trim().length > 0);
  }

  /**
   * Create error response
   * @private
   */
  _createErrorResponse(error) {
    return {
      operation: 'ERROR',
      confidence: 0,
      parameters: {},
      error: error.message,
      missingInfo: [],
      clarifyingQuestions: ['Could you please rephrase your request?'],
      warnings: ['Failed to interpret request'],
      alternatives: []
    };
  }
}

/**
 * Confidence calculation system
 */
class ConfidenceCalculator {
  calculate(operation, userInput, context) {
    const weights = AI_CONFIG.confidence.weights;
    let score = 0;

    // Operation match confidence (40%)
    const operationScore = this._calculateOperationScore(operation);
    score += operationScore * weights.operationMatch;

    // Parameter completeness (30%)
    const parameterScore = this._calculateParameterScore(operation);
    score += parameterScore * weights.parameterCompleteness;

    // Context relevance (20%)
    const contextScore = this._calculateContextScore(operation, context);
    score += contextScore * weights.contextRelevance;

    // Input clarity (10%)
    const clarityScore = this._calculateClarityScore(userInput);
    score += clarityScore * weights.syntaxClarity;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  _calculateOperationScore(operation) {
    if (!operation.operation || operation.operation === 'UNKNOWN') return 0;
    
    const baseScore = operation.confidence || 50;
    
    // Boost for pattern matches
    if (operation.patternUsed) {
      return Math.min(100, baseScore + 10);
    }
    
    return baseScore;
  }

  _calculateParameterScore(operation) {
    if (!operation.parameters) return 0;
    
    const requiredParams = AI_CONFIG.operations.types[operation.operation]?.requiredParams || [];
    const providedParams = Object.keys(operation.parameters).filter(key => 
      operation.parameters[key] !== null && operation.parameters[key] !== undefined
    );
    
    if (requiredParams.length === 0) return 100;
    
    const completeness = providedParams.length / requiredParams.length;
    return Math.round(completeness * 100);
  }

  _calculateContextScore(operation, context) {
    if (!context) return 50;
    
    let score = 70; // Base score for having context
    
    // Check context relevance to operation
    switch (operation.operation) {
      case 'ITEM_CREATE':
      case 'ITEM_UPDATE':
        if (context.currentBoard) score += 20;
        if (context.currentBoard?.columns) score += 10;
        break;
        
      case 'USER_ASSIGN':
        if (context.users && context.users.length > 0) score += 30;
        break;
        
      case 'BOARD_CREATE':
        if (context.permissions?.canCreateBoards) score += 30;
        break;
    }
    
    return Math.min(100, score);
  }

  _calculateClarityScore(userInput) {
    if (!userInput) return 0;
    
    let score = 50; // Base score
    
    // Check for clear intent markers
    const intentMarkers = ['create', 'add', 'update', 'delete', 'assign', 'change', 'set'];
    if (intentMarkers.some(marker => userInput.toLowerCase().includes(marker))) {
      score += 20;
    }
    
    // Check for specific names/values in quotes
    if (userInput.includes('"') || userInput.includes("'")) {
      score += 15;
    }
    
    // Penalize very short or very long inputs
    if (userInput.length < 10) score -= 20;
    if (userInput.length > 200) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }
}

module.exports = OperationInterpreter;