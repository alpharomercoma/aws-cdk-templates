# Trainium Spot Instance - Quick Start Guide

This guide will help you deploy and connect to your Trainium instance in a few simple steps.

## Prerequisites

- Node.js v18+
- pnpm installed
- AWS credentials with appropriate permissions
- **Service Quota for Trainium Spot Instances** (see Step 0 below)

## Step 0: Request Service Quota (First Time Only)

**CRITICAL:** AWS accounts have **0 vCPUs** quota for Trainium spot instances by default. You must request an increase before deployment.

### Quick Method (AWS Console):

1. Go to [AWS Service Quotas Console](https://console.aws.amazon.com/servicequotas/)
2. Select region **us-east-2** (or your deployment region)
3. Click **AWS services** → Search for **Amazon EC2**
4. Search for **"Running Dedicated trn Hosts"**
5. Click the quota → **Request quota increase**
6. Enter **8** (for 1 instance) or **128** (recommended for POC)
7. Click **Request**
8. Wait for approval (~few hours to 1 business day)

### Automated Check (Easiest):

```bash
cd trainium-spot
./check-quota.sh
```

This script checks your quota and tells you exactly what to do.

### Manual Check:

```bash
# Check your current quota
export AWS_REGION=us-east-2
aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region $AWS_REGION \
  --query "Quotas[?contains(QuotaName, 'trn')].{Name:QuotaName,Current:Value}" \
  --output table
```

If you see **0** for "Running Dedicated trn Hosts", you need to request an increase.

**⚠️ DO NOT PROCEED** to deployment until your quota is approved!

## Step 1: Setup Environment

```bash
cd trainium-spot

# Create .env file with your AWS credentials
cat > .env << 'EOF'
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
EOF

# Set your deployment region (change if needed)
export AWS_REGION=us-east-2
```

## Step 2: Deploy the Stack

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Deploy (this will take 3-5 minutes)
set -a; source .env; set +a
pnpm run cdk deploy --require-approval never
```

Wait for deployment to complete. You'll see "✅ TrainiumSpotStack" when done.

## Step 3: Retrieve SSH Key

### 3a. Get the Key Pair ID

```bash
# List all key pairs and find yours
aws ec2 describe-key-pairs \
  --region $AWS_REGION \
  --query "KeyPairs[*].[KeyName,KeyPairId]" \
  --output table
```

Look for `TrainiumSpotStack-keypair` in the output. Copy the Key Pair ID (e.g., `key-036076aef37cd875a`).

### 3b. Download the Private Key

```bash
# Replace <KEY_PAIR_ID> with the value from step 3a
aws ssm get-parameter \
  --name /ec2/keypair/<KEY_PAIR_ID> \
  --region $AWS_REGION \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

# Set correct permissions
chmod 400 ~/.ssh/trainium-spot.pem
```

**Example:**
```bash
# If your Key Pair ID is key-036076aef37cd875a
aws ssm get-parameter \
  --name /ec2/keypair/key-036076aef37cd875a \
  --region us-east-2 \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

chmod 400 ~/.ssh/trainium-spot.pem
```

## Step 4: Get Instance IP Address

```bash
# Get the instance public IP
aws ec2 describe-instances \
  --region $AWS_REGION \
  --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text
```

Copy the IP address (e.g., `3.145.123.45`).

## Step 5: Connect via SSH

```bash
# Replace <INSTANCE_IP> with the value from step 4
ssh -i ~/.ssh/trainium-spot.pem ubuntu@<INSTANCE_IP>
```

**Example:**
```bash
ssh -i ~/.ssh/trainium-spot.pem ubuntu@3.145.123.45
```

## All-in-One Script

For convenience, here's a complete script that does everything after deployment:

```bash
# Set your region
export AWS_REGION=us-east-2

# Get Key Pair ID
export KEY_PAIR_ID=$(aws ec2 describe-key-pairs \
  --region $AWS_REGION \
  --query "KeyPairs[?KeyName=='TrainiumSpotStack-keypair'].[KeyPairId]" \
  --output text)

echo "Key Pair ID: $KEY_PAIR_ID"

# Download private key
aws ssm get-parameter \
  --name /ec2/keypair/$KEY_PAIR_ID \
  --region $AWS_REGION \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/trainium-spot.pem

chmod 400 ~/.ssh/trainium-spot.pem

# Get instance IP
export INSTANCE_IP=$(aws ec2 describe-instances \
  --region $AWS_REGION \
  --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

echo "Instance IP: $INSTANCE_IP"

# Connect
ssh -i ~/.ssh/trainium-spot.pem ubuntu@$INSTANCE_IP
```

## Verification

Once connected, verify the Neuron SDK installation:

```bash
# Check Neuron devices
neuron-ls

# Monitor Neuron activity
neuron-top
```

## Auto-Shutdown

The instance will automatically shut down after:
- 2 minutes of inactivity (no SSH, no processes)
- 3 minutes of CPU usage < 3%

To restart a stopped instance:

```bash
# Get instance ID
export INSTANCE_ID=$(aws ec2 describe-instances \
  --region $AWS_REGION \
  --filters "Name=tag:Name,Values=TrainiumSpotStack-trainium" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Start instance
aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION

# Wait for running state
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION

# Get new IP (spot instances may get different IPs)
aws ec2 describe-instances \
  --region $AWS_REGION \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text
```

## Cleanup

When you're done:

```bash
set -a; source .env; set +a
pnpm run cdk destroy
```

## Troubleshooting

### "Max spot instance count exceeded" or vCPU limit error
- **Cause:** Your Trainium spot quota is 0 (default for new accounts)
- **Fix:** Complete Step 0 above to request a quota increase
- **Check status:** Run the quota check command from Step 0

### "ParameterNotFound" error
- **Cause:** Using wrong Key Pair ID
- **Fix:** Run step 3a again to get the correct ID

### "Permission denied (publickey)"
- **Cause:** Wrong permissions or wrong key/IP
- **Fix:**
  - Check permissions: `chmod 400 ~/.ssh/trainium-spot.pem`
  - Verify you're using the correct key file and IP address

### "Unsupported availability zone"
- **Cause:** trn1 not available in that AZ
- **Fix:** Check which AZs support trn1:
  ```bash
  aws ec2 describe-instance-type-offerings \
    --location-type availability-zone \
    --filters Name=instance-type,Values=trn1.2xlarge \
    --region us-east-2 \
    --query 'InstanceTypeOfferings[*].Location'
  ```

### Instance not found or stopped
- **Cause:** Instance auto-shut down due to inactivity OR spot interruption
- **Fix:** Check instance state and start it if needed (see Auto-Shutdown section)

For more details, see the main [README.md](README.md).
