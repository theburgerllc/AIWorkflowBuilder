# GitHub Secrets Configuration

## Overview
This document explains how to configure GitHub repository secrets for the AI Workflow Builder CI/CD pipeline.

## Required Secrets

### Optional Secrets (for full CI/CD functionality)

#### RAILWAY_TOKEN
- **Purpose**: Enables automatic deployment to Railway
- **Required**: No (deployment step will be skipped if not provided)
- **How to get**: 
  1. Go to Railway dashboard
  2. Navigate to Account Settings → Tokens
  3. Create a new token with deployment permissions
  4. Copy the token value

#### PRODUCTION_URL
- **Purpose**: Used for health checks and performance testing after deployment
- **Required**: No (defaults to Railway URL if not provided)
- **Format**: `https://your-app-domain.com`
- **Example**: `https://aiworkflowbuilder-production.up.railway.app`

## Setting Up Secrets

### Step-by-Step Instructions

1. **Navigate to Repository Settings**
   - Go to your GitHub repository
   - Click on "Settings" tab
   - Select "Secrets and variables" → "Actions"

2. **Add New Secret**
   - Click "New repository secret"
   - Enter the secret name (e.g., `RAILWAY_TOKEN`)
   - Paste the secret value
   - Click "Add secret"

3. **Verify Secrets**
   - Secrets will appear in the list (values are hidden)
   - You can update or delete secrets as needed

## CI/CD Pipeline Behavior

### With Secrets Configured
- Full CI/CD pipeline runs including:
  - Automated testing
  - Security auditing
  - Docker image building
  - Deployment to Railway
  - Health checks and performance testing
  - Monday.com marketplace validation

### Without Secrets
- Basic CI/CD pipeline runs including:
  - Automated testing
  - Security auditing
  - Docker image building
  - Deployment and performance steps are skipped

## Security Best Practices

### Secret Management
- **Never commit secrets** to the repository
- **Use strong, unique tokens** for each service
- **Regularly rotate secrets** for security
- **Limit token permissions** to minimum required scope
- **Monitor token usage** in service dashboards

### Token Permissions
- **Railway Token**: Should have deployment permissions only
- **Avoid admin tokens**: Use service-specific tokens when possible

## Troubleshooting

### Common Issues

#### Deployment Fails
- **Check Railway token**: Ensure token is valid and has correct permissions
- **Verify service name**: Ensure Railway service name matches CI/CD configuration
- **Check Railway logs**: Review deployment logs in Railway dashboard

#### Health Checks Fail
- **Verify production URL**: Ensure URL is correct and accessible
- **Check application status**: Verify app is running and healthy
- **Review response times**: Ensure app meets performance requirements

#### Performance Tests Fail
- **Response time limits**: Health checks must respond within 5 seconds
- **API response limits**: API endpoints must respond within 2 seconds
- **Network issues**: Check for connectivity problems

### Debug Steps

1. **Check GitHub Actions logs**
   - Go to Actions tab in repository
   - Click on failed workflow run
   - Review step-by-step logs

2. **Verify secret values**
   - Ensure secrets are properly set
   - Check for typos in secret names
   - Verify token permissions

3. **Test manually**
   - Test Railway deployment manually
   - Verify production URL accessibility
   - Check application health endpoints

## Alternative Deployment Options

### Without Railway
If not using Railway, you can:
- Remove Railway-specific steps from CI/CD
- Add deployment steps for your preferred platform
- Update health check URLs accordingly

### Manual Deployment
For manual deployment:
- Skip deployment steps in CI/CD
- Use the built Docker image for manual deployment
- Run health checks manually after deployment

## Environment Variables vs Secrets

### Use Secrets For:
- API tokens and keys
- Database passwords
- Service credentials
- Production URLs with sensitive information

### Use Environment Variables For:
- Public configuration values
- Non-sensitive settings
- Default values
- Development configuration

## Monitoring and Maintenance

### Regular Tasks
- **Review secret usage** monthly
- **Rotate tokens** quarterly
- **Update permissions** as needed
- **Monitor CI/CD performance** weekly

### Security Audits
- **Check for exposed secrets** in logs
- **Verify token permissions** regularly
- **Review access patterns** in service dashboards
- **Update security policies** as needed

## Support

### Getting Help
- **GitHub Actions documentation**: https://docs.github.com/en/actions
- **Railway documentation**: https://docs.railway.app
- **Repository issues**: Create an issue for specific problems
- **Security concerns**: Contact repository maintainers privately

### Contact Information
- **Repository**: https://github.com/theburgerllc/ai-workflow-builder
- **Email**: burger@theburgerllc.com
- **Issues**: GitHub Issues for technical problems
