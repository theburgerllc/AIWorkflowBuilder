# Deployment Guide

## Overview
This guide covers deploying the AI Workflow Builder to various platforms for Monday.com marketplace submission.

## Prerequisites
- Node.js 18+
- Docker (optional)
- Monday.com developer account
- Anthropic Claude API key
- PostgreSQL database (for production)

## Environment Configuration

### Required Environment Variables
```bash
# Monday.com Configuration
MONDAY_CLIENT_ID=your_client_id
MONDAY_CLIENT_SECRET=your_client_secret
MONDAY_SIGNING_SECRET=your_signing_secret
MONDAY_APP_ID=your_app_id
MONDAY_APP_VERSION_ID=your_version_id

# Claude AI Configuration
ANTHROPIC_API_KEY=your_anthropic_key
CLAUDE_MODEL=claude-3-5-sonnet-20241022

# Security
JWT_SECRET=your_jwt_secret
ENCRYPTION_KEY=your_32_char_encryption_key
SESSION_SECRET=your_session_secret

# Database
DATABASE_URL=postgresql://user:pass@host:port/db

# Server Configuration
PORT=8080
NODE_ENV=production
APP_BASE_URL=https://your-domain.com
REDIRECT_URI=https://your-domain.com/auth/monday/callback
```

## Platform Deployments

### Railway Deployment
1. Connect GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy automatically on push to main branch

### Docker Deployment
```bash
# Build image
docker build -f deployment/Dockerfile -t ai-workflow-builder .

# Run container
docker run -p 8080:8080 --env-file .env ai-workflow-builder
```

### Heroku Deployment
```bash
# Create Heroku app
heroku create your-app-name

# Set environment variables
heroku config:set MONDAY_CLIENT_ID=your_value
# ... set all required variables

# Deploy
git push heroku main
```

## Health Checks
The application provides comprehensive health checks at `/health` endpoint:
- Monday.com API connectivity
- Claude AI API status
- Database connection
- Memory usage
- Uptime metrics

## Monitoring
- Response time monitoring
- Error rate tracking
- Rate limiting compliance
- Performance metrics at `/metrics/response-time`

## Security Considerations
- All secrets must be set as environment variables
- Never commit `.env` files to repository
- Use strong, unique secrets for production
- Enable HTTPS for all production deployments
- Verify Monday.com webhook signatures

## Troubleshooting

### Common Issues
1. **Health check failures**: Verify all environment variables are set
2. **Monday.com authentication errors**: Check client ID and secret
3. **Rate limiting**: Ensure compliance with 100 req/min, 1000 req/hour
4. **Database connection**: Verify DATABASE_URL format and credentials

### Logs
Application logs are available in:
- Console output (development)
- `logs/app.log` (production)
- Platform-specific logging (Railway, Heroku, etc.)

## Performance Requirements
- Response time: < 2 seconds for API endpoints
- Health check: < 5 seconds response time
- Uptime SLA: 99.9%
- Memory limit: 512MB recommended

## Scaling
The application is designed to be stateless and can be horizontally scaled:
- Use load balancer for multiple instances
- Ensure database can handle concurrent connections
- Monitor rate limiting across instances
