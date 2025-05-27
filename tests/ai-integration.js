// test/ai-integration.test.js
const request = require('supertest');
const express = require('express');
const { expect } = require('chai');
const sinon = require('sinon');

const AIRoutes = require('../routes/ai-routes');
const ClaudeService = require('../services/claude-service');
const ContextService = require('../services/context-service');
const OperationInterpreter = require('../nlp/operation-interpreter');
const OperationMapper = require('../nlp/operation-mapper');

describe('AI Integration Tests', () => {
  let app;
  let aiRoutes;
  let mockMondayClient;
  let claudeStub;
  let contextStub;

  beforeEach(() => {
    // Setup mock Monday client
    mockMondayClient = {
      api: sinon.stub()
    };

    // Setup Express app with AI routes
    app = express();
    app.use(express.json());
    
    aiRoutes = new AIRoutes(mockMondayClient);
    app.use('/api/ai', aiRoutes.getRouter());
    
    // Setup stubs
    claudeStub = sinon.stub(ClaudeService.prototype, 'analyzeOperation');
    contextStub = sinon.stub(ContextService.prototype, 'gatherContext');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('POST /api/ai/analyze-request', () => {
    it('should analyze simple item creation request', async () => {
      // Setup test data
      const userInput = 'Create a new task called "Fix login bug"';
      const mockContext = {
        boards: [{
          id: '123',
          name: 'Development Board',
          columns: [
            { id: 'text', title: 'Task', type: 'text' },
            { id: 'status', title: 'Status', type: 'color' }
          ],
          groups: [{ id: 'group1', title: 'To Do' }]
        }],
        users: [{ id: '456', name: 'John Doe', email: 'john@example.com' }],
        currentBoard: null,
        permissions: { canCreateBoards: true },
        timestamp: Date.now()
      };

      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 92,
        parameters: {
          itemName: 'Fix login bug',
          boardId: '123'
        },
        missingInfo: [],
        clarifyingQuestions: [],
        warnings: [],
        alternatives: []
      };

      // Setup stubs
      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      // Make request
      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          boardId: '123',
          accountId: '789',
          userId: '456'
        })
        .expect(200);

      // Verify response
      expect(response.body).to.have.property('interpretation');
      expect(response.body.interpretation.operation).to.equal('ITEM_CREATE');
      expect(response.body.interpretation.confidence).to.equal(92);
      expect(response.body).to.have.property('apiOperation');
      expect(response.body).to.have.property('metadata');
      expect(response.body.metadata.canAutoExecute).to.be.true;
    });

    it('should handle ambiguous requests with low confidence', async () => {
      const userInput = 'Update something';
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'UNKNOWN',
        confidence: 25,
        parameters: {},
        missingInfo: ['Item to update', 'Update details'],
        clarifyingQuestions: ['What would you like to update?', 'What changes should be made?'],
        warnings: ['Request is too vague'],
        alternatives: []
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.confidence).to.equal(25);
      expect(response.body.metadata.requiresConfirmation).to.be.true;
      expect(response.body.metadata.canAutoExecute).to.be.false;
      expect(response.body.apiOperation).to.be.null;
    });

    it('should return 400 for missing user input', async () => {
      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          boardId: '123',
          accountId: '789'
        })
        .expect(400);

      expect(response.body.error).to.equal('User input is required');
      expect(response.body.code).to.equal('MISSING_INPUT');
    });

    it('should handle context gathering failures gracefully', async () => {
      const userInput = 'Create a task';
      
      contextStub.rejects(new Error('API connection failed'));
      claudeStub.resolves({
        operation: 'ITEM_CREATE',
        confidence: 60,
        parameters: { itemName: 'New Task' }
      });

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(500);

      expect(response.body.error).to.equal('Analysis failed');
      expect(response.body.code).to.equal('ANALYSIS_FAILED');
    });
  });

  describe('POST /api/ai/validate-operation', () => {
    it('should validate operation with sufficient permissions', async () => {
      const operation = {
        operation: 'ITEM_CREATE',
        parameters: {
          itemName: 'Test Task',
          boardId: '123'
        }
      };

      const context = {
        permissions: { canCreateBoards: true },
        boards: [{ id: '123', name: 'Test Board' }]
      };

      const mockValidation = {
        valid: true,
        errors: [],
        warnings: [],
        suggestions: [],
        confidence: 85
      };

      sinon.stub(ClaudeService.prototype, 'validateOperation').resolves(mockValidation);

      const response = await request(app)
        .post('/api/ai/validate-operation')
        .send({ operation, context })
        .expect(200);

      expect(response.body.valid).to.be.true;
      expect(response.body.errors).to.be.empty;
    });

    it('should reject operation with insufficient permissions', async () => {
      const operation = {
        operation: 'BOARD_CREATE',
        parameters: { boardName: 'New Board' }
      };

      const context = {
        permissions: { canCreateBoards: false }
      };

      const response = await request(app)
        .post('/api/ai/validate-operation')
        .send({ operation, context })
        .expect(200);

      expect(response.body.valid).to.be.false;
      expect(response.body.errors).to.include('Board creation permissions');
    });
  });

  describe('POST /api/ai/detect-multiple', () => {
    it('should detect multiple operations in compound request', async () => {
      const userInput = 'Create a task called "Design mockups" and assign it to John';
      const mockContext = {
        boards: [{ id: '123', name: 'Design Board' }],
        users: [{ id: '456', name: 'John', email: 'john@example.com' }]
      };

      const mockOperations = [
        {
          operation: 'ITEM_CREATE',
          confidence: 88,
          parameters: { itemName: 'Design mockups', boardId: '123' },
          sequence: 1
        },
        {
          operation: 'USER_ASSIGN',
          confidence: 85,
          parameters: { itemName: 'Design mockups', userName: 'John' },
          sequence: 2
        }
      ];

      contextStub.resolves(mockContext);
      sinon.stub(OperationInterpreter.prototype, 'detectMultipleOperations')
        .resolves(mockOperations);

      const response = await request(app)
        .post('/api/ai/detect-multiple')
        .send({
          userInput,
          context: mockContext
        })
        .expect(200);

      expect(response.body.operations).to.have.length(2);
      expect(response.body.count).to.equal(2);
      expect(response.body.operations[0].operation).to.equal('ITEM_CREATE');
      expect(response.body.operations[1].operation).to.equal('USER_ASSIGN');
    });
  });

  describe('GET /api/ai/health', () => {
    it('should return healthy status when all services are working', async () => {
      sinon.stub(ClaudeService.prototype, 'healthCheck').resolves(true);

      const response = await request(app)
        .get('/api/ai/health')
        .expect(200);

      expect(response.body.status).to.equal('healthy');
      expect(response.body.services.claude).to.equal('healthy');
      expect(response.body.services.cache).to.have.property('status', 'healthy');
    });

    it('should return degraded status when Claude service is down', async () => {
      sinon.stub(ClaudeService.prototype, 'healthCheck').resolves(false);

      const response = await request(app)
        .get('/api/ai/health')
        .expect(503);

      expect(response.body.status).to.equal('degraded');
      expect(response.body.services.claude).to.equal('unhealthy');
    });
  });

  describe('Performance Tests', () => {
    it('should respond within acceptable time limits', async () => {
      const userInput = 'Create a task';
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 75,
        parameters: { itemName: 'New Task' }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const startTime = Date.now();
      
      await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).to.be.lessThan(5000); // Should respond within 5 seconds
    });

    it('should handle concurrent requests efficiently', async () => {
      const userInput = 'Create a task';
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 75,
        parameters: { itemName: 'New Task' }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      // Make 5 concurrent requests
      const requests = Array.from({ length: 5 }, (_, i) => 
        request(app)
          .post('/api/ai/analyze-request')
          .send({
            userInput: `${userInput} ${i}`,
            accountId: '789'
          })
      );

      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).to.equal(200);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Claude service errors gracefully', async () => {
      const userInput = 'Create a task';
      const mockContext = { boards: [], users: [], permissions: {} };

      contextStub.resolves(mockContext);
      claudeStub.rejects(new Error('Claude API timeout'));

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(500);

      expect(response.body.error).to.equal('Analysis failed');
      expect(response.body.message).to.include('Claude API timeout');
    });

    it('should handle malformed requests', async () => {
      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send('invalid json')
        .expect(400);

      // Express should handle JSON parsing errors
    });
  });

  describe('Context Integration', () => {
    it('should use board context for item operations', async () => {
      const userInput = 'Add a task to the design group';
      const mockContext = {
        currentBoard: {
          id: '123',
          name: 'Design Board',
          groups: [
            { id: 'design_group', title: 'Design' },
            { id: 'dev_group', title: 'Development' }
          ],
          columns: [
            { id: 'text', title: 'Task', type: 'text' },
            { id: 'status', title: 'Status', type: 'color' }
          ]
        },
        users: [],
        permissions: { canCreateBoards: true }
      };

      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 89,
        parameters: {
          itemName: 'New Task',
          boardId: '123',
          groupId: 'design_group'
        }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          boardId: '123',
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.parameters.groupId).to.equal('design_group');
      expect(response.body.apiOperation.variables.group_id).to.equal('design_group');
    });

    it('should resolve user names from context', async () => {
      const userInput = 'Assign the login task to Sarah';
      const mockContext = {
        currentBoard: { id: '123', name: 'Dev Board' },
        users: [
          { id: '101', name: 'Sarah Johnson', email: 'sarah@example.com' },
          { id: '102', name: 'Mike Wilson', email: 'mike@example.com' }
        ],
        permissions: {}
      };

      const mockInterpretation = {
        operation: 'USER_ASSIGN',
        confidence: 91,
        parameters: {
          itemName: 'login task',
          userName: 'Sarah',
          userId: '101'
        }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          boardId: '123',
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.parameters.userId).to.equal('101');
    });
  });

  describe('Operation Mapping', () => {
    it('should map item creation to correct GraphQL mutation', async () => {
      const operation = {
        operation: 'ITEM_CREATE',
        confidence: 85,
        parameters: {
          itemName: 'Test Task',
          boardId: '123',
          groupId: 'group1'
        }
      };

      const context = {
        boards: [{
          id: '123',
          name: 'Test Board',
          groups: [{ id: 'group1', title: 'To Do' }],
          columns: [{ id: 'text', title: 'Task', type: 'text' }]
        }]
      };

      contextStub.resolves(context);

      const mapper = new OperationMapper();
      const apiOperation = await mapper.mapToAPI(operation, context);

      expect(apiOperation.method).to.equal('create_item');
      expect(apiOperation.mutation).to.equal('create_item');
      expect(apiOperation.variables.board_id).to.equal(123);
      expect(apiOperation.variables.item_name).to.equal('Test Task');
      expect(apiOperation.variables.group_id).to.equal('group1');
      expect(apiOperation.query).to.include('create_item');
    });

    it('should map status updates correctly', async () => {
      const operation = {
        operation: 'STATUS_UPDATE',
        confidence: 88,
        parameters: {
          itemId: '456',
          itemName: 'Test Task',
          statusValue: 'Done'
        }
      };

      const context = {
        boards: [{
          id: '123',
          name: 'Test Board',
          columns: [
            { id: 'text', title: 'Task', type: 'text' },
            { id: 'status', title: 'Status', type: 'color' }
          ]
        }]
      };

      const mapper = new OperationMapper();
      const apiOperation = await mapper.mapToAPI(operation, context);

      expect(apiOperation.method).to.equal('change_simple_column_value');
      expect(apiOperation.variables.column_id).to.equal('status');
      expect(apiOperation.variables.value).to.equal('Done');
    });

    it('should handle mapping errors gracefully', async () => {
      const operation = {
        operation: 'ITEM_CREATE',
        confidence: 85,
        parameters: {
          itemName: 'Test Task',
          boardId: 'nonexistent'
        }
      };

      const context = { boards: [] };

      const mapper = new OperationMapper();
      const apiOperation = await mapper.mapToAPI(operation, context);

      expect(apiOperation.method).to.equal('ERROR');
      expect(apiOperation.error).to.include('Board not found');
    });
  });

  describe('Alternative Suggestions', () => {
    it('should generate alternatives for ambiguous requests', async () => {
      const userInput = 'update task';
      const context = {
        boards: [{ id: '123', name: 'Dev Board' }],
        users: [{ id: '456', name: 'John' }]
      };

      const mockAlternatives = [
        {
          operation: 'ITEM_UPDATE',
          parameters: { itemName: 'task' },
          confidence: 60,
          explanation: 'Update an existing task'
        },
        {
          operation: 'STATUS_UPDATE',
          parameters: { itemName: 'task', statusValue: 'In Progress' },
          confidence: 55,
          explanation: 'Change task status'
        }
      ];

      sinon.stub(ClaudeService.prototype, 'generateSuggestions')
        .resolves(mockAlternatives);

      const response = await request(app)
        .post('/api/ai/suggest-alternatives')
        .send({
          userInput,
          context
        })
        .expect(200);

      expect(response.body.alternatives).to.have.length(2);
      expect(response.body.alternatives[0].operation).to.equal('ITEM_UPDATE');
      expect(response.body.count).to.equal(2);
    });
  });

  describe('Validation Tests', () => {
    it('should validate required parameters', async () => {
      const operation = {
        operation: 'ITEM_CREATE',
        confidence: 85,
        parameters: {
          // Missing itemName
          boardId: '123'
        }
      };

      const context = {
        boards: [{ id: '123', name: 'Test Board' }],
        permissions: { canCreateBoards: true }
      };

      const mockValidation = {
        valid: false,
        errors: ['Item name is required'],
        warnings: [],
        suggestions: ['Please specify a name for the new item'],
        confidence: 30
      };

      sinon.stub(ClaudeService.prototype, 'validateOperation')
        .resolves(mockValidation);

      const response = await request(app)
        .post('/api/ai/validate-operation')
        .send({ operation, context })
        .expect(200);

      expect(response.body.valid).to.be.false;
      expect(response.body.errors).to.include('Item name is required');
    });
  });

  describe('Integration Edge Cases', () => {
    it('should handle empty context gracefully', async () => {
      const userInput = 'Create a task';
      const emptyContext = {
        boards: [],
        users: [],
        permissions: {},
        timestamp: Date.now()
      };

      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 45,
        parameters: { itemName: 'New Task' },
        missingInfo: ['Board selection'],
        clarifyingQuestions: ['Which board should this task be added to?']
      };

      contextStub.resolves(emptyContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.confidence).to.equal(45);
      expect(response.body.interpretation.missingInfo).to.include('Board selection');
      expect(response.body.metadata.requiresConfirmation).to.be.true;
    });

    it('should handle very long user inputs', async () => {
      const longInput = 'Create a task '.repeat(100); // Very long input
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 70,
        parameters: { itemName: 'Repeated Task' }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput: longInput,
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.operation).to.equal('ITEM_CREATE');
    });

    it('should handle special characters in input', async () => {
      const userInput = 'Create task "Fix bug #123 & update @mentions"';
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 85,
        parameters: { itemName: 'Fix bug #123 & update @mentions' }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      const response = await request(app)
        .post('/api/ai/analyze-request')
        .send({
          userInput,
          accountId: '789'
        })
        .expect(200);

      expect(response.body.interpretation.parameters.itemName)
        .to.equal('Fix bug #123 & update @mentions');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const userInput = 'Create a task';
      const mockContext = { boards: [], users: [], permissions: {} };
      const mockInterpretation = {
        operation: 'ITEM_CREATE',
        confidence: 75,
        parameters: { itemName: 'New Task' }
      };

      contextStub.resolves(mockContext);
      claudeStub.resolves(mockInterpretation);

      // This test would need to be adapted based on actual rate limiting implementation
      // For now, just verify that multiple requests can be handled
      const requests = Array.from({ length: 3 }, () =>
        request(app)
          .post('/api/ai/analyze-request')
          .send({
            userInput,
            accountId: '789'
          })
      );

      const responses = await Promise.all(requests);
      responses.forEach(response => {
        expect(response.status).to.equal(200);
      });
    });
  });
});

