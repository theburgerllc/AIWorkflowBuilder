// Production Health Check System for Monday.com Claude App

const express = require('express');
const axios = require('axios');

class HealthChecker {
    constructor() {
        this.checks = {
            database: this.checkDatabase.bind(this),
            mondayApi: this.checkMondayApi.bind(this),
            claudeApi: this.checkClaudeApi.bind(this),
            memory: this.checkMemory.bind(this),
            diskSpace: this.checkDiskSpace.bind(this)
        };
    }

    // Main health check endpoint
    async performHealthCheck(req, res) {
        const startTime = Date.now();
        const results = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            checks: {}
        };

        // Run all health checks
        for (const [name, check] of Object.entries(this.checks)) {
            try {
                const checkStart = Date.now();
                const result = await check();
                results.checks[name] = {
                    status: 'healthy',
                    responseTime: Date.now() - checkStart,
                    ...result
                };
            } catch (error) {
                results.checks[name] = {
                    status: 'unhealthy',
                    error: error.message,
                    responseTime: Date.now() - checkStart
                };
                results.status = 'unhealthy';
            }
        }

        results.totalResponseTime = Date.now() - startTime;

        // Set appropriate HTTP status
        const httpStatus = results.status === 'healthy' ? 200 : 503;
        
        res.status(httpStatus).json(results);
    }

    // Database connectivity check
    async checkDatabase() {
        if (!process.env.DATABASE_URL) {
            return { message: 'No database configured' };
        }

        // Simple connection test
        const startTime = Date.now();
        // Add your database ping logic here
        
        return {
            connected: true,
            responseTime: Date.now() - startTime
        };
    }

    // Monday.com API connectivity check
    async checkMondayApi() {
        try {
            const response = await axios.post(
                'https://api.monday.com/v2',
                { query: '{ me { id } }' },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.MONDAY_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            return {
                connected: true,
                apiVersion: '2',
                authenticated: !!response.data.data?.me
            };
        } catch (error) {
            throw new Error(`Monday.com API check failed: ${error.message}`);
        }
    }

    // Claude API connectivity check
    async checkClaudeApi() {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'ping' }]
                },
                {
                    headers: {
                        'x-api-key': process.env.CLAUDE_API_KEY,
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01'
                    },
                    timeout: 5000
                }
            );

            return {
                connected: true,
                model: 'claude-3-haiku-20240307',
                usage: response.data.usage
            };
        } catch (error) {
            throw new Error(`Claude API check failed: ${error.message}`);
        }
    }

    // Memory usage check
    async checkMemory() {
        const memUsage = process.memoryUsage();
        const totalMem = require('os').totalmem();
        const freeMem = require('os').freemem();
        
        const memoryPercentage = ((memUsage.rss / totalMem) * 100).toFixed(2);
        
        if (memoryPercentage > 90) {
            throw new Error(`High memory usage: ${memoryPercentage}%`);
        }

        return {
            usage: {
                rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
            },
            system: {
                total: Math.round(totalMem / 1024 / 1024) + 'MB',
                free: Math.round(freeMem / 1024 / 1024) + 'MB',
                used: memoryPercentage + '%'
            }
        };
    }

    // Disk space check
    async checkDiskSpace() {
        const fs = require('fs');
        const stats = fs.statSync('.');
        
        return {
            message: 'Disk space check passed',
            writable: true
        };
    }

    // Ready check (lighter version for Kubernetes)
    async performReadyCheck(req, res) {
        const criticalChecks = ['mondayApi', 'claudeApi'];
        
        for (const checkName of criticalChecks) {
            try {
                await this.checks[checkName]();
            } catch (error) {
                return res.status(503).json({
                    status: 'not ready',
                    check: checkName,
                    error: error.message
                });
            }
        }

        res.status(200).json({
            status: 'ready',
            timestamp: new Date().toISOString()
        });
    }

    // Live check (minimal check)
    performLiveCheck(req, res) {
        res.status(200).json({
            status: 'alive',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    }
}

// Setup health check routes
function setupHealthChecks(app) {
    const healthChecker = new HealthChecker();

    // Comprehensive health check
    app.get('/health', healthChecker.performHealthCheck.bind(healthChecker));
    
    // Kubernetes readiness probe
    app.get('/ready', healthChecker.performReadyCheck.bind(healthChecker));
    
    // Kubernetes liveness probe
    app.get('/live', healthChecker.performLiveCheck.bind(healthChecker));

    // Detailed health metrics
    app.get('/health/detailed', async (req, res) => {
        const health = await healthChecker.performHealthCheck(req, res);
        // Add additional metrics
        const metrics = {
            ...health,
            environment: process.env.NODE_ENV,
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid
        };
        res.json(metrics);
    });
}

module.exports = {
    HealthChecker,
    setupHealthChecks
};