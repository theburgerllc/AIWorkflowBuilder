// nlp/prompt-templates/index.js

// Forward declarations - will be defined below
let BoardOperations, ItemOperations;

class PromptTemplateManager {
  constructor() {
    this.templates = {
      BOARD_CREATE: BoardOperations.createBoard,
      BOARD_UPDATE: BoardOperations.updateBoard,
      BOARD_DELETE: BoardOperations.deleteBoard,

      ITEM_CREATE: ItemOperations.createItem,
      ITEM_UPDATE: ItemOperations.updateItem,
      ITEM_DELETE: ItemOperations.deleteItem,

      STATUS_UPDATE: ItemOperations.updateStatus
    };
  }

  getPrompt(operationType, userInput, context) {
    const template = this.templates[operationType];
    if (!template) {
      throw new Error(`No prompt template found for operation: ${operationType}`);
    }

    return template(userInput, context);
  }

  getAllOperationTypes() {
    return Object.keys(this.templates);
  }
}

// nlp/prompt-templates/board-operations.js
BoardOperations = {
  createBoard: (userInput, context) => `
You are analyzing a Monday.com board creation request.

CONTEXT:
- Account: ${context.account?.name || 'Unknown'}
- Workspace: ${context.workspace?.name || 'Default'}
- Existing boards: ${context.boards?.map(b => b.name).join(', ') || 'None'}
- User permissions: ${JSON.stringify(context.permissions || {})}

USER REQUEST: "${userInput}"

BOARD CREATION ANALYSIS:
1. Extract the board name (required)
2. Determine board type (public/private/shareable)
3. Identify workspace (if specified)
4. Check for template requirements
5. Validate permissions

COMMON PATTERNS:
- "Create a [type] board called [name]"
- "Make a new board for [purpose]"
- "Set up a [name] board in [workspace]"

RESPONSE FORMAT (JSON):
{
  "operation": "BOARD_CREATE",
  "confidence": 0-100,
  "parameters": {
    "boardName": "extracted_board_name",
    "boardKind": "public|private|shareable",
    "workspaceId": "workspace_id_if_specified",
    "templateId": "template_id_if_specified",
    "description": "board_description_if_provided"
  },
  "missingInfo": ["list_of_missing_required_info"],
  "clarifyingQuestions": ["questions_to_ask_user"],
  "warnings": ["potential_issues"],
  "alternatives": []
}

Required: boardName
Optional: boardKind (default: public), workspaceId, templateId, description

Analyze and respond with JSON only:`,

  updateBoard: (userInput, context) => `
You are analyzing a Monday.com board update request.

CONTEXT:
- Current board: ${context.currentBoard?.name || 'Not specified'}
- Available boards: ${context.boards?.map(b => `${b.id}:${b.name}`).join(', ') || 'None'}
- User permissions: ${JSON.stringify(context.permissions || {})}

USER REQUEST: "${userInput}"

BOARD UPDATE ANALYSIS:
1. Identify target board (by name or context)
2. Extract update type (name, description, settings)
3. Extract new values
4. Validate permissions

UPDATE TYPES:
- Name change: "Rename board to [new_name]"
- Description: "Update description to [text]"
- Settings: "Make board [public/private]"

RESPONSE FORMAT (JSON):
{
  "operation": "BOARD_UPDATE",
  "confidence": 0-100,
  "parameters": {
    "boardId": "target_board_id",
    "boardName": "current_or_target_board_name",
    "updateType": "name|description|settings",
    "newValue": "new_value_to_set",
    "name": "new_name_if_renaming",
    "description": "new_description_if_updating"
  },
  "missingInfo": [],
  "clarifyingQuestions": [],
  "warnings": [],
  "alternatives": []
}

Analyze and respond with JSON only:`,

  deleteBoard: (userInput, context) => `
You are analyzing a Monday.com board deletion request.

CONTEXT:
- Available boards: ${context.boards?.map(b => `${b.id}:${b.name}`).join(', ') || 'None'}
- User permissions: ${JSON.stringify(context.permissions || {})}

USER REQUEST: "${userInput}"

⚠️  BOARD DELETION IS DESTRUCTIVE - REQUIRE HIGH CONFIDENCE ⚠️

DELETION ANALYSIS:
1. Identify target board clearly
2. Confirm deletion intent
3. Check for data preservation needs
4. Validate admin permissions

RESPONSE FORMAT (JSON):
{
  "operation": "BOARD_DELETE",
  "confidence": 0-100,
  "parameters": {
    "boardId": "target_board_id",
    "boardName": "board_name_to_delete",
    "confirmationRequired": true
  },
  "missingInfo": [],
  "clarifyingQuestions": [
    "Are you sure you want to permanently delete the '[board_name]' board?",
    "This action cannot be undone. Do you want to proceed?"
  ],
  "warnings": [
    "Board deletion is permanent and cannot be undone",
    "All items, columns, and data will be lost"
  ],
  "alternatives": [
    {
      "operation": "BOARD_ARCHIVE",
      "reason": "Archive instead of delete to preserve data"
    }
  ]
}

Set confidence to maximum 70 for deletion requests. Always require confirmation.

Analyze and respond with JSON only:`
};

