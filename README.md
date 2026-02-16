# AWS CDK Templates

AWS infrastructure templates using CDK (TypeScript).

## Templates

### [ec2-autoshutdown](./ec2-autoshutdown)

EC2 instance with automatic shutdown on inactivity (CPU monitoring + SSH session detection).

| Property | Value |
|----------|-------|
| Instance | t4g.large (ARM Graviton) |
| OS | Ubuntu 24.04 LTS |
| Region | ap-southeast-1 (Singapore) |
| Storage | 30 GiB GP3 (encrypted) |
| Cost | ~$64/mo (running 24/7) |

### [trainium-spot](./trainium-spot)

Cost-optimized Trainium1 spot instance for ML workloads with auto-shutdown.

| Property | Value |
|----------|-------|
| Instance | trn1.2xlarge (Spot) |
| OS | Ubuntu 24.04 LTS |
| Region | us-east-1 (N. Virginia) |
| Storage | 50 GiB GP3 (encrypted) |
| Cost | ~$0.40/hr (spot) vs $1.34/hr (on-demand) |

> **Note:** Trainium instances require a [service quota increase](https://console.aws.amazon.com/servicequotas/) before deployment. Request quota for "Running Dedicated trn Hosts" in your deployment region.

## Quick Start

```bash
cd <template-name>
npm install          # or: pnpm install
npx cdk bootstrap   # first time only
npx cdk deploy
```

## Prerequisites

- Node.js 18+
- AWS CLI v2 (`aws configure`)
- AWS CDK CLI (`npm install -g aws-cdk`)

## Helper Scripts

| Script | Description |
|--------|-------------|
| `create-start-script.sh` | Generate a one-command launcher for EC2 instances |
| `destroy-project.sh` | Safely destroy CDK stacks with confirmation |

## License

MIT
