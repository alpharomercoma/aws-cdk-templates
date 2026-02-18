# EC2 Auto-Shutdown

EC2 instance with automatic shutdown on inactivity detection.

## Specifications

| Property | Value |
|----------|-------|
| Instance Type | t4g.large (ARM Graviton) |
| vCPUs / Memory | 2 vCPUs / 8 GiB |
| OS | Ubuntu 24.04 LTS (ARM64) |
| Region | ap-southeast-1 (Singapore) |
| Storage | 30 GiB GP3 (encrypted) |
| Credit Spec | Standard (no burst) |

## Auto-Shutdown

### CloudWatch Alarm (Observability)

Monitors CPU utilization via CloudWatch and raises an idle signal when average CPU stays below 5% for 15 minutes (3 × 5-min periods).

### Multi-Signal Idle Detection (Primary Shutdown Path)

Systemd timer runs every 5 minutes and evaluates:
- SSH sessions / sshd child processes / screen-tmux sessions
- CPU busy percentage
- Network throughput (combined RX+TX)
- Disk I/O (combined read/write IOPS and throughput)

Shutdown decision uses a quorum model:
- `SSH/session signals are idle` **AND**
- at least `2 of 3` workload-idle signals are idle (`CPU`, `Network`, `Disk`)
- for `2` consecutive checks (`10` minutes), with a 10-minute boot grace period

## Architecture

```
EC2 Instance (t4g.large)
├── CloudWatch Alarm (CPU < 5%, 15 min) for visibility
└── Systemd Timer (multi-signal quorum, 10 min) → shutdown -h now
```

## Deploy

```bash
cd ec2-autoshutdown
npm install
npx cdk bootstrap   # first time only
npx cdk deploy -c sshAllowedCidr="$(curl -s https://checkip.amazonaws.com)/32"
```

Default SSH ingress is `127.0.0.1/32`. Set `sshAllowedCidr` explicitly at deploy time to allow remote SSH.

## Connect

```bash
# Get Key Pair ID
export AWS_REGION=ap-southeast-1
export KEY_PAIR_ID=$(aws ec2 describe-key-pairs --region $AWS_REGION \
  --query "KeyPairs[?KeyName=='Ec2AutoshutdownStack-keypair'].[KeyPairId]" --output text)

# Download private key from SSM
aws ssm get-parameter --name /ec2/keypair/$KEY_PAIR_ID --region $AWS_REGION \
  --with-decryption --query Parameter.Value --output text \
  > ~/.ssh/ec2-autoshutdown.pem && chmod 400 ~/.ssh/ec2-autoshutdown.pem

# Get instance IP
export IP=$(aws ec2 describe-instances --region $AWS_REGION \
  --filters "Name=tag:Name,Values=Ec2AutoshutdownStack*" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# SSH
ssh -i ~/.ssh/ec2-autoshutdown.pem ubuntu@$IP
```

## Restart After Shutdown

```bash
export AWS_REGION=ap-southeast-1
export INSTANCE_ID=$(aws ec2 describe-instances --region $AWS_REGION \
  --filters "Name=tag:Name,Values=Ec2AutoshutdownStack*" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

aws ec2 start-instances --instance-ids $INSTANCE_ID --region $AWS_REGION
```

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| t4g.large (730 hrs) | ~$60.74 |
| 30 GiB GP3 EBS | ~$2.88 |
| **Total (24/7)** | **~$64** |

With auto-shutdown, actual costs depend on usage.

## Cleanup

```bash
npx cdk destroy
```
