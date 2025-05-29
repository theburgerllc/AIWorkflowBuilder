// Test setup file
require('dotenv').config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock Monday.com SDK to prevent worker threads
jest.mock('@mondaycom/apps-sdk', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue({ success: true, value: null }),
    set: jest.fn().mockResolvedValue({ success: true }),
    delete: jest.fn().mockResolvedValue({ success: true }),
    search: jest.fn().mockResolvedValue({ success: true, records: [] })
  })),
  SecureStorage: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined)
  })),
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

// Mock external services for testing
jest.mock('../services/claude', () => {
  return jest.fn().mockImplementation(() => ({
    processUserRequest: jest.fn().mockResolvedValue({
      success: true,
      operations: [
        {
          type: 'create_item',
          parameters: {
            boardId: '123',
            itemName: 'Test Item',
            columnValues: {}
          }
        }
      ],
      summary: 'Created test automation',
      confidence: 0.95
    }),
    isHealthy: jest.fn().mockResolvedValue(true)
  }));
});

jest.mock('../services/operation-executor', () => {
  return jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      itemId: '789',
      message: 'Operation completed successfully'
    }),
    isHealthy: jest.fn().mockResolvedValue(true)
  }));
});

jest.mock('../services/validation', () => {
  return jest.fn().mockImplementation(() => ({
    validateOperations: jest.fn().mockResolvedValue({
      isValid: true,
      errors: []
    }),
    isHealthy: jest.fn().mockResolvedValue(true)
  }));
});

jest.mock('../services/context', () => {
  return jest.fn().mockImplementation(() => ({
    gatherContext: jest.fn().mockResolvedValue({
      accountId: '101112',
      boardId: '123',
      userId: '789',
      boardInfo: {
        name: 'Test Board',
        columns: []
      },
      userInfo: {
        name: 'Test User',
        email: 'test@example.com'
      }
    }),
    isHealthy: jest.fn().mockResolvedValue(true)
  }));
});

// Global test utilities
global.testUtils = {
  createMondaySignature: (body, secret = process.env.MONDAY_SIGNING_SECRET) => {
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
  },

  createValidMondayPayload: (overrides = {}) => ({
    payload: {
      inputFields: {
        user_input: 'Create a new task'
      },
      boardId: '123',
      itemId: '456',
      userId: '789',
      accountId: '101112',
      recipe: { name: 'AI Automation Builder' },
      ...overrides
    }
  }),

  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Increase timeout for integration tests
jest.setTimeout(30000);

// Suppress console logs during tests unless debugging
if (!process.env.DEBUG_TESTS) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}
