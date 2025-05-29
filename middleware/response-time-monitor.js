const logger = require('../utils/logger');

/**
 * Response Time Monitoring Middleware for Monday.com Compliance
 * Monday.com requires API responses under 2 seconds
 */
class ResponseTimeMonitor {
  constructor() {
    this.slowRequestThreshold = 2000; // 2 seconds
    this.warningThreshold = 1500; // 1.5 seconds warning
    this.metrics = {
      totalRequests: 0,
      slowRequests: 0,
      averageResponseTime: 0,
      maxResponseTime: 0
    };
  }

  /**
   * Middleware function to monitor response times
   */
  monitor() {
    return (req, res, next) => {
      const startTime = Date.now();
      const startHrTime = process.hrtime();

      // Override res.end to capture response time
      const originalEnd = res.end;
      res.end = function(...args) {
        const endTime = Date.now();
        const diff = process.hrtime(startHrTime);
        const responseTime = endTime - startTime;
        const preciseTime = diff[0] * 1000 + diff[1] * 1e-6; // Convert to milliseconds

        // Update metrics
        this.updateMetrics(responseTime);

        // Add response time headers
        res.set('X-Response-Time', `${responseTime}ms`);
        res.set('X-Response-Time-Precise', `${preciseTime.toFixed(3)}ms`);

        // Log slow requests
        if (responseTime > this.slowRequestThreshold) {
          logger.warn('Slow request detected', {
            method: req.method,
            url: req.url,
            responseTime: `${responseTime}ms`,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            status: res.statusCode
          });
        } else if (responseTime > this.warningThreshold) {
          logger.info('Warning: Request approaching threshold', {
            method: req.method,
            url: req.url,
            responseTime: `${responseTime}ms`,
            status: res.statusCode
          });
        }

        // Log all Monday.com endpoint responses
        if (req.url.startsWith('/monday/') || req.url.startsWith('/api/monday/')) {
          logger.info('Monday.com endpoint response', {
            method: req.method,
            url: req.url,
            responseTime: `${responseTime}ms`,
            status: res.statusCode,
            compliant: responseTime < this.slowRequestThreshold
          });
        }

        originalEnd.apply(res, args);
      }.bind(this);

      next();
    };
  }

  /**
   * Update response time metrics
   */
  updateMetrics(responseTime) {
    this.metrics.totalRequests++;
    
    if (responseTime > this.slowRequestThreshold) {
      this.metrics.slowRequests++;
    }

    // Update average (simple moving average)
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + responseTime) / 
      this.metrics.totalRequests;

    // Update max
    if (responseTime > this.metrics.maxResponseTime) {
      this.metrics.maxResponseTime = responseTime;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      slowRequestPercentage: this.metrics.totalRequests > 0 
        ? (this.metrics.slowRequests / this.metrics.totalRequests * 100).toFixed(2)
        : 0,
      complianceRate: this.metrics.totalRequests > 0
        ? (((this.metrics.totalRequests - this.metrics.slowRequests) / this.metrics.totalRequests) * 100).toFixed(2)
        : 100
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      slowRequests: 0,
      averageResponseTime: 0,
      maxResponseTime: 0
    };
  }

  /**
   * Get metrics endpoint handler
   */
  getMetricsHandler() {
    return (req, res) => {
      res.json({
        responseTimeMetrics: this.getMetrics(),
        thresholds: {
          slowRequestThreshold: this.slowRequestThreshold,
          warningThreshold: this.warningThreshold
        },
        timestamp: new Date().toISOString()
      });
    };
  }
}

// Create singleton instance
const responseTimeMonitor = new ResponseTimeMonitor();

module.exports = {
  ResponseTimeMonitor,
  responseTimeMonitor,
  monitor: responseTimeMonitor.monitor.bind(responseTimeMonitor),
  getMetrics: responseTimeMonitor.getMetrics.bind(responseTimeMonitor),
  getMetricsHandler: responseTimeMonitor.getMetricsHandler.bind(responseTimeMonitor)
};
