#!/usr/bin/env node

/**
 * Deployment Script for Claude AI Automation Builder
 * Handles building, testing, and deploying the Monday.com app
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const crypto = require('crypto');

class DeploymentManager {
  constructor() {
    this.config = this.loadConfig();
    this.startTime = Date.now();
    this.logs = [];
  }

  /**
   * Load deployment configuration
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../config/deployment.json');
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch (error) {
      this.log('warn', 'No deployment config found, using defaults');
    }

    return {
      environment: process.env.NODE_ENV || 'production',
      registry: process.env.DOCKER_REGISTRY || 'localhost:5000',
      imageName: 'claude-automation-builder',
      imageTag: process.env.BUILD_VERSION || this.generateVersion(),
      healthCheckTimeout: 120000,
      rollbackOnFailure: true,
      notifications: {
        slack: process.env.SLACK_WEBHOOK_URL,
        email: process.env.NOTIFICATION_EMAIL
      },
      platforms: {
        docker: {
          enabled: true,
          platform: 'linux/amd64,linux/arm64'
        },
        kubernetes: {
          enabled: false,
          namespace: 'claude-automation',
          deployment: 'claude-automation-builder'
        },
        mondayCode: {
          enabled: true,
          appId: process.env.MONDAY_APP_ID,
          versionId: process.env.MONDAY_VERSION_ID
        }
      }
    };
  }

  /**
   * Generate semantic version
   */
  generateVersion() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    
    return `v${year}.${month}.${day}-${hour}${minute}`;
  }

  /**
   * Log deployment messages
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      data
    };
    
    this.logs.push(logEntry);
    
    const colorCodes = {
      ERROR: '\x1b[31m',
      WARN: '\x1b[33m',
      INFO: '\x1b[36m',
      SUCCESS: '\x1b[32m',
      DEBUG: '\x1b[90m'
    };
    
    const color = colorCodes[level.toUpperCase()] || '\x1b[0m';
    const reset = '\x1b[0m';
    
    console.log(`${color}[${timestamp}] ${level.toUpperCase()}: ${message}${reset}`);
    if (data) {
      console.log(`${color}${JSON.stringify(data, null, 2)}${reset}`);
    }
  }

  /**
   * Execute shell command with logging
   */
  async exec(command, options = {}) {
    this.log('debug', `Executing: ${command}`);
    
    try {
      const result = execSync(command, {
        encoding: 'utf8',
        stdio: 'pipe',
        ...options
      });
      
      this.log('debug', `Command completed: ${command}`);
      return result.trim();
    } catch (error) {
      this.log('error', `Command failed: ${command}`, {
        error: error.message,
        stdout: error.stdout?.toString(),
        stderr: error.stderr?.toString()
      });
      throw error;
    }
  }

  /**
   * Pre-deployment checks
   */
  async preDeploymentChecks() {
    this.log('info', 'Running pre-deployment checks...');
    
    // Check required environment variables
    const requiredEnvVars = [
      'MONDAY_CLIENT_ID',
      'MONDAY_CLIENT_SECRET', 
      'CLAUDE_API_KEY',
      'DATABASE_URL'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    // Check Node.js version
    const nodeVersion = process.version;
    const requiredVersion = '18.0.0';
    if (!this.compareVersions(nodeVersion.substring(1), requiredVersion)) {
      throw new Error(`Node.js version ${requiredVersion} or higher required, found ${nodeVersion}`);
    }
    
    // Check Docker availability
    try {
      await this.exec('docker --version');
      this.log('info', 'Docker is available');
    } catch (error) {
      this.log('warn', 'Docker not available, skipping Docker deployment');
      this.config.platforms.docker.enabled = false;
    }
    
    // Validate manifest.json
    this.validateManifest();
    
    this.log('success', 'Pre-deployment checks passed');
  }

  /**
   * Compare semantic versions
   */
  compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;
      
      if (v1Part > v2Part) return true;
      if (v1Part < v2Part) return false;
    }
    
    return true; // Equal
  }

  /**
   * Validate Monday.com manifest
   */
  validateManifest() {
    const manifestPath = path.join(__dirname, '../manifest.json');
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json not found');
    }
    
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      
      const requiredFields = ['name', 'version', 'client_id', 'scopes', 'features'];
      const missingFields = requiredFields.filter(field => !manifest[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Invalid manifest: missing fields ${missingFields.join(', ')}`);
      }
      
      this.log('info', 'Manifest validation passed');
    } catch (error) {
      throw new Error(`Manifest validation failed: ${error.message}`);
    }
  }

  /**
   * Build client application
   */
  async buildClient() {
    this.log('info', 'Building client application...');
    
    const clientPath = path.join(__dirname, '../client');
    
    if (!fs.existsSync(clientPath)) {
      this.log('warn', 'Client directory not found, skipping client build');
      return;
    }
    
    // Install dependencies
    await this.exec('npm ci', { cwd: clientPath });
    
    // Run build
    await this.exec('npm run build', { cwd: clientPath });
    
    // Verify build output
    const distPath = path.join(clientPath, 'dist');
    if (!fs.existsSync(distPath)) {
      throw new Error('Client build failed: dist directory not found');
    }
    
    this.log('success', 'Client build completed');
  }

  /**
   * Build server application
   */
  async buildServer() {
    this.log('info', 'Building server application...');
    
    // Install dependencies
    await this.exec('npm ci');
    
    // Run TypeScript build if available
    try {
      await this.exec('npm run build');
      this.log('info', 'TypeScript build completed');
    } catch (error) {
      this.log('warn', 'No TypeScript build script found, using source files');
    }
    
    this.log('success', 'Server build completed');
  }

  /**
   * Run tests
   */
  async runTests() {
    this.log('info', 'Running tests...');
    
    try {
      await this.exec('npm test');
      this.log('success', 'All tests passed');
    } catch (error) {
      if (this.config.environment === 'production') {
        throw new Error('Tests failed in production deployment');
      } else {
        this.log('warn', 'Tests failed but continuing with deployment');
      }
    }
  }

  /**
   * Build Docker image