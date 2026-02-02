# Trainium Spot Instance - Cost Optimized

A highly cost-optimized AWS CDK stack for deploying an AWS Trainium1 (trn1.2xlarge) spot instance with aggressive auto-shutdown capabilities.

## Cost Optimization Features

| Feature | Configuration | Savings |
|---------|---------------|---------|
| **Spot Instance** | One-time spot request | Up to 90% vs on-demand |
| **Auto-Shutdown** | 2-minute inactivity (script) + 3-minute (CloudWatch) | Prevents idle costs |
| **Minimal Storage** | 50 GiB gp3 | Reduced EBS costs |
| **CPU Optimization** | 2 cores × 1 thread | Reduced per-vCPU charges |
| **Single AZ** | No NAT gateway | No redundancy costs |

## Instance Specifications

- **Instance Type**: trn1.2xlarge (Trainium1)
- **Region**: us-east-2
- **OS**: Ubuntu 24.04 LTS (x86_64/amd64)
- **CPU**: 2 cores × 1 thread = 2 vCPUs (reduced from default 8 vCPUs)
- **Storage**: 50 GiB gp3 (encrypted, 3000 IOPS, 125 MB/s)
- **Accelerator**: 1× Trainium chip (16 NeuronCores)
- **Memory**: 32 GiB

## Auto-Shutdown Mechanisms

### 1. CloudWatch CPU Alarm (Primary)
- Monitors CPU utilization every 1 minute
- Stops instance when CPU < 3% for 3 consecutive minutes
- Uses EC2 stop action to preserve instance state
- `treatMissingData: NOT_BREACHING` prevents false triggers

### 2. SSH/Activity Detection (Secondary)
- Systemd timer checks every 1 minute
- 5-minute boot grace period for initial connection
- Detects multiple activity types:
  - Active SSH sessions (pts terminals)
  - SSM Session Manager connections
  - Screen/tmux sessions
  - Neuron compiler and runtime processes
  - ML training/inference scripts
  - Neuron device activity
  - CPU usage > 10%
  - Memory usage > 80%
- File locking prevents race conditions
- Shuts down after 2 consecutive idle checks

### Edge Cases Handled
- **Boot period**: 5-minute grace period prevents premature shutdown
- **SSM sessions**: Detects AWS Systems Manager sessions
- **Detached sessions**: Detects screen/tmux even when SSH disconnected
- **ML workloads**: Specific patterns for Neuron, PyTorch, training scripts
- **GPU activity**: Checks Neuron device utilization if available
- **Memory pressure**: High memory often indicates training in progress
- **Race conditions**: File locking prevents concurrent checks

## Deployment

```bash
# Install dependencies
cd trainium-spot
pnpm install

# Build
pnpm run build

# Synthesize CloudFormation template (verify without deploying)
pnpm run cdk synth

# Deploy
pnpm run cdk deploy
```

## Connecting to the Instance

```bash
# Get private key from SSM Parameter Store
aws ssm get-parameter \
  --name /ec2/keypair/<KEY_PAIR_ID> \
  --region us-east-2 \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

chmod 400 ~/.ssh/trainium-spot.pem

# SSH to instance
ssh -i ~/.ssh/trainium-spot.pem ubuntu@<INSTANCE_PUBLIC_IP>
```

## Monitoring Auto-Shutdown

```bash
# View auto-shutdown logs
sudo tail -f /var/log/autoshutdown.log

# Check timer status
systemctl status autoshutdown.timer

# Manually trigger check
sudo /usr/local/bin/check-ssh-idle.sh
```

## Neuron SDK

The instance comes pre-configured with AWS Neuron SDK for Trainium:

```bash
# Verify Neuron installation
neuron-ls

# Check Neuron runtime
neuron-top
```

## Starting a Stopped Instance

Since the instance uses spot pricing with stop interruption behavior:

```bash
aws ec2 start-instances --instance-ids <INSTANCE_ID> --region us-east-2
```

## Cost Estimates

| Component | On-Demand | Spot (est.) |
|-----------|-----------|-------------|
| trn1.2xlarge | $1.3438/hr | ~$0.40/hr |
| 50 GiB gp3 | $4.00/mo | $4.00/mo |

**Note**: Spot prices fluctuate. Check current pricing in AWS console.

## Testing

```bash
# Run unit tests
pnpm test

# Run tests with coverage
pnpm test -- --coverage
```

## Architecture

```
┌─────────────────────────────────────────┐
│                  VPC                     │
│  ┌───────────────────────────────────┐  │
│  │         Public Subnet (1 AZ)       │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │   trn1.2xlarge (Spot)       │  │  │
│  │  │   - Ubuntu 24.04            │  │  │
│  │  │   - 50 GiB gp3              │  │  │
│  │  │   - 2 cores × 1 thread      │  │  │
│  │  │   - Neuron SDK              │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│        CloudWatch Alarm                  │
│   CPU < 3% for 2 min → STOP             │
└─────────────────────────────────────────┘
```

## Cleanup

```bash
pnpm run cdk destroy
```
