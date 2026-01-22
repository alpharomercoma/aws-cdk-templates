# EC2 Auto-Shutdown CDK Stack

This AWS CDK project deploys an EC2 instance with automatic shutdown capabilities based on inactivity detection. It implements industry-standard approaches to reduce costs by stopping idle instances.

## Instance Specifications

| Property | Value |
|----------|-------|
| Instance Type | t4g.small (ARM-based Graviton) |
| Region | ap-southeast-1 (Singapore) |
| OS | Ubuntu 24.04 LTS |
| Architecture | 64-bit ARM (aarch64) |
| Storage | 30 GiB GP3 (encrypted) |
| Credit Specification | Standard (no burst) |

## Auto-Shutdown Methods

This stack implements two industry-standard approaches for inactivity detection:

### 1. CloudWatch Alarm (Primary Method)

The primary method uses Amazon CloudWatch to monitor CPU utilization and automatically stop the instance when it's idle.

**How it works:**
- Monitors CPU utilization every 5 minutes (detailed monitoring enabled)
- Triggers when average CPU is below 5% for 3 consecutive periods (15 minutes)
- Automatically executes EC2 Stop action via CloudWatch Alarm Actions

**Why this approach:**
- AWS-native solution requiring no agents or scripts
- Recommended by [AWS Public Sector Blog](https://aws.amazon.com/blogs/publicsector/reduce-it-costs-by-implementing-automatic-shutdown-for-amazon-ec2-instances/)
- Documented in [AWS EC2 User Guide - Alarm Actions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/UsingAlarmActions.html)
- Works even if SSH session is active but no actual work is being performed

**Configuration:**
```
Metric: CPUUtilization
Threshold: < 5%
Evaluation Periods: 3 (15 minutes total)
Action: EC2 Stop
```

### 2. SSH Session Detection (Secondary Method)

A secondary method using a systemd timer that monitors active SSH sessions on the instance.

**How it works:**
- A systemd timer runs every 5 minutes
- Checks for active SSH sessions using the `who` command (reads `/var/run/utmp`)
- Maintains an idle counter that increments when no sessions are found
- Shuts down after 2 consecutive idle checks (10 minutes) with no active sessions
- Resets counter immediately when an active session is detected

**Why this approach:**
- Application-level detection complementing infrastructure metrics
- Prevents shutdown during active SSH work sessions regardless of CPU usage
- Implements grace period to handle brief disconnections
- Logs all activity to `/var/log/autoshutdown.log` for auditing

**Configuration:**
```
Check Interval: 5 minutes
Idle Threshold: 2 consecutive checks (10 minutes)
Grace Period: 10 minutes after boot (OnBootSec=10min)
Log File: /var/log/autoshutdown.log
```

## Cost Optimization

- **Stopped instances**: You don't pay for compute on stopped EC2 instances
- **Data retention**: Stopped instances retain their private IP, instance configuration, root EBS volume, and all data
- **Restart**: Simply start the instance again when needed via AWS Console, CLI, or API

## Architecture

```
+-------------------+     +--------------------+     +------------------+
|   EC2 Instance    |     |  CloudWatch Alarm  |     |  CloudWatch      |
|   (t4g.small)     |---->|  (CPU < 5% for     |---->|  Alarm Action    |
|                   |     |   15 minutes)      |     |  (EC2 Stop)      |
+-------------------+     +--------------------+     +------------------+
        |
        | (internal)
        v
+-------------------+
|  Systemd Timer    |
|  (SSH session     |
|   monitoring)     |
+-------------------+
```

## Prerequisites

- Node.js 18+ and npm
- AWS CLI v2 (see installation below)
- AWS CDK CLI (`npm install -g aws-cdk`)

### Install AWS CLI (if not installed)

**Ubuntu/Debian (ARM64):**
```bash
cd /tmp
curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip && sudo ./aws/install
rm -rf aws awscliv2.zip
```

**Ubuntu/Debian (x86_64):**
```bash
cd /tmp
curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip && sudo ./aws/install
rm -rf aws awscliv2.zip
```

**macOS:**
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

### AWS Authentication

**Option A: Browser Login via SSO (if your organization uses AWS IAM Identity Center)**
```bash
aws configure sso
# Enter your SSO start URL (get this from your IT admin)
# A browser will open - just click to login
```

**Option B: Access Keys (for personal AWS accounts)**

1. Go to https://console.aws.amazon.com and login
2. Click your name (top right) → **Security credentials**
3. Scroll to **Access keys** → **Create access key**
4. Select "Command Line Interface (CLI)" → Check the confirmation → **Next** → **Create access key**
5. Copy both keys (you won't see the secret again!)

Then run:
```bash
aws configure
```
```
AWS Access Key ID: <paste your access key>
AWS Secret Access Key: <paste your secret key>
Default region name: ap-southeast-1
Default output format: <just press Enter>
```

**Option C: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=ap-southeast-1
```

## Deployment

1. **Install dependencies:**
   ```bash
   cd ec2-autoshutdown
   npm install
   ```

2. **Bootstrap CDK (first time only):**
   ```bash
   cdk bootstrap
   ```
   CDK automatically uses your configured AWS credentials and deploys to ap-southeast-1 (hardcoded in the stack).

3. **Deploy the stack:**
   ```bash
   cdk deploy
   ```

4. **Note the outputs** - The deployment will output:
   - Instance ID
   - Public IP
   - Public DNS Name
   - CloudWatch Alarm ARN
   - Key Pair ID
   - Command to retrieve private key
   - SSH command

## Connecting to the Instance

### Option 1: SSH with Auto-Generated Key Pair (Recommended)

The stack automatically creates an ED25519 key pair and stores the private key securely in AWS Systems Manager Parameter Store.

**Step 1: Retrieve the private key**

After deployment, run the command from the `GetPrivateKeyCommand` output:
```bash
aws ssm get-parameter \
  --name /ec2/keypair/<KEY_PAIR_ID> \
  --region ap-southeast-1 \
  --with-decryption \
  --query Parameter.Value \
  --output text > ~/.ssh/Ec2AutoshutdownStack-keypair.pem

chmod 400 ~/.ssh/Ec2AutoshutdownStack-keypair.pem
```

**Step 2: Connect via SSH**

Use the command from the `SshCommand` output:
```bash
ssh -i ~/.ssh/Ec2AutoshutdownStack-keypair.pem ubuntu@<PUBLIC_DNS_NAME>
```

### Option 2: AWS Systems Manager Session Manager

The instance has SSM agent and appropriate IAM role pre-configured. Connect via:
```bash
aws ssm start-session --target <INSTANCE_ID> --region ap-southeast-1
```

Or use the AWS Console: EC2 > Instances > Select Instance > Connect > Session Manager

## Monitoring Auto-Shutdown

### CloudWatch Alarm Status

Check the alarm status in AWS Console:
- Navigate to CloudWatch > Alarms
- Look for `Ec2AutoshutdownStack-cpu-idle-alarm`

Or via CLI:
```bash
aws cloudwatch describe-alarms \
  --alarm-names "Ec2AutoshutdownStack-cpu-idle-alarm" \
  --region ap-southeast-1
```

### SSH Session Monitoring Logs

SSH into the instance and check the log file:
```bash
sudo cat /var/log/autoshutdown.log
```

Check timer status:
```bash
systemctl status autoshutdown.timer
systemctl list-timers autoshutdown.timer
```

## Customization

### Adjust CloudWatch Alarm Thresholds

In `lib/ec2-autoshutdown-stack.ts`:

```typescript
this.cpuAlarm = new cloudwatch.Alarm(this, 'CpuIdleAlarm', {
  // ...
  threshold: 10,           // Change CPU threshold (default: 5%)
  evaluationPeriods: 6,    // Change evaluation periods (default: 3 = 15min)
  // ...
});
```

### Adjust SSH Session Detection

The user data script can be modified to change:
- `IDLE_CHECK_INTERVAL`: How often to check (default: 300 seconds)
- `IDLE_THRESHOLD`: Consecutive idle checks before shutdown (default: 2)
- `OnBootSec`: Grace period after boot (default: 10 minutes)

### Disable SSH Session Detection

Remove or comment out the `userData.addCommands(...)` section if you only want CloudWatch-based detection.

## Security Considerations

1. **SSH Key Pair**: The private key is stored encrypted in AWS Systems Manager Parameter Store under `/ec2/keypair/<key-pair-id>`. Access is controlled by IAM policies. The key is automatically deleted when the stack is destroyed.

2. **SSH Access**: The security group allows SSH from anywhere (0.0.0.0/0). For production, restrict to specific IP ranges:
   ```typescript
   securityGroup.addIngressRule(
     ec2.Peer.ipv4('YOUR_IP/32'),
     ec2.Port.tcp(22),
     'Allow SSH from specific IP'
   );
   ```

3. **EBS Encryption**: Root volume is encrypted by default with AWS-managed keys.

4. **IAM Role**: The instance has SSM access only. Add additional policies as needed.

## Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Cleanup

To avoid ongoing charges, destroy the stack when no longer needed:

```bash
cdk destroy
```

This will terminate the EC2 instance and delete all associated resources including the VPC, security groups, and CloudWatch alarm.

## References

- [AWS Blog: Reduce IT costs by implementing automatic shutdown for Amazon EC2 instances](https://aws.amazon.com/blogs/publicsector/reduce-it-costs-by-implementing-automatic-shutdown-for-amazon-ec2-instances/)
- [AWS Docs: Create alarms that stop, terminate, reboot, or recover an instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/UsingAlarmActions.html)
- [AWS CDK EC2 Module Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2-readme.html)
- [AWS CDK CloudWatch Module Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch-readme.html)
