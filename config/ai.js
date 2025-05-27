// config/ai.js
const AI_CONFIG = {
  claude: {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4000,
    temperature: 0.1, // Low for consistent operation parsing
    maxRetries: 3,
    retryDelay: 1000, // Base delay in ms
    timeoutMs: 30000,

    // Token management
    maxPromptTokens: 15000,
    reserveTokensForResponse: 2000,
    contextCompressionThreshold: 10000,

    // Performance settings
    concurrentRequests: 5,
    rateLimitPerMinute: 50,
    cacheTTL: 300000, // 5 minutes
  },

  confidence: {
    // Confidence thresholds for different actions
    thresholds: {
      autoExecute: 90,     // Execute automatically
      requireConfirmation: 70, // Ask user to confirm
      requestClarification: 50, // Ask clarifying questions
      reject: 30           // Too ambiguous, reject
    },

    // Confidence calculation weights
    weights: {
      operationMatch: 0.4,
      parameterCompleteness: 0.3,
      contextRelevance: 0.2,
      syntaxClarity: 0.1
    }
  },

  operations: {
    // Supported operation types with complexity scores
    types: {
      ITEM_CREATE: { complexity: 3, requiredParams: ['boardId', 'itemName'] },
      ITEM_UPDATE: { complexity: 4, requiredParams: ['itemId', 'boardId'] },
      ITEM_DELETE: { complexity: 5, requiredParams: ['itemId', 'boardId'] },
      BOARD_CREATE: { complexity: 6, requiredParams: ['workspaceId', 'boardName'] },
      BOARD_UPDATE: { complexity: 4, requiredParams: ['boardId'] },
      COLUMN_CREATE: { complexity: 5, requiredParams: ['boardId', 'columnTitle', 'columnType'] },
      COLUMN_UPDATE: { complexity: 4, requiredParams: ['boardId', 'columnId'] },
      USER_ASSIGN: { complexity: 3, requiredParams: ['itemId', 'userId'] },
      STATUS_UPDATE: { complexity: 2, requiredParams: ['itemId', 'statusValue'] },
      AUTOMATION_CREATE: { complexity: 8, requiredParams: ['boardId', 'trigger', 'action'] },
      BULK_OPERATION: { complexity: 7, requiredParams: ['boardId', 'operation', 'criteria'] }
    },

    // Priority order for ambiguous operations
    priorityOrder: [
      'ITEM_CREATE',
      'STATUS_UPDATE',
      'USER_ASSIGN',
      'ITEM_UPDATE',
      'COLUMN_UPDATE',
      'BOARD_CREATE',
      'COLUMN_CREATE',
      'ITEM_DELETE',
      'BULK_OPERATION',
      'AUTOMATION_CREATE',
      'BOARD_UPDATE'
    ]
  },

  context: {
    // Context gathering settings
    maxBoardsToFetch: 10,
    maxItemsPerBoard: 100,
    maxUsersToFetch: 50,

    // Cache settings
    boardContextTTL: 600000,    // 10 minutes
    userContextTTL: 1800000,    // 30 minutes
    permissionsTTL: 300000,     // 5 minutes

    // Compression settings
    compressLargeBoards: true,
    maxColumnsInContext: 20,
    maxGroupsInContext: 10
  },

  prompts: {
    // Prompt template settings
    systemRole: 'expert Monday.com operations analyst',
    maxExamples: 3,
    includeContext: true,
    includePermissions: true,

    // Response format requirements
    requireJSON: true,
    validateSchema: true,
    includeConfidence: true,
    includeAlternatives: true
  },

  validation: {
    // Operation validation settings
    strictMode: true,
    checkPermissions: true,
    validateParameters: true,
    checkDataTypes: true,

    // Safety checks
    preventDestructiveOps: true,
    requireConfirmationFor: [
      'ITEM_DELETE',
      'BOARD_DELETE',
      'BULK_OPERATION'
    ],

    // Parameter validation
    maxItemNameLength: 255,
    maxBoardNameLength: 100,
    maxColumnNameLength: 50
  },

  performance: {
    // Performance targets
    targetResponseTime: 2000,   // 2 seconds
    maxResponseTime: 5000,      // 5 seconds

    // Monitoring
    logSlowRequests: true,
    slowRequestThreshold: 3000,
    logFailedRequests: true,

    // Optimization
    enableCaching: true,
    enableCompression: true,
    enableBatching: false, // Disable for now

    // Circuit breaker
    failureThreshold: 5,
    recoveryTimeout: 30000
  },

  errors: {
    // Error handling configuration
    retryableErrors: [
      'RATE_LIMIT_EXCEEDED',
      'TEMPORARY_UNAVAILABLE',
      'TIMEOUT'
    ],

    // Error messages
    messages: {
      PARSE_ERROR: 'Unable to understand your request. Please try rephrasing.',
      LOW_CONFIDENCE: 'Your request is ambiguous. Please provide more details.',
      MISSING_PARAMS: 'Some required information is missing.',
      PERMISSION_DENIED: 'You don\'t have permission to perform this action.',
      VALIDATION_FAILED: 'The requested operation contains invalid parameters.',
      SERVICE_UNAVAILABLE: 'AI service is temporarily unavailable. Please try again.'
    }
  },

  debugging: {
    // Debug settings
    logPrompts: process.env.NODE_ENV === 'development',
    logResponses: process.env.NODE_ENV === 'development',
    logTokenUsage: true,
    logPerformance: true,

    // Test mode
    enableTestMode: process.env.NODE_ENV === 'test',
    mockResponses: process.env.NODE_ENV === 'test'
  }
};

// Environment-specific overrides
if (process.env.NODE_ENV === 'production') {
  AI_CONFIG.claude.maxRetries = 5;
  AI_CONFIG.claude.timeoutMs = 45000;
  AI_CONFIG.performance.targetResponseTime = 1500;
  AI_CONFIG.debugging.logPrompts = false;
  AI_CONFIG.debugging.logResponses = false;
}

if (process.env.NODE_ENV === 'development') {
  AI_CONFIG.claude.temperature = 0.2; // Slightly higher for testing
  AI_CONFIG.confidence.thresholds.autoExecute = 80; // Lower for testing
}

module.exports = AI_CONFIG;