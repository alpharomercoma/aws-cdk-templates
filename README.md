# AWS CDK Templates

Collection of AWS CDK infrastructure templates and management utilities.

## Management Tools

### 🚀 Deploy CDK Template
Deploy any CDK template with guided prompts.

```bash
./deploy-cdk-project.sh
# Select template → install deps → deploy → optionally create start script
```

**Features:** Auto-discovery, dependency management, CDK bootstrap check, EC2 integration

### 💻 EC2 Instance Launcher
Create one-command starters for EC2 instances (works with deployed templates).

```bash
./create-start-script.sh
# Creates: start-aws-<project-name>

start-aws-<project-name>  # Start + auto-configure SSH
ssh <project-name>         # Connect
```

**Features:** Multi-region discovery, automatic SSH config, desktop notifications

### 🔥 Destroy CDK Stack
Safely destroy CDK stacks with confirmation prompts.

```bash
./destroy-cdk-project.sh
```

⚠️ **WARNING**: Permanently deletes AWS resources.

📖 **Documentation**: See [docs/](docs/) for guides

---

## Available Templates

### [aws-3tier-app](./aws-3tier-app)
Production-grade 3-tier architecture with PostgreSQL RDS, ElastiCache Redis, EC2, ALB, CloudFront, and WAF.

**Cost:** ~$97/month

### [aws-infra-poc](./aws-infra-poc)
Static + dynamic content hosting with CloudFront, S3, ALB, and EC2.

**Cost:** ~$25-35/month

### [ec2-autoshutdown](./ec2-autoshutdown)
EC2 instance with auto-shutdown based on inactivity (CPU/SSH detection).

**Use Case:** Cost-saving dev instances

### [trainium-spot](./trainium-spot)
Cost-optimized Trainium1 spot instance for ML workloads with aggressive auto-shutdown.

**Cost:** ~$0.40/hr (spot) vs $1.34/hr (on-demand)

---

## Quick Start

```bash
# Navigate to template
cd <template-name>

# Install dependencies
npm install  # or pnpm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy
npx cdk deploy

# Destroy when done
npx cdk destroy
```

## Prerequisites

- Node.js 18+
- AWS CLI v2 configured
- AWS CDK CLI: `npm install -g aws-cdk`
- AWS account with appropriate permissions

Some templates use pnpm:
```bash
npm install -g pnpm
```

## Authentication

```bash
# Option 1: AWS Configure
aws configure

# Option 2: Environment Variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_DEFAULT_REGION=your-region

# Option 3: SSO
aws configure sso
```

## Documentation

See [docs/](docs/) for management tools guides. Each CDK template has its own README with architecture and setup instructions.

## License

MIT
