// Production Rate Limiter for Monday.com Claude App

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');

class ProductionRateLimiter {
    constructor() {
        this.redisClient = this.initializeRedis();
        this.store = new RedisStore({
            sendCommand: (...args) => this.redisClient.sendCommand(args),
        });
    }

    initializeRedis() {
        if (process.env.REDIS_URL) {
            return redis.createClient({
                url: process.env.REDIS_URL,
                socket: {
                    connectTimeout: 5000,
                    commandTimeout: 5000,
                }
            });
        }
        return null; // Fall back to memory store
    }

    // Global application rate limiter
    createGlobalLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000, // Limit each IP to 1000 requests per windowMs
            message: {
                error: 'Too many requests',
                message: 'Rate limit exceeded. Please try again later.',
                retryAfter: 900 // 15 minutes in seconds
            },
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: (req) => {
                // Use account ID if available, otherwise IP
                return req.accountId || req.ip;
            },
            skip: (req) => {
                // Skip rate limiting for health checks
                return req.path.startsWith('/health') || 
                       req.path.startsWith('/ready') || 
                       req.path.startsWith('/live');
            }
        });
    }

    // API endpoint rate limiter
    createApiLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: 60, // 60 requests per minute per account
            message: {
                error: 'API rate limit exceeded',
                message: 'Too many API requests. Please wait before making more requests.',
                retryAfter: 60
            },
            keyGenerator: (req) => {
                return `api:${req.accountId || req.ip}`;
            },
            onLimitReached: (req, res) => {
                console.warn(`API rate limit reached for account: ${req.accountId || req.ip}`);
            }
        });
    }

    // Claude API rate limiter (expensive operations)
    createClaudeLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: 30, // 30 Claude requests per minute per account
            message: {
                error: 'Claude API rate limit exceeded',
                message: 'Too many AI processing requests. Please wait before submitting more operations.',
                retryAfter: 60
            },
            keyGenerator: (req) => {
                return `claude:${req.accountId || req.ip}`;
            },
            onLimitReached: (req, res) => {
                console.warn(`Claude rate limit reached for account: ${req.accountId || req.ip}`);
            }
        });
    }

    // Monday.com API rate limiter
    createMondayLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: 50, // 50 Monday.com API calls per minute per account
            message: {
                error: 'Monday.com API rate limit exceeded',
                message: 'Too many Monday.com operations. Please wait before performing more actions.',
                retryAfter: 60
            },
            keyGenerator: (req) => {
                return `monday:${req.accountId || req.ip}`;
            }
        });
    }

    // Authentication rate limiter
    createAuthLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 10, // 10 auth attempts per 15 minutes per IP
            message: {
                error: 'Authentication rate limit exceeded',
                message: 'Too many authentication attempts. Please try again later.',
                retryAfter: 900
            },
            keyGenerator: (req) => {
                return `auth:${req.ip}`;
            },
            skipSuccessfulRequests: true
        });
    }

    // Bulk operations rate limiter
    createBulkLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 5 * 60 * 1000, // 5 minutes
            max: 10, // 10 bulk operations per 5 minutes per account
            message: {
                error: 'Bulk operations rate limit exceeded',
                message: 'Too many bulk operations. Please wait before performing more bulk actions.',
                retryAfter: 300
            },
            keyGenerator: (req) => {
                return `bulk:${req.accountId || req.ip}`;
            }
        });
    }

    // Dynamic rate limiter based on user tier
    createTieredLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: (req) => {
                // Get user tier from subscription info
                const userTier = req.mondayUser?.subscription?.plan_id || 'free';
                
                switch (userTier) {
                    case 'enterprise':
                        return 200; // 200 requests per minute
                    case 'pro':
                        return 100; // 100 requests per minute
                    case 'standard':
                        return 60;  // 60 requests per minute
                    default:
                        return 30;  // 30 requests per minute for free tier
                }
            },
            message: (req) => {
                const userTier = req.mondayUser?.subscription?.plan_id || 'free';
                return {
                    error: 'Tier rate limit exceeded',
                    message: `Rate limit exceeded for ${userTier} tier. Consider upgrading for higher limits.`,
                    tier: userTier,
                    retryAfter: 60
                };
            },
            keyGenerator: (req) => {
                return `tier:${req.accountId || req.ip}`;
            }
        });
    }

    // Progressive rate limiter (increases limits for good behavior)
    createProgressiveLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: async (req) => {
                const key = `behavior:${req.accountId || req.ip}`;
                const score = await this.getBehaviorScore(key);
                
                // Base limit of 60, can increase up to 120 based on good behavior
                return Math.min(120, 60 + Math.floor(score / 10));
            },
            keyGenerator: (req) => {
                return `progressive:${req.accountId || req.ip}`;
            },
            onLimitReached: (req, res) => {
                this.recordBadBehavior(`behavior:${req.accountId || req.ip}`);
            }
        });
    }

    // Get behavior score for progressive limiting
    async getBehaviorScore(key) {
        if (!this.redisClient) return 0;
        
        try {
            const score = await this.redisClient.get(key);
            return parseInt(score) || 0;
        } catch (error) {
            console.error('Error getting behavior score:', error);
            return 0;
        }
    }

    // Record bad behavior
    async recordBadBehavior(key) {
        if (!this.redisClient) return;
        
        try {
            await this.redisClient.decrBy(key, 5);
            await this.redisClient.expire(key, 3600); // 1 hour TTL
        } catch (error) {
            console.error('Error recording bad behavior:', error);
        }
    }

    // Record good behavior
    async recordGoodBehavior(key) {
        if (!this.redisClient) return;
        
        try {
            await this.redisClient.incrBy(key, 1);
            await this.redisClient.expire(key, 3600); // 1 hour TTL
        } catch (error) {
            console.error('Error recording good behavior:', error);
        }
    }

    // Custom rate limiter for specific operations
    createCustomLimiter(options = {}) {
        const defaults = {
            windowMs: 60 * 1000, // 1 minute
            max: 100,
            message: {
                error: 'Rate limit exceeded',
                message: 'Too many requests. Please try again later.',
                retryAfter: 60
            },
            keyGenerator: (req) => req.accountId || req.ip
        };

        const config = { ...defaults, ...options };
        
        if (this.store) {
            config.store = this.store;
        }

        return rateLimit(config);
    }

    // Rate limiter for file uploads
    createUploadLimiter() {
        return rateLimit({
            store: this.store,
            windowMs: 60 * 1000, // 1 minute
            max: 5, // 5 uploads per minute
            message: {
                error: 'Upload rate limit exceeded',
                message: 'Too many file uploads. Please wait before uploading more files.',
                retryAfter: 60
            },
            keyGenerator: (req) => {
                return `upload:${req.accountId || req.ip}`;
            }
        });
    }

    // Setup all rate limiters
    setupRateLimiters(app) {
        // Global rate limiter
        app.use(this.createGlobalLimiter());

        // Authentication rate limiter
        app.use('/auth', this.createAuthLimiter());

        // API rate limiters
        app.use('/api', this.createApiLimiter());
        app.use('/api/claude', this.createClaudeLimiter());
        app.use('/api/monday', this.createMondayLimiter());
        app.use('/api/bulk', this.createBulkLimiter());
        app.use('/api/upload', this.createUploadLimiter());

        // Tiered rate limiter for authenticated routes
        app.use('/api/premium', this.createTieredLimiter());

        console.log('✅ Rate limiters configured successfully');
    }

    // Graceful shutdown
    async shutdown() {
        if (this.redisClient) {
            await this.redisClient.quit();
        }
    }
}

// Export rate limiter factory
function createRateLimiter() {
    return new ProductionRateLimiter();
}

module.exports = {
    ProductionRateLimiter,
    createRateLimiter
};
            