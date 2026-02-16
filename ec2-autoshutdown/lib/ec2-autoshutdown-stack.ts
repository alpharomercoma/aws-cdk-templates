import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

/**
 * EC2 Auto-Shutdown Stack
 *
 * This stack creates an EC2 instance with automatic shutdown capabilities
 * based on inactivity detection. It uses two industry-standard approaches:
 *
 * 1. CloudWatch Alarm (Primary Method):
 *    - Monitors CPU utilization metrics
 *    - Stops the instance when CPU remains below threshold for extended period
 *    - Industry standard for AWS-native inactivity detection
 *
 * 2. SSH Session Detection (Secondary Method):
 *    - User data script monitors active SSH sessions
 *    - Shuts down instance after consecutive checks with no active sessions
 *    - Provides application-level inactivity detection
 *
 * References:
 * - https://aws.amazon.com/blogs/publicsector/reduce-it-costs-by-implementing-automatic-shutdown-for-amazon-ec2-instances/
 * - https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/UsingAlarmActions.html
 */
export class Ec2AutoshutdownStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly cpuAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // VPC Configuration
    // ============================================================
    // Create a new VPC with public subnet for SSH access
    const vpc = new ec2.Vpc(this, 'AutoshutdownVpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // ============================================================
    // Security Group
    // ============================================================
    const securityGroup = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Security group for auto-shutdown EC2 instance',
      allowAllOutbound: true,
    });

    // Allow SSH access (restrict to your IP in production)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );

    // ============================================================
    // EC2 Key Pair (Auto-generated)
    // ============================================================
    // Creates a new key pair and stores the private key in AWS Systems Manager
    // Parameter Store. The private key can be retrieved using:
    // aws ssm get-parameter --name /ec2/keypair/<key-pair-id> --with-decryption
    const keyPair = new ec2.KeyPair(this, 'InstanceKeyPair', {
      keyPairName: `${this.stackName}-keypair`,
      type: ec2.KeyPairType.ED25519,
    });

    // ============================================================
    // IAM Role for EC2
    // ============================================================
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for EC2 instance with SSM access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    // ============================================================
    // User Data Script for SSH Inactivity Detection
    // ============================================================
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# ============================================================',
      '# SSH Inactivity Auto-Shutdown Script',
      '# ============================================================',
      '# This script implements SSH session-based inactivity detection.',
      '# It checks for active SSH sessions every 5 minutes and shuts down',
      '# the instance after 2 consecutive checks (10 minutes) with no activity.',
      '#',
      '# Industry Standard Approach:',
      '# - Uses /var/run/utmp to detect active SSH sessions',
      '# - Implements a grace period to prevent shutdown during brief disconnects',
      '# - Logs all activity for auditing',
      '# ============================================================',
      '',
      '# Configuration',
      'IDLE_CHECK_INTERVAL=300  # Check every 5 minutes',
      'IDLE_THRESHOLD=2         # Shutdown after 2 consecutive idle checks (10 min)',
      'LOG_FILE="/var/log/autoshutdown.log"',
      'STATE_FILE="/var/run/autoshutdown-idle-count"',
      '',
      '# Create the auto-shutdown script',
      'cat > /usr/local/bin/check-ssh-idle.sh << \'SCRIPT\'',
      '#!/bin/bash',
      '',
      'IDLE_THRESHOLD=2',
      'LOG_FILE="/var/log/autoshutdown.log"',
      'STATE_FILE="/var/run/autoshutdown-idle-count"',
      '',
      '# Initialize state file if not exists',
      'if [ ! -f "$STATE_FILE" ]; then',
      '    echo "0" > "$STATE_FILE"',
      'fi',
      '',
      '# Get current idle count',
      'IDLE_COUNT=$(cat "$STATE_FILE")',
      '',
      '# Check for active SSH sessions using who command',
      '# This checks /var/run/utmp for logged-in users',
      'ACTIVE_SESSIONS=$(who | grep -c "pts/" 2>/dev/null || echo "0")',
      '',
      '# Log current state',
      'echo "$(date): Active SSH sessions: $ACTIVE_SESSIONS, Idle count: $IDLE_COUNT" >> "$LOG_FILE"',
      '',
      'if [ "$ACTIVE_SESSIONS" -eq 0 ]; then',
      '    # No active sessions, increment idle counter',
      '    IDLE_COUNT=$((IDLE_COUNT + 1))',
      '    echo "$IDLE_COUNT" > "$STATE_FILE"',
      '    echo "$(date): No active sessions. Idle count incremented to $IDLE_COUNT" >> "$LOG_FILE"',
      '    ',
      '    if [ "$IDLE_COUNT" -ge "$IDLE_THRESHOLD" ]; then',
      '        echo "$(date): Idle threshold reached ($IDLE_THRESHOLD). Initiating shutdown..." >> "$LOG_FILE"',
      '        /sbin/shutdown -h now "Auto-shutdown: No SSH activity detected"',
      '    fi',
      'else',
      '    # Active sessions found, reset counter',
      '    echo "0" > "$STATE_FILE"',
      '    echo "$(date): Active sessions detected. Idle count reset." >> "$LOG_FILE"',
      'fi',
      'SCRIPT',
      '',
      'chmod +x /usr/local/bin/check-ssh-idle.sh',
      '',
      '# Create systemd timer for periodic checks',
      'cat > /etc/systemd/system/autoshutdown.service << EOF',
      '[Unit]',
      'Description=Check for SSH inactivity and shutdown if idle',
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=/usr/local/bin/check-ssh-idle.sh',
      'EOF',
      '',
      'cat > /etc/systemd/system/autoshutdown.timer << EOF',
      '[Unit]',
      'Description=Run SSH inactivity check every 5 minutes',
      '',
      '[Timer]',
      'OnBootSec=10min',
      'OnUnitActiveSec=5min',
      'Unit=autoshutdown.service',
      '',
      '[Install]',
      'WantedBy=timers.target',
      'EOF',
      '',
      '# Enable and start the timer',
      'systemctl daemon-reload',
      'systemctl enable autoshutdown.timer',
      'systemctl start autoshutdown.timer',
      '',
      '# Initialize log file',
      'echo "$(date): Auto-shutdown monitoring initialized" > /var/log/autoshutdown.log',
      'echo "$(date): Idle threshold: 2 checks (10 minutes)" >> /var/log/autoshutdown.log',
      'echo "$(date): Check interval: 5 minutes" >> /var/log/autoshutdown.log',
    );

    // ============================================================
    // EC2 Instance
    // ============================================================
    this.instance = new ec2.Instance(this, 'AutoshutdownInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup,
      role,
      keyPair,

      // Instance type: t4g.large (ARM-based Graviton, 2 vCPUs, 8 GiB)
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.LARGE
      ),

      // Ubuntu ARM64 - Latest LTS (via SSM Parameter)
      // Canonical publishes Ubuntu AMI IDs to AWS SSM Parameter Store
      // See: https://ubuntu.com/server/docs/cloud-images/amazon-ec2
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
        { os: ec2.OperatingSystemType.LINUX }
      ),

      // 30 GiB GP3 root volume
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],

      // Standard credit specification (no burst)
      creditSpecification: ec2.CpuCredits.STANDARD,

      // User data for SSH inactivity detection
      userData,

      // Enable detailed monitoring for CloudWatch
      detailedMonitoring: true,
    });

    // ============================================================
    // CloudWatch Alarm for CPU-based Auto-Stop
    // ============================================================
    // Industry Standard: Stop instance when CPU is below 5% for 15 minutes
    // This indicates the instance is idle with no workload
    this.cpuAlarm = new cloudwatch.Alarm(this, 'CpuIdleAlarm', {
      alarmName: `${this.stackName}-cpu-idle-alarm`,
      alarmDescription:
        'Stop EC2 instance when CPU utilization is below 5% for 15 minutes (inactivity detected)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          InstanceId: this.instance.instanceId,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Add EC2 stop action to the alarm
    this.cpuAlarm.addAlarmAction(
      new cloudwatchActions.Ec2Action(cloudwatchActions.Ec2InstanceAction.STOP)
    );

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: this.instance.instancePublicIp,
      description: 'EC2 Instance Public IP',
    });

    new cdk.CfnOutput(this, 'InstancePublicDnsName', {
      value: this.instance.instancePublicDnsName,
      description: 'EC2 Instance Public DNS Name',
    });

    new cdk.CfnOutput(this, 'AlarmArn', {
      value: this.cpuAlarm.alarmArn,
      description: 'CloudWatch Alarm ARN for CPU idle detection',
    });

    new cdk.CfnOutput(this, 'KeyPairId', {
      value: keyPair.keyPairId,
      description: 'EC2 Key Pair ID',
    });

    new cdk.CfnOutput(this, 'KeyPairName', {
      value: keyPair.keyPairName!,
      description: 'EC2 Key Pair Name',
    });

    new cdk.CfnOutput(this, 'GetPrivateKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} --region ${this.region} --with-decryption --query Parameter.Value --output text > ~/.ssh/${this.stackName}-keypair.pem && chmod 400 ~/.ssh/${this.stackName}-keypair.pem`,
      description: 'Command to retrieve private key from SSM Parameter Store',
    });

    new cdk.CfnOutput(this, 'SshCommand', {
      value: `ssh -i ~/.ssh/${this.stackName}-keypair.pem ubuntu@${this.instance.instancePublicDnsName}`,
      description: 'SSH command to connect to the instance',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'Deployment region',
    });
  }
}