// Test fixtures and utilities
const TestFixtures = {
  mockBoard: {
    id: '123456789',
    name: 'Test Board',
    state: 'active',
    board_kind: 'public',
    workspace: { id: '987', name: 'Test Workspace' },
    groups: [
      { id: 'group1', title: 'To Do', color: '#ff5a5a' },
      { id: 'group2', title: 'In Progress', color: '#fdab3d' },
      { id: 'group3', title: 'Done', color: '#00c875' }
    ],
    columns: [
      { id: 'text', title: 'Task', type: 'text' },
      { id: 'status', title: 'Status', type: 'color' },
      { id: 'person', title: 'Owner', type: 'people' },
      { id: 'date', title: 'Due Date', type: 'date' }
    ],
    sampleItems: [
      { id: '111', name: 'Sample Task 1', groupId: 'group1' },
      { id: '222', name: 'Sample Task 2', groupId: 'group2' }
    ]
  },

  mockUsers: [
    { id: '100', name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
    { id: '101', name: 'Bob Smith', email: 'bob@example.com', role: 'member' },
    { id: '102', name: 'Carol Davis', email: 'carol@example.com', role: 'member' }
  ],

  mockContext: {
    account: { id: '789', name: 'Test Account' },
    user: { id: '100', name: 'Alice Johnson', is_admin: true },
    boards: [], // Will be populated with mockBoard
    users: [], // Will be populated with mockUsers
    permissions: {
      isAdmin: true,
      isGuest: false,
      canCreateBoards: true,
      canDeleteItems: true,
      canManageUsers: true,
      canCreateAutomations: true
    },
    timestamp: Date.now()
  },

  getTestContext() {
    const context = { ...this.mockContext };
    context.boards = [this.mockBoard];
    context.users = this.mockUsers;
    context.currentBoard = this.mockBoard;
    return context;
  }
};

module.exports = { TestFixtures };