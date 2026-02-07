# AWS Trainium Spot Instance Quota Guide

This guide explains everything you need to know about AWS Service Quotas for Trainium spot instances.

## Why You Need This

**By default, all AWS accounts have a quota of 0 vCPUs for Trainium instances.** This means you cannot deploy any Trainium instances until you request and receive approval for a quota increase.

## Understanding Trainium Quotas

### Key Concepts

1. **Quotas are vCPU-based**: Each instance type uses a specific number of vCPUs
   - `trn1.2xlarge` = 8 vCPUs
   - `trn1.32xlarge` = 128 vCPUs
   - `trn2.48xlarge` = 192 vCPUs

2. **Separate quotas exist for**:
   - Spot vs On-Demand instances
   - Trainium (trn) vs Inferentia (inf) instances
   - Each AWS region

3. **Quota flexibility**: A quota of 128 vCPUs can be used as:
   - 16× trn1.2xlarge instances, OR
   - 1× trn1.32xlarge instance

4. **No cost for quotas**: Quotas are free - you only pay for actual running instances

## Quick Start: Check Your Quota

### Automated Check (Recommended)

```bash
cd trainium-spot
./check-quota.sh
```

The script will:
- ✅ Check your current quota
- ✅ Tell you if you can deploy
- ✅ Provide exact commands to request increases
- ✅ Show how many instances you can run

### Manual Check

```bash
export AWS_REGION=us-east-2

aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region $AWS_REGION \
  --query "Quotas[?contains(QuotaName, 'trn')].{Name:QuotaName,Value:Value,Code:QuotaCode}" \
  --output table
```

Look for: **"Running Dedicated trn Hosts"**

## Requesting a Quota Increase

### Method 1: AWS Console (Easiest)

1. **Navigate to Service Quotas**
   - Go to: https://console.aws.amazon.com/servicequotas/
   - Select your deployment region (e.g., us-east-2)

2. **Find the Trainium Quota**
   - Click "AWS services" in the left panel
   - Select "Amazon Elastic Compute Cloud (Amazon EC2)"
   - Search for: "trn" or "Running Dedicated trn Hosts"

3. **Request Increase**
   - Click on "Running Dedicated trn Hosts"
   - Click "Request quota increase"
   - Enter your desired value:
     - **8 vCPUs** = 1 instance (minimum)
     - **64 vCPUs** = 8 instances (small POC)
     - **128 vCPUs** = 16 instances (recommended)
     - **256 vCPUs** = 32 instances (production)

4. **Submit and Wait**
   - Click "Request"
   - Approval typically takes: **few hours to 1 business day**
   - You'll receive an email when approved

### Method 2: AWS CLI

**Step 1: Find the Quota Code**

```bash
export AWS_REGION=us-east-2

aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region $AWS_REGION \
  --query "Quotas[?contains(QuotaName, 'Running Dedicated trn Hosts')].{Name:QuotaName,Code:QuotaCode}" \
  --output table
```

Note the `QuotaCode` (format: `L-XXXXXXXX`)

**Step 2: Request Increase**

```bash
# Replace L-XXXXXXXX with your actual quota code
# Replace 128 with your desired vCPU count

aws service-quotas request-service-quota-increase \
  --service-code ec2 \
  --quota-code L-XXXXXXXX \
  --desired-value 128 \
  --region $AWS_REGION
```

**Step 3: Check Request Status**

```bash
aws service-quotas list-requested-service-quota-change-history-by-quota \
  --service-code ec2 \
  --quota-code L-XXXXXXXX \
  --region $AWS_REGION \
  --query 'RequestedQuotas[0].Status'
```

Status values:
- `PENDING` = Under review
- `CASE_OPENED` = Support case created
- `APPROVED` = Increase approved (you can deploy!)
- `DENIED` = Request denied (contact AWS support)

## Recommended Quota Values

| Use Case | Recommended vCPUs | Number of trn1.2xlarge |
|----------|-------------------|------------------------|
| Testing/Learning | 8 | 1 |
| Small POC | 64 | 8 |
| **Recommended** | **128** | **16** |
| Production | 256+ | 32+ |

**Pro tip**: Request more than you immediately need. Quotas are free, and having headroom prevents delays when scaling up.

## Common Issues and Solutions

### ❌ "Max spot instance count exceeded"

**Cause**: Your quota is 0 or insufficient

**Solution**: Request a quota increase and wait for approval

### ❌ "Request denied"

**Cause**: AWS may deny increases for new accounts or unusual patterns

**Solution**:
1. Contact AWS Support with your use case
2. Start with a smaller request (e.g., 64 vCPUs)
3. Build usage history, then request more

### ❌ "Service quota does not exist"

**Cause**: Trainium is not available in your selected region

**Solution**: Use a supported region:
- us-east-1 (N. Virginia)
- us-east-2 (Ohio) ← This stack's default
- us-west-2 (Oregon)

### ⚠️ Quota approved but deployment still fails

**Cause**: Approval can take a few minutes to propagate

**Solution**: Wait 5-10 minutes after approval email, then try deploying again

## Regional Availability

Trainium instances are available in limited regions:

| Region | Region Code | Availability |
|--------|-------------|--------------|
| US East (N. Virginia) | us-east-1 | ✅ Available |
| **US East (Ohio)** | **us-east-2** | ✅ **Available (default)** |
| US West (Oregon) | us-west-2 | ✅ Available |
| Other regions | various | ❌ Not available |

**Important**: Quotas are region-specific. If you need instances in multiple regions, request quotas for each region separately.

## Best Practices

### 1. Request Quotas Early
- Request quotas **before** you need them
- Approval can take up to 1 business day
- Don't wait until you're ready to deploy

### 2. Request Generously
- Quotas are free - only running instances cost money
- Request 2-3x what you think you'll need
- Easier to have quota and not use it than to wait for increases

### 3. Document Your Use Case
- When requesting large quotas (256+ vCPUs), include a description
- Mention you're using it for ML/AI workloads
- Helps AWS approve your request faster

### 4. Monitor Your Usage
```bash
# Check how much quota you're using
aws ec2 describe-instances \
  --region $AWS_REGION \
  --filters "Name=instance-type,Values=trn1.*" "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceType,InstanceId]' \
  --output table
```

### 5. Clean Up Unused Instances
- Stopped instances don't count toward quota
- Terminated instances free up quota immediately
- Use auto-shutdown to prevent unnecessary quota usage

## References

- [AWS Service Quotas Documentation](https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html)
- [Inferentia and Trainium Service Quotas](https://repost.aws/articles/ARgmEMvbR6Re200FQs8rTduA/inferentia-and-trainium-service-quotas)
- [Spot Instance Quotas](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-spot-limits.html)
- [Request Service Quota Increase via CLI](https://repost.aws/knowledge-center/request-service-quota-increase-cli)

## Need Help?

1. **Run the quota checker**: `./check-quota.sh`
2. **Check the troubleshooting section**: See [README.md](README.md#troubleshooting--common-issues)
3. **Contact AWS Support**: If your request is denied or you need help
4. **Review the main documentation**: See [README.md](README.md) for complete setup guide
