// frontend/src/services/api-client.js
import axios from 'axios';
import toast from 'react-hot-toast';

class ApiClient {
  constructor() {
    this.baseURL = process.env.REACT_APP_API_URL || '/api';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Request queue for rate limiting
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.requestDelay = 200; // ms between requests

    // Add request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add auth token if available
        const token = localStorage.getItem('monday_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 429) {
          // Rate limit hit - add to queue
          return this.handleRateLimit(error.config);
        }
        return Promise.reject(this.formatError(error));
      }
    );
  }

  /**
   * Analyze user request with AI
   */
  async analyzeRequest(data) {
    try {
      const response = await this.client.post('/analyze', data);
      return response.data;
    } catch (error) {
      console.error('Analysis error:', error);
      throw error;
    }
  }

  /**
   * Execute Monday.com operation
   */
  async executeOperation(operation) {
    try {
      const response = await this.client.post('/execute', {
        operation,
        timestamp: new Date().toISOString()
      });
      return response.data;
    } catch (error) {
      console.error('Execution error:', error);
      throw error;
    }
  }

  /**
   * Undo a previous operation
   */
  async undoOperation(data) {
    try {
      const response = await this.client.post('/undo', data);
      return response.data;
    } catch (error) {
      console.error('Undo error:', error);
      throw error;
    }
  }

  /**
   * Get operation suggestions based on context
   */
  async getSuggestions(context) {
    try {
      const response = await this.client.post('/suggestions', context);
      return response.data;
    } catch (error) {
      console.error('Suggestions error:', error);
      return { suggestions: [] };
    }
  }

  /**
   * Validate operation before execution
   */
  async validateOperation(operation) {
    try {
      const response = await this.client.post('/validate', operation);
      return response.data;
    } catch (error) {
      console.error('Validation error:', error);
      throw error;
    }
  }

  /**
   * Get board context and metadata
   */
  async getBoardContext(boardId) {
    try {
      const response = await this.client.get(`/context/board/${boardId}`);
      return response.data;
    } catch (error) {
      console.error('Context error:', error);
      throw error;
    }
  }

  /**
   * Batch operations for efficiency
   */
  async batchOperations(operations) {
    try {
      const response = await this.client.post('/batch', {
        operations,
        atomic: true // All or nothing execution
      });
      return response.data;
    } catch (error) {
      console.error('Batch error:', error);
      throw error;
    }
  }

  /**
   * Get operation history
   */
  async getOperationHistory(filters = {}) {
    try {
      const response = await this.client.get('/history', { params: filters });
      return response.data;
    } catch (error) {
      console.error('History error:', error);
      return { history: [] };
    }
  }

  /**
   * Handle rate limiting with queue
   */
  async handleRateLimit(config) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ config, resolve, reject });
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests
   */
  async processQueue() {
    if (this.requestQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    this.isProcessingQueue = true;
    const { config, resolve, reject } = this.requestQueue.shift();

    try {
      await this.delay(this.requestDelay);
      const response = await this.client.request(config);
      resolve(response);
    } catch (error) {
      reject(error);
    }

    // Process next request
    this.processQueue();
  }

  /**
   * Format error for display
   */
  formatError(error) {
    if (error.response?.data?.message) {
      return new Error(error.response.data.message);
    }
    if (error.response?.status === 429) {
      return new Error('Too many requests. Please wait a moment.');
    }
    if (error.response?.status === 401) {
      return new Error('Authentication required. Please log in again.');
    }
    if (error.response?.status >= 500) {
      return new Error('Server error. Please try again later.');
    }
    return error;
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cancel all pending requests
   */
  cancelPendingRequests() {
    this.requestQueue = [];
  }
}

// Create singleton instance
const apiClient = new ApiClient();

// Add debug mode in development
if (process.env.NODE_ENV === 'development') {
  window.apiClient = apiClient;
}

export default apiClient;