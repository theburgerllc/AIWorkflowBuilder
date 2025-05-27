// routes/webhooks.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Logger } = require('@mondaycom/apps-sdk');
const { mondayConfig } = require('../config/monday');
const { logger } = require('../utils/logger');

// Import services
const OperationExecutor = require('../services/operation-executor');
const ContextService = require('../services/context');

// Initialize services
const operationExecutor = new OperationExecutor();
const contextService = new ContextService();

/**
 * Verify Monday.com webhook signature
 */
function verifyWebhookSignature(req, res, next) {
  try {
    const signature = req.get('authorization');
    const body = JSON.stringify(req.body);
    
    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    // Monday.com sends signature as "Bearer <signature>"
    const receivedSignature = signature.replace('Bearer ', '');
    
    // Calculate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', mondayConfig.signingSecret)
      .update(body)
      .digest('hex');

    if (receivedSignature !== expectedSignature) {
      logger.warn('Invalid webhook signature', {
        received: receivedSignature.substring(0, 10) + '...',
        expected: expectedSignature.substring(0, 10) + '...'
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (error) {
    logger.error('Webhook signature verification failed', { error: error.message });
    res.status(500).json({ error: 'Signature verification failed' });
  }
}

/**
 * Monday.com webhook endpoint
 * POST /webhooks/monday
 */
router.post('/monday', verifyWebhookSignature, async (req, res) => {
  try {
    const { event, data } = req.body;
    
    logger.info('Webhook received', {
      event: event?.type,
      boardId: data?.board_id,
      itemId: data?.item_id,
      userId: data?.user_id
    });

    // Process different webhook events
    switch (event?.type) {
      case 'create_item':
        await handleItemCreated(data);
        break;
      
      case 'change_column_value':
        await handleColumnValueChanged(data);
        break;
      
      case 'create_update':
        await handleUpdateCreated(data);
        break;
      
      case 'archive_item':
        await handleItemArchived(data);
        break;
      
      case 'delete_item':
        await handleItemDeleted(data);
        break;
      
      default:
        logger.info('Unhandled webhook event', { eventType: event?.type });
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed',
      eventType: event?.type
    });

  } catch (error) {
    logger.error('Webhook processing failed', {
      error: error.message,
      event: req.body.event?.type
    });

    // Still return 200 to prevent Monday.com from retrying
    res.status(200).json({ 
      success: false, 
      error: 'Processing failed',
      message: error.message
    });
  }
});

/**
 * Handle item created webhook
 */
async function handleItemCreated(data) {
  try {
    logger.info('Processing item created', {
      itemId: data.item_id,
      boardId: data.board_id
    });

    // Refresh context cache for the board
    await contextService.refreshBoardContext(data.board_id);
    
    // Check if there are any automation triggers for new items
    // This would be expanded in Phase 2 with AI automation logic
    
  } catch (error) {
    logger.error('Failed to handle item created', { error: error.message });
  }
}

/**
 * Handle column value changed webhook
 */
async function handleColumnValueChanged(data) {
  try {
    logger.info('Processing column value changed', {
      itemId: data.item_id,
      boardId: data.board_id,
      columnId: data.column_id
    });

    // Check for automation triggers based on column changes
    // This would be expanded in Phase 2 with AI automation logic
    
  } catch (error) {
    logger.error('Failed to handle column value changed', { error: error.message });
  }
}

/**
 * Handle update created webhook
 */
async function handleUpdateCreated(data) {
  try {
    logger.info('Processing update created', {
      updateId: data.update_id,
      itemId: data.item_id,
      boardId: data.board_id
    });

    // Check if the update contains AI commands or mentions
    // This would be expanded in Phase 2 with natural language processing
    
  } catch (error) {
    logger.error('Failed to handle update created', { error: error.message });
  }
}

/**
 * Handle item archived webhook
 */
async function handleItemArchived(data) {
  try {
    logger.info('Processing item archived', {
      itemId: data.item_id,
      boardId: data.board_id
    });

    // Clean up any related automation states
    // Refresh context cache
    await contextService.refreshBoardContext(data.board_id);
    
  } catch (error) {
    logger.error('Failed to handle item archived', { error: error.message });
  }
}

/**
 * Handle item deleted webhook
 */
async function handleItemDeleted(data) {
  try {
    logger.info('Processing item deleted', {
      itemId: data.item_id,
      boardId: data.board_id
    });

    // Clean up any related automation states
    // Refresh context cache
    await contextService.refreshBoardContext(data.board_id);
    
  } catch (error) {
    logger.error('Failed to handle item deleted', { error: error.message });
  }
}

/**
 * Webhook health check
 * GET /webhooks/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    webhookEndpoint: '/webhooks/monday'
  });
});

/**
 * Test webhook endpoint (development only)
 * POST /webhooks/test
 */
if (process.env.NODE_ENV === 'development') {
  router.post('/test', (req, res) => {
    logger.info('Test webhook received', { body: req.body });
    res.json({ 
      success: true, 
      message: 'Test webhook received',
      timestamp: new Date().toISOString()
    });
  });
}

module.exports = router;
