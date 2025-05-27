// Monday.com JWT Request Validator - Production Security Implementation

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class RequestValidator {
    constructor(signingSecret) {
        this.signingSecret = signingSecret;
        this.validIssuers = ['monday.com'];
        this.validAudiences = [process.env.MONDAY_CLIENT_ID];
    }

    // Main middleware for validating Monday.com requests
    validateMondayRequest() {
        return async (req, res, next) => {
            try {
                // Extract authorization header
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return this.unauthorized(res, 'Missing or invalid authorization header');
                }

                const token = authHeader.substring(7);

                // Validate JWT token
                const payload = await this.validateJWT(token);
                
                // Validate request signature
                if (!this.validateSignature(req, token)) {
                    return this.unauthorized(res, 'Invalid request signature');
                }

                // Validate origin
                if (!this.validateOrigin(req)) {
                    return this.forbidden(res, 'Invalid request origin');
                }

                // Add validated payload to request
                req.mondayUser = payload;
                req.accountId = payload.accountId;
                req.userId = payload.userId;

                next();
            } catch (error) {
                console.error('Request validation failed:', error);
                return this.unauthorized(res, 'Request validation failed');
            }
        };
    }

    // Validate JWT token structure and signature
    async validateJWT(token) {
        try {
            // Verify token signature and claims
            const payload = jwt.verify(token, this.signingSecret, {
                issuer: this.validIssuers,
                audience: this.validAudiences,
                algorithms: ['HS256']
            });

            // Validate required claims
            this.validateRequiredClaims(payload);

            // Validate token expiration with clock skew tolerance
            this.validateExpiration(payload);

            // Validate token issued time
            this.validateIssuedAt(payload);

            return payload;

        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new Error('Token has expired');
            } else if (error instanceof jwt.JsonWebTokenError) {
                throw new Error('Invalid token format');
            } else {
                throw new Error(`Token validation failed: ${error.message}`);
            }
        }
    }

    // Validate request signature using Monday.com signing secret
    validateSignature(req, token) {
        try {
            const signature = req.headers['x-monday-signature'];
            if (!signature) {
                return false;
            }

            // Reconstruct request body for signature verification
            const bodyString = JSON.stringify(req.body || {});
            const timestamp = req.headers['x-monday-timestamp'];
            
            if (!timestamp) {
                return false;
            }

            // Check timestamp freshness (prevent replay attacks)
            const now = Math.floor(Date.now() / 1000);
            const requestTime = parseInt(timestamp);
            
            if (Math.abs(now - requestTime) > 300) { // 5 minute tolerance
                return false;
            }

            // Create signature
            const payload = `${timestamp}.${bodyString}`;
            const expectedSignature = crypto
                .createHmac('sha256', this.signingSecret)
                .update(payload)
                .digest('hex');

            // Compare signatures securely
            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );

        } catch (error) {
            console.error('Signature validation error:', error);
            return false;
        }
    }

    // Validate request origin is from Monday.com
    validateOrigin(req) {
        const origin = req.headers.origin || req.headers.referer;
        const allowedOrigins = [
            'https://monday.com',
            'https://api.monday.com',
            /^https:\/\/[a-zA-Z0-9-]+\.monday\.com$/
        ];

        if (!origin) {
            return false;
        }

        return allowedOrigins.some(allowed => {
            if (typeof allowed === 'string') {
                return origin === allowed;
            } else {
                return allowed.test(origin);
            }
        });
    }

    // Validate required JWT claims
    validateRequiredClaims(payload) {
        const requiredClaims = ['userId', 'accountId', 'iat', 'exp'];
        
        for (const claim of requiredClaims) {
            if (!payload[claim]) {
                throw new Error(`Missing required claim: ${claim}`);
            }
        }

        // Validate claim types
        if (typeof payload.userId !== 'number' && typeof payload.userId !== 'string') {
            throw new Error('Invalid userId claim type');
        }

        if (typeof payload.accountId !== 'number' && typeof payload.accountId !== 'string') {
            throw new Error('Invalid accountId claim type');
        }
    }

    // Validate token expiration with clock skew
    validateExpiration(payload) {
        const now = Math.floor(Date.now() / 1000);
        const clockSkew = 30; // 30 seconds tolerance
        
        if (payload.exp < (now - clockSkew)) {
            throw new Error('Token has expired');
        }
    }

    // Validate token issued at time
    validateIssuedAt(payload) {
        const now = Math.floor(Date.now() / 1000);
        const clockSkew = 30; // 30 seconds tolerance
        
        if (payload.iat > (now + clockSkew)) {
            throw new Error('Token issued in the future');
        }
    }

    // Input sanitization middleware
    sanitizeInput() {
        return (req, res, next) => {
            try {
                if (req.body) {
                    req.body = this.sanitizeObject(req.body);
                }

                if (req.query) {
                    req.query = this.sanitizeObject(req.query);
                }

                if (req.params) {
                    req.params = this.sanitizeObject(req.params);
                }

                next();
            } catch (error) {
                console.error('Input sanitization failed:', error);
                return this.badRequest(res, 'Invalid input data');
            }
        };
    }

    // Recursively sanitize object properties
    sanitizeObject(obj) {
        if (typeof obj !== 'object' || obj === null) {
            return this.sanitizeValue(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeObject(item));
        }

        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanKey = this.sanitizeKey(key);
            sanitized[cleanKey] = this.sanitizeObject(value);
        }

        return sanitized;
    }

    // Sanitize individual values
    sanitizeValue(value) {
        if (typeof value === 'string') {
            // Remove potentially dangerous characters
            return value
                .replace(/<script[^>]*>.*?<\/script>/gi, '')
                .replace(/<[^>]*>/g, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+=/gi, '')
                .trim();
        }

        return value;
    }

    // Sanitize object keys
    sanitizeKey(key) {
        return key.replace(/[^a-zA-Z0-9_$]/g, '');
    }

    // CSRF protection middleware
    csrfProtection() {
        return (req, res, next) => {
            if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
                return next();
            }

            const token = req.headers['x-csrf-token'] || req.body._csrf;
            const sessionToken = req.session?.csrfToken;

            if (!token || !sessionToken || token !== sessionToken) {
                return this.forbidden(res, 'Invalid CSRF token');
            }

            next();
        };
    }

    // Response helpers
    unauthorized(res, message = 'Unauthorized') {
        return res.status(401).json({
            error: 'Unauthorized',
            message,
            timestamp: new Date().toISOString()
        });
    }

    forbidden(res, message = 'Forbidden') {
        return res.status(403).json({
            error: 'Forbidden',
            message,
            timestamp: new Date().toISOString()
        });
    }

    badRequest(res, message = 'Bad Request') {
        return res.status(400).json({
            error: 'Bad Request',
            message,
            timestamp: new Date().toISOString()
        });
    }
}

// Export middleware factory
function createValidator(signingSecret) {
    if (!signingSecret) {
        throw new Error('Signing secret is required for request validation');
    }

    return new RequestValidator(signingSecret);
}

module.exports = {
    RequestValidator,
    createValidator
};