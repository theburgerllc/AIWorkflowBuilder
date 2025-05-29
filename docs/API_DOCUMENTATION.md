# API Documentation

## Overview
Complete API reference for the AI Workflow Builder Monday.com app.

## Base URL
```
Production: https://aiworkflowbuilder-production.up.railway.app
Development: http://localhost:8080
```

## Authentication
All Monday.com endpoints require webhook signature verification using `MONDAY_SIGNING_SECRET`.

## Endpoints

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "environment": "production",
  "uptime": 3600,
  "memory": {
    "rss": 50331648,
    "heapTotal": 20971520,
    "heapUsed": 15728640
  },
  "services": {
    "monday": {
      "status": "up",
      "responseTime": "150ms"
    },
    "claude": {
      "status": "up",
      "responseTime": "<1ms"
    }
  }
}
```

### Monday.com Execute Action
```http
POST /monday/execute_action
```

**Headers:**
- `x-monday-signature`: HMAC SHA256 signature
- `Content-Type`: application/json

**Request Body:**
```json
{
  "payload": {
    "inputFields": {
      "user_input": "Create a task when status changes to Done",
      "target_board": "123456789",
      "automation_type": "status_change"
    },
    "boardId": "123456789",
    "itemId": "987654321",
    "userId": "111222333",
    "accountId": "444555666",
    "recipe": {
      "name": "AI Automation Builder"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "automationId": "auto_123456",
  "summary": "Created automation: When status changes to Done, create follow-up task",
  "operations": [
    {
      "type": "create_item",
      "parameters": {
        "boardId": "123456789",
        "itemName": "Follow-up Task",
        "columnValues": {
          "status": "Working on it"
        }
      }
    }
  ],
  "confidence": 0.95
}
```

### Monday.com Remote Options
```http
POST /monday/get_remote_list_options
```

**Headers:**
- `x-monday-signature`: HMAC SHA256 signature
- `Content-Type`: application/json

**Request Body:**
```json
{
  "payload": {
    "boardId": "123456789",
    "itemId": "987654321",
    "userId": "111222333",
    "accountId": "444555666"
  }
}
```

**Response:**
```json
{
  "options": [
    {
      "title": "Status Change Automation",
      "value": "status_change"
    },
    {
      "title": "Date-based Automation",
      "value": "date_based"
    },
    {
      "title": "Notification Automation",
      "value": "notification"
    }
  ]
}
```

### AI Analysis
```http
POST /api/ai/analyze-request
```

**Headers:**
- `Content-Type`: application/json
- `Authorization`: Bearer token (if required)

**Request Body:**
```json
{
  "userInput": "When a task is marked complete, send notification to team",
  "context": {
    "boardId": "123456789",
    "userId": "111222333",
    "accountId": "444555666"
  }
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "intent": "create_automation",
    "trigger": "status_change",
    "action": "send_notification",
    "confidence": 0.92
  },
  "operations": [
    {
      "type": "create_automation",
      "parameters": {
        "trigger": {
          "type": "status_change",
          "columnId": "status",
          "value": "Done"
        },
        "action": {
          "type": "notification",
          "message": "Task completed",
          "recipients": ["team"]
        }
      }
    }
  ]
}
```

### Webhooks
```http
POST /webhooks/monday
```

**Headers:**
- `x-monday-signature`: HMAC SHA256 signature
- `Content-Type`: application/json

**Request Body:**
```json
{
  "event": {
    "type": "create_item",
    "data": {
      "boardId": "123456789",
      "itemId": "987654321",
      "userId": "111222333"
    }
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid request format",
  "code": "INVALID_REQUEST",
  "details": "Missing required field: user_input"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid signature",
  "code": "UNAUTHORIZED"
}
```

### 429 Too Many Requests
```json
{
  "error": "Too many requests from this IP, please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "code": "INTERNAL_ERROR",
  "requestId": "req_123456789"
}
```

## Rate Limiting
- 100 requests per minute per IP/account
- 1000 requests per hour per IP/account
- Rate limits are enforced on `/api/` and `/monday/` endpoints

## Response Times
- Health check: < 5 seconds
- API endpoints: < 2 seconds
- Webhook processing: < 1 second

## Monitoring
- Response time metrics: `/metrics/response-time`
- Health status: `/health`
- Error tracking via application logs
