#!/bin/bash

# Production Deployment Script for Monday.com Claude App
# Usage: ./scripts/deploy.sh [platform]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PLATFORM=${1:-railway}
APP_NAME="claude-monday-app"

echo -e "${GREEN}🚀 Starting deployment for ${APP_NAME}${NC}"

# Pre-deployment checks
echo -e "${YELLOW}📋 Running pre-deployment checks...${NC}"

# Check required environment variables
required_vars=(
    "MONDAY_CLIENT_ID"
    "MONDAY_CLIENT_SECRET" 
    "MONDAY_SIGNING_SECRET"
    "CLAUDE_API_KEY"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Missing required environment variable: $var${NC}"
        exit 1
    fi
done

# Check if files exist
required_files=(
    "package.json"
    "server/index.js"
    "client/package.json"
    "manifest.json"
    "deployment/Dockerfile"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ Missing required file: $file${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ Pre-deployment checks passed${NC}"

# Build application
echo -e "${YELLOW}🔨 Building application...${NC}"
npm ci
cd client && npm ci && npm run build && cd ..

# Test build
echo -e "${YELLOW}🧪 Testing build...${NC}"
npm run test:production

# Deploy based on platform
case $PLATFORM in
    railway)
        echo -e "${YELLOW}🚂 Deploying to Railway...${NC}"
        railway login --service-token $RAILWAY_TOKEN
        railway up
        DEPLOY_URL=$(railway status --json | jq -r '.deployments[0].url')
        ;;
    render)
        echo -e "${YELLOW}🎨 Deploying to Render...${NC}"
        render deploy --service-id $RENDER_SERVICE_ID
        DEPLOY_URL="https://${APP_NAME}.onrender.com"
        ;;
    docker)
        echo -e "${YELLOW}🐳 Building Docker image...${NC}"
        docker build -t $APP_NAME:latest -f deployment/Dockerfile .
        docker tag $APP_NAME:latest $DOCKER_REGISTRY/$APP_NAME:latest
        docker push $DOCKER_REGISTRY/$APP_NAME:latest
        DEPLOY_URL="Deployed to registry"
        ;;
    *)
        echo -e "${RED}❌ Unknown platform: $PLATFORM${NC}"
        exit 1
        ;;
esac

# Wait for deployment
echo -e "${YELLOW}⏳ Waiting for deployment to be ready...${NC}"
sleep 30

# Health check
if [ "$DEPLOY_URL" != "Deployed to registry" ]; then
    echo -e "${YELLOW}🏥 Running health check...${NC}"
    for i in {1..10}; do
        if curl -f "$DEPLOY_URL/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Health check passed${NC}"
            break
        else
            echo -e "${YELLOW}⏳ Waiting for application to start (attempt $i/10)...${NC}"
            sleep 10
        fi
        
        if [ $i -eq 10 ]; then
            echo -e "${RED}❌ Health check failed after 10 attempts${NC}"
            exit 1
        fi
    done
fi

# Update manifest with production URL
if [ "$DEPLOY_URL" != "Deployed to registry" ]; then
    echo -e "${YELLOW}📝 Updating manifest with production URL...${NC}"
    jq --arg url "$DEPLOY_URL" '.baseUrl = $url' manifest.json > manifest.tmp && mv manifest.tmp manifest.json
fi

# Success
echo -e "${GREEN}🎉 Deployment successful!${NC}"
echo -e "${GREEN}📡 Application URL: $DEPLOY_URL${NC}"
echo -e "${GREEN}📊 Health Check: $DEPLOY_URL/health${NC}"
echo -e "${GREEN}📋 Manifest: Updated with production URL${NC}"

# Post-deployment tasks
echo -e "${YELLOW}📋 Running post-deployment tasks...${NC}"

# Update Monday.com app configuration
echo -e "${YELLOW}🔄 Updating Monday.com app configuration...${NC}"
curl -X POST "https://api.monday.com/apps/update" \
    -H "Authorization: Bearer $MONDAY_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"baseUrl\": \"$DEPLOY_URL\"}"

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${GREEN}🚀 Your Monday.com Claude App is now live at: $DEPLOY_URL${NC}"