# AWS CDK Templates

A collection of production-ready AWS CDK templates for common infrastructure patterns and use cases.

## Available Templates

### [aws-3tier-app](./aws-3tier-app)
Production-grade 3-tier architecture demonstrating the integration of PostgreSQL RDS, ElastiCache Redis, EC2, ALB, CloudFront, WAF, and S3 with industry best practices.

**Key Features:**
- Complete 3-tier architecture (Presentation, Application, Data layers)
- Redis caching with cache-aside pattern
- WAF protection with rate limiting
- Multi-AZ capable with auto-scaling support
- FastAPI application with health monitoring

**Estimated Cost:** ~$97/month

### [aws-infra-poc](./aws-infra-poc)
Comprehensive proof of concept demonstrating the integration of key AWS services (CloudFront, WAF, ALB, EC2, S3, Route 53) with modern development workflows.

**Key Features:**
- Static content delivery via S3 + CloudFront
- API hosting with ALB + EC2
- WAF protection with AWS Managed Rules
- Optional custom domain support
- CI/CD with GitHub Actions

**Estimated Cost:** ~$25-35/month

### [ec2-autoshutdown](./ec2-autoshutdown)
EC2 instance with automatic shutdown capabilities based on inactivity detection to reduce costs.

**Key Features:**
- CloudWatch alarm-based CPU monitoring
- SSH session detection with systemd timers
- Automatic key pair generation and secure storage
- SSM Session Manager support
- Configurable idle thresholds

**Use Case:** Development instances that should stop when not in use

### [trainium-spot](./trainium-spot)
Cost-optimized AWS Trainium1 spot instance for ML workloads with aggressive auto-shutdown.

**Key Features:**
- Spot pricing (up to 90% savings vs on-demand)
- Pre-configured Neuron SDK
- Multi-factor activity detection (SSH, SSM, ML processes, GPU activity)
- Optimized CPU topology (2 cores × 1 thread)
- Fast auto-shutdown (2-minute inactivity)

**Estimated Cost:** ~$0.40/hr (spot) vs $1.34/hr (on-demand)

## Prerequisites

All templates require:
- **Node.js** 18+ or 20+
- **AWS CLI** v2 configured with credentials
- **AWS CDK** CLI: `npm install -g aws-cdk`
- **AWS Account** with appropriate permissions

Some templates use **pnpm** instead of **npm**. Install with:
```bash
npm install -g pnpm
```

## Quick Start

Each template is self-contained in its own directory:

```bash
# Navigate to the template directory
cd <template-name>

# Install dependencies
npm install  # or pnpm install

# Bootstrap CDK (first time only per account/region)
npx cdk bootstrap

# Review changes
npx cdk diff

# Deploy
npx cdk deploy

# Cleanup when done
npx cdk destroy
```

## Authentication

Before deploying, configure AWS credentials:

**Option 1: AWS Configure**
```bash
aws configure
```

**Option 2: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=your-region
```

**Option 3: SSO Login**
```bash
aws configure sso
```

## Documentation

Each template includes comprehensive documentation:
- Architecture diagrams
- Detailed setup instructions
- Configuration options
- Troubleshooting guides
- Cost estimates
- Security considerations

Refer to the individual template READMEs for specific details.

## Cost Management

All templates are designed with cost optimization in mind:
- Use of ARM Graviton instances where applicable
- Auto-shutdown capabilities for development workloads
- Spot instance support for ML workloads
- Configurable resource sizing

**Remember to destroy resources when not in use:**
```bash
npx cdk destroy
```

## Contributing

This repository is open to expansion. Templates are designed to be:
- Self-contained and independently deployable
- Well-documented with clear use cases
- Cost-optimized for PoC and development use
- Production-ready with security best practices

## License

MIT License