// nlp/prompt-templates/item-operations.js
ItemOperations = {
  createItem: (userInput, context) => `
You are analyzing a Monday.com item creation request.

CONTEXT:
- Current board: ${context.currentBoard ? `${context.currentBoard.id}:${context.currentBoard.name}` : 'Not specified'}
- Board groups: ${context.currentBoard?.groups?.map(g => `${g.id}:${g.title}`).join(', ') || 'None'}
- Board columns: ${context.currentBoard?.columns?.map(c => `${c.id}:${c.title}(${c.type})`).join(', ') || 'None'}
- Available users: ${context.users?.map(u => `${u.id}:${u.name}`).join(', ') || 'None'}

USER REQUEST: "${userInput}"

ITEM CREATION ANALYSIS:
1. Extract item name (required)
2. Identify target board (from context or specification)
3. Determine target group
4. Extract column values (status, assignee, dates, etc.)
5. Handle column value formatting by type

COLUMN VALUE EXTRACTION:
- Text columns: Direct text extraction
- Status columns: Map to valid status values
- People columns: Map to user IDs
- Date columns: Parse date formats
- Number columns: Extract numeric values

RESPONSE FORMAT (JSON):
{
  "operation": "ITEM_CREATE",
  "confidence": 0-100,
  "parameters": {
    "itemName": "extracted_item_name",
    "boardId": "target_board_id",
    "boardName": "target_board_name",
    "groupId": "target_group_id_if_specified",
    "groupName": "target_group_name_if_specified",
    "columnValues": {
      "column_id": "formatted_value",
      "status": "status_value",
      "person": "user_id_or_name"
    }
  },
  "missingInfo": [],
  "clarifyingQuestions": [],
  "warnings": [],
  "alternatives": []
}

Required: itemName
Auto-detect: boardId (from context), columnValues (from text analysis)

Analyze and respond with JSON only:`,

  updateItem: (userInput, context) => `
You are analyzing a Monday.com item update request.

CONTEXT:
- Current board: ${context.currentBoard ? `${context.currentBoard.id}:${context.currentBoard.name}` : 'Not specified'}
- Board columns: ${context.currentBoard?.columns?.map(c => `${c.id}:${c.title}(${c.type})`).join(', ') || 'None'}
- Sample items: ${context.currentBoard?.sampleItems?.map(i => `${i.id}:${i.name}`).join(', ') || 'None'}
- Available users: ${context.users?.map(u => `${u.id}:${u.name}`).join(', ') || 'None'}

USER REQUEST: "${userInput}"

ITEM UPDATE ANALYSIS:
1. Identify target item (by name or ID)
2. Extract fields to update
3. Map values to column types
4. Validate update permissions

UPDATE PATTERNS:
- "Update [item] set [column] to [value]"
- "Change [item] [column] to [value]"
- "Set [item] [column] as [value]"

RESPONSE FORMAT (JSON):
{
  "operation": "ITEM_UPDATE",
  "confidence": 0-100,
  "parameters": {
    "itemId": "item_id_if_known",
    "itemName": "item_name_for_lookup",
    "boardId": "target_board_id",
    "columnValues": {
      "column_id": "new_value"
    },
    "updates": {
      "field_name": "new_value"
    }
  },
  "missingInfo": [],
  "clarifyingQuestions": [],
  "warnings": [],
  "alternatives": []
}

Analyze and respond with JSON only:`,

  updateStatus: (userInput, context) => `
You are analyzing a Monday.com status update request.

CONTEXT:
- Current board: ${context.currentBoard ? `${context.currentBoard.name}` : 'Not specified'}
- Status columns: ${context.currentBoard?.columns?.filter(c => c.type === 'color' || c.type === 'status').map(c => c.title).join(', ') || 'None'}
- Sample items: ${context.currentBoard?.sampleItems?.map(i => i.name).join(', ') || 'None'}

USER REQUEST: "${userInput}"

STATUS UPDATE ANALYSIS:
1. Identify target item(s)
2. Extract status value
3. Map to valid status options
4. Handle multiple status columns

COMMON STATUS VALUES:
- Done, Complete, Completed, Finished
- Working on it, In Progress, Started
- Stuck, Blocked, Issue
- To Do, Pending, Not Started

RESPONSE FORMAT (JSON):
{
  "operation": "STATUS_UPDATE",
  "confidence": 0-100,
  "parameters": {
    "itemId": "item_id_if_known",
    "itemName": "item_name_for_lookup",
    "statusValue": "mapped_status_value",
    "status": "mapped_status_value",
    "boardId": "board_id",
    "columnId": "status_column_id_if_known"
  },
  "missingInfo": [],
  "clarifyingQuestions": [],
  "warnings": [],
  "alternatives": []
}

Analyze and respond with JSON only:`,

  deleteItem: (userInput, context) => `
You are analyzing a Monday.com item deletion request.

CONTEXT:
- Current board: ${context.currentBoard ? `${context.currentBoard.name}` : 'Not specified'}
- Sample items: ${context.currentBoard?.sampleItems?.map(i => `${i.id}:${i.name}`).join(', ') || 'None'}

USER REQUEST: "${userInput}"

⚠️  ITEM DELETION IS DESTRUCTIVE ⚠️

DELETION ANALYSIS:
1. Identify target item(s) clearly
2. Confirm deletion intent
3. Check for bulk deletion patterns
4. Validate permissions

RESPONSE FORMAT (JSON):
{
  "operation": "ITEM_DELETE",
  "confidence": 0-100,
  "parameters": {
    "itemId": "item_id_if_known",
    "itemName": "item_name_for_lookup",
    "boardId": "board_id"
  },
  "missingInfo": [],
  "clarifyingQuestions": [
    "Are you sure you want to delete '[item_name]'?"
  ],
  "warnings": [
    "Item deletion cannot be undone"
  ],
  "alternatives": []
}

Set confidence to maximum 80 for deletion requests.

Analyze and respond with JSON only:`
};

// Export all templates
module.exports = {
  PromptTemplateManager,
  BoardOperations,
  ItemOperations
};