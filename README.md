# Claude AI Automation Builder for Monday.com

🤖 **AI-Powered Automation Creator** - Transform natural language into powerful Monday.com automations using Claude AI.

[![Monday.com Marketplace](https://img.shields.io/badge/Monday.com-Marketplace%20Ready-blue)](https://monday.com/marketplace)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue)](https://docker.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## 🚀 Features

- 🗣️ **Natural Language Processing** - Describe automations in plain English
- ⚡ **Instant Automation Creation** - AI generates complex workflows automatically
- 🔧 **One-Click Implementation** - Deploy automations directly to Monday.com boards
- 🎯 **Smart Suggestions** - Get AI recommendations for workflow improvements
- 🛡️ **Enterprise Security** - Monday.com marketplace approved security standards
- 📊 **Health Monitoring** - Comprehensive health checks and monitoring
- 🐳 **Docker Ready** - Complete containerization and deployment infrastructure

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- Monday.com developer account
- Claude AI API key from Anthropic
- Docker (optional, for containerized deployment)

### Installation
```bash
# Clone the repository
git clone https://github.com/your-username/claude-automation-builder.git
cd claude-automation-builder

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your actual API keys and configuration

# Start development server
npm run dev
```

### Monday.com Setup
1. Create app in Monday.com Developer Center
2. Configure OAuth scopes (see manifest.json)
3. Set webhook URL: `https://your-domain.com/webhooks/monday`
4. Set action endpoints:
   - Execute: `https://your-domain.com/monday/execute_action`
   - Options: `https://your-domain.com/monday/get_remote_list_options`

## 📁 Project Structure

```
claude-automation-builder/
├── config/              # Configuration files
├── controllers/         # Request handlers (including Monday.com controllers)
├── middleware/          # Express middleware
├── routes/             # API routes
├── services/           # Business logic and AI services
├── utils/              # Helper functions
├── client/             # Frontend React components
├── nlp/                # Natural language processing
├── tests/              # Test files
├── scripts/            # Build/deployment scripts
├── deployment/         # Docker and deployment configs
└── logs/              # Application logs
```
## 🚀 Deployment

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build Docker image
docker build -f deployment/Dockerfile -t claude-monday-app .
```

### Platform Deployment
```bash
# Deploy to Railway/Render/Heroku
npm run deploy

# Health check
npm run health
```

## 🔧 API Endpoints

- `GET /health` - Comprehensive health check
- `POST /monday/execute_action` - Monday.com action execution
- `POST /monday/get_remote_list_options` - Dynamic dropdown options
- `POST /api/ai/analyze-request` - AI request analysis
- `POST /webhooks/monday` - Monday.com webhook processing

## 🛡️ Security Features

- Monday.com webhook signature verification
- JWT authentication
- Rate limiting (100 req/min, 1000 req/hour)
- CORS configuration for Monday.com domains
- Input validation and sanitization
- Comprehensive error handling

## 📊 Monitoring

- Health check endpoints for Kubernetes/Docker
- Performance monitoring
- Error tracking and logging
- Monday.com API connectivity checks
- Claude AI API health verification


## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- Issues: [GitHub Issues](https://github.com/your-username/claude-automation-builder/issues)
- Documentation: See `/docs` folder
- Email: support@your-domain.com

## 🔒 Security

- Never commit `.env` file with real credentials
- Use strong, unique secrets for production
- Regularly rotate API keys and tokens
- Follow Monday.com security best practices
- Report security issues privately to security@your-domain.com

