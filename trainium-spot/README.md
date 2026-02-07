# Trainium Spot Instance - Cost Optimized

A highly cost-optimized AWS CDK stack for deploying an AWS Trainium1 (trn1.2xlarge) spot instance with aggressive auto-shutdown capabilities.

> **⚠️ IMPORTANT**: AWS accounts have **0 vCPUs quota** for Trainium by default. You **MUST** request a quota increase before deployment. See [Service Quota Setup](#service-quota-setup-required) below or read the complete [Quota Guide](QUOTA-GUIDE.md).

## Cost Optimization Features

|Feature|Configuration|Savings|
|-------|-------------|-------|
|**Spot Instance**|Persistent spot request (Interruption: STOP)|Up to 90% vs on-demand|
|**Auto-Shutdown**|2-minute inactivity (script) + 3-minute (CloudWatch)|Prevents idle costs|
|**Minimal Storage**|50 GiB gp3|Reduced EBS costs|
|**CPU Optimization**|2 cores × 1 thread|Reduced per-vCPU charges|
|**Single AZ**|us-east-2c (hardcoded)|No redundancy costs|

## Prerequisites

1.  **Node.js** (v18+) and **pnpm** installed.
2.  **AWS Account** with appropriate Service Quotas (see Service Quota Setup below).
3.  **Environment Variables**: Create a `.env` file in this directory:

    ```bash
    cp .env.example .env  # if example exists, otherwise create new
    ```

    Content of `.env`:
    ```ini
    AWS_ACCESS_KEY_ID=your_access_key
    AWS_SECRET_ACCESS_KEY=your_secret_key
    # AWS_SESSION_TOKEN=... (if using temporary credentials)
    ```

## Service Quota Setup (Required)

**IMPORTANT:** By default, AWS accounts have a quota of **0 vCPUs** for Trainium spot instances. You must request a quota increase before deploying this stack.

### Understanding Trainium Quotas

- **Separate quotas** exist for Inferentia/Trainium, and for Spot/On-Demand instances
- **Quotas are region-specific** - request the increase in your deployment region
- **vCPU-based quotas** - trn1.2xlarge uses 8 vCPUs, so a quota of 8 allows one instance
- **No charge** for quota increases - you only pay for actual usage

### Option 1: Request via AWS Console (Recommended)

1. Navigate to [AWS Service Quotas Console](https://console.aws.amazon.com/servicequotas/)
2. Select your deployment region (e.g., **us-east-2**) in the top-right corner
3. Click **AWS services** in the left panel
4. Search for and select **Amazon Elastic Compute Cloud (Amazon EC2)**
5. Search for **"trn"** or **"Running Dedicated trn Hosts"**
6. Look for: **"Running Dedicated trn Hosts"** (for Spot instances)
7. Click on the quota name, then **Request quota increase**
8. Enter your desired value:
   - **For 1 trn1.2xlarge**: Request **8 vCPUs**
   - **For multiple instances**: Request 8 × number of instances
   - **Recommended for POC**: Request **128 vCPUs** (allows 16 instances)
9. Click **Request** and wait for approval (usually < 1 business day)

### Option 2: Request via AWS CLI

First, find the quota code for your region:

```bash
# Set your deployment region
export AWS_REGION=us-east-2

# List all EC2 quotas related to Trainium
aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region $AWS_REGION \
  --query "Quotas[?contains(QuotaName, 'trn')].{Name:QuotaName,Code:QuotaCode,Value:Value}" \
  --output table
```

Look for the quota named **"Running Dedicated trn Hosts"** and note its `QuotaCode` (e.g., `L-12345678`).

Then request an increase:

```bash
# Replace L-XXXXXXXX with the actual quota code from above
# Replace 128 with your desired vCPU count
aws service-quotas request-service-quota-increase \
  --service-code ec2 \
  --quota-code L-XXXXXXXX \
  --desired-value 128 \
  --region $AWS_REGION
```

### Check Current Quota Status

**Quick Check (Recommended):**

```bash
# Run the automated quota checker script
cd trainium-spot
./check-quota.sh
```

This script will:
- Check if you have sufficient quota
- Show how many instances you can deploy
- Provide exact commands to request increases if needed

**Manual Check:**

```bash
# View current quota (replace L-XXXXXXXX with your quota code)
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-XXXXXXXX \
  --region $AWS_REGION

# Check quota increase request status
aws service-quotas list-requested-service-quota-change-history-by-quota \
  --service-code ec2 \
  --quota-code L-XXXXXXXX \
  --region $AWS_REGION
```

### Important Notes

- **Wait for approval** before deploying - deployment will fail if quota is 0
- **Quotas are free** - you only pay for running instances
- **Regional quotas** - each region requires a separate request
- For production workloads, consider requesting higher quotas upfront

## Troubleshooting & Common Issues

### 1. Max Spot Instance Count Exceeded / Quota Error

**Error message:**
```
Max spot instance count exceeded
OR
You have requested more vCPU capacity than your current vCPU limit
```

**Cause:** Your AWS account has a Spot Instance quota of **0 vCPUs** for Trainium (`trn1`) instances by default.

**Fix:** Follow the [Service Quota Setup](#service-quota-setup-required) section above to request a quota increase. You must do this **before** deploying the stack.

**Quick fix command to check your current quota:**
```bash
export AWS_REGION=us-east-2
aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region $AWS_REGION \
  --query "Quotas[?contains(QuotaName, 'trn')].{Name:QuotaName,Value:Value,Code:QuotaCode}" \
  --output table
```

### 2. Availability Zone Issues

**Error message:**
```
Unsupported availability zone
OR
Insufficient capacity
```

**Cause:** `trn1` instances are not available in all availability zones.

**Fix:** This stack is hardcoded to `us-east-2c`. If you see AZ errors:
1. Check which AZs support trn1 in your region:
   ```bash
   aws ec2 describe-instance-type-offerings \
     --location-type availability-zone \
     --filters Name=instance-type,Values=trn1.2xlarge \
     --region us-east-2 \
     --query 'InstanceTypeOfferings[*].Location' \
     --output table
   ```
2. Update the AZ in [lib/trainium-spot-stack.ts:51](lib/trainium-spot-stack.ts#L51)

### 3. Permissions / AccessDenied

**Cause:** Insufficient IAM permissions for CDK deployment or resource access.

**Fix:**
- **For deployment:** Ensure your AWS credentials have permissions to create EC2, VPC, CloudWatch, and IAM resources
- **For EC2 instance access:** If running from an EC2 instance, ensure the instance role has appropriate permissions
- **For bootstrapping:** Export valid AWS credentials before running `cdk bootstrap`:
  ```bash
  export AWS_ACCESS_KEY_ID=your_key
  export AWS_SECRET_ACCESS_KEY=your_secret
  cdk bootstrap
  ```

### 4. Spot Instance Interruption

**Issue:** Spot instance was stopped/terminated by AWS due to capacity or price changes.

**What happens:**
- Instance is stopped (not terminated) - all data on EBS is preserved
- You can restart it when capacity becomes available

**Fix:**
```bash
export AWS_REGION=us-east-2
export INSTANCE_ID=$(aws ec2 describe-instances \
  --region $AWS_REGION \
  --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION
```

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
# Navigate to project directory
cd trainium-spot

# STEP 1: Check quota (REQUIRED - do this first!)
./check-quota.sh

# If quota is insufficient, follow the script's instructions to request an increase
# Then wait for approval before proceeding

# STEP 2: Install dependencies
pnpm install

# STEP 3: Build
pnpm run build

# STEP 4: Synthesize CloudFormation template (verify without deploying)
pnpm run cdk synth

# STEP 5: Deploy (loads credentials from .env)
# Set your deployment region if different from us-east-2
export AWS_REGION=us-east-2
set -a; source .env; set +a; pnpm run cdk deploy --require-approval never

# STEP 6: After deployment completes, save the stack outputs for later reference
aws cloudformation describe-stacks \
  --stack-name TrainiumSpotStack \
  --region $AWS_REGION \
  --query 'Stacks[0].Outputs' \
  --output table
```

## Connecting to the Instance

### Step 1: Get the Key Pair ID

First, retrieve the Key Pair ID that was created during deployment:

```bash
# Set your deployment region (change if you deployed to a different region)
export AWS_REGION=us-east-2

# Get the Key Pair ID
aws ec2 describe-key-pairs \
  --region $AWS_REGION \
  --query "KeyPairs[?KeyName=='TrainiumSpotStack-keypair'].[KeyPairId]" \
  --output text
```

This will output something like: `key-036076aef37cd875a`

### Step 2: Retrieve the Private Key from SSM Parameter Store

Using the Key Pair ID from Step 1, retrieve the private key:

```bash
# Replace <KEY_PAIR_ID> with the value from Step 1
aws ssm get-parameter \
  --name /ec2/keypair/<KEY_PAIR_ID> \
  --region $AWS_REGION \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

# Set correct permissions
chmod 400 ~/.ssh/trainium-spot.pem
```

**Example with actual Key Pair ID:**
```bash
aws ssm get-parameter \
  --name /ec2/keypair/key-036076aef37cd875a \
  --region us-east-2 \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

chmod 400 ~/.ssh/trainium-spot.pem
```

### Step 3: Get the Instance Public IP

```bash
# Get the instance ID from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name TrainiumSpotStack \
  --region $AWS_REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' \
  --output text

# Get the public IP using the instance ID
aws ec2 describe-instances \
  --region $AWS_REGION \
  --instance-ids <INSTANCE_ID_FROM_ABOVE> \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text
```

### Step 4: SSH to the Instance

```bash
ssh -i ~/.ssh/trainium-spot.pem ubuntu@<INSTANCE_PUBLIC_IP>
```

### Quick Reference: One-Liner Commands

```bash
# Set region
export AWS_REGION=us-east-2

# Get Key Pair ID and save to variable
export KEY_PAIR_ID=$(aws ec2 describe-key-pairs --region $AWS_REGION --query "KeyPairs[?KeyName=='TrainiumSpotStack-keypair'].[KeyPairId]" --output text)

# Download private key
aws ssm get-parameter --name /ec2/keypair/$KEY_PAIR_ID --region $AWS_REGION --with-decryption --query Parameter.Value --output text > ~/.ssh/trainium-spot.pem && chmod 400 ~/.ssh/trainium-spot.pem

# Get instance public IP
export INSTANCE_IP=$(aws ec2 describe-instances --region $AWS_REGION --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# SSH to instance
ssh -i ~/.ssh/trainium-spot.pem ubuntu@$INSTANCE_IP
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
# Set your region
export AWS_REGION=us-east-2

# Option 1: If you know the instance ID
aws ec2 start-instances --instance-ids <INSTANCE_ID> --region $AWS_REGION

# Option 2: Start using the instance name tag
export INSTANCE_ID=$(aws ec2 describe-instances --region $AWS_REGION --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION

# Wait for instance to be running and get the new public IP
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION
aws ec2 describe-instances --region $AWS_REGION --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
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
# Set your region
export AWS_REGION=us-east-2

# Load credentials from .env
set -a; source .env; set +a

# Destroy the stack
pnpm run cdk destroy

# Optional: Verify cleanup
aws cloudformation describe-stacks \
  --stack-name TrainiumSpotStack \
  --region $AWS_REGION 2>&1 | grep -q "does not exist" && echo "Stack successfully deleted" || echo "Stack still exists"
```
