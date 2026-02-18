import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
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
      ],
    });

    // ============================================================
    // User Data Script for Multi-Signal Inactivity Detection
    // ============================================================
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# ============================================================',
      '# Multi-Signal Inactivity Auto-Shutdown Script',
      '# ============================================================',
      '# This script implements robust inactivity detection for headless and',
      '# interactive sessions. It checks every 5 minutes and shuts down only when:',
      '# - No active SSH/IAP/screen/tmux sessions, and',
      '# - At least 2 of 3 workload signals are idle (CPU/Network/Disk).',
      '#',
      '# Industry Standard Approach:',
      '# - Requires multiple independent idle signals before shutdown',
      '# - Preserves headless workloads that are doing disk/network work',
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
      'CPU_IDLE_THRESHOLD=5',
      'NET_KBPS_THRESHOLD=20',
      'DISK_IOPS_THRESHOLD=2',
      'DISK_KBPS_THRESHOLD=10',
      'WORKLOAD_IDLE_SIGNALS_REQUIRED=2',
      'LOG_FILE="/var/log/autoshutdown.log"',
      'STATE_FILE="/var/run/autoshutdown-idle-count"',
      'LOCK_FILE="/var/run/autoshutdown.lock"',
      '',
      '# Use file locking to avoid overlapping runs',
      'exec 200>"$LOCK_FILE"',
      'flock -n 200 || { echo "$(date): Another check is running, skipping." >> "$LOG_FILE"; exit 0; }',
      '',
      '# Initialize state file if not exists',
      'if [ ! -f "$STATE_FILE" ]; then',
      '    echo "0" > "$STATE_FILE"',
      'fi',
      '',
      '# Get current idle count',
      'IDLE_COUNT=$(cat "$STATE_FILE" 2>/dev/null || echo "0")',
      '',
      '# 1) Interactive session signals',
      'ACTIVE_SSH=$(who 2>/dev/null | grep -c "pts/" || echo "0")',
      'SSHD_PROCESSES=$(pgrep -c "sshd" 2>/dev/null || echo "0")',
      'if [ "$SSHD_PROCESSES" -gt 0 ]; then SSHD_PROCESSES=$((SSHD_PROCESSES - 1)); fi',
      'SCREEN_SESSIONS=$(pgrep -c "screen|tmux" 2>/dev/null || echo "0")',
      '',
      '# 2) CPU signal',
      'read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat',
      'CPU_TOTAL1=$((user + nice + system + idle + iowait + irq + softirq + steal))',
      'CPU_IDLE1=$idle',
      'sleep 1',
      'read -r _ user nice system idle iowait irq softirq steal _ < /proc/stat',
      'CPU_TOTAL2=$((user + nice + system + idle + iowait + irq + softirq + steal))',
      'CPU_IDLE2=$idle',
      'CPU_TOTAL_DIFF=$((CPU_TOTAL2 - CPU_TOTAL1))',
      'CPU_IDLE_DIFF=$((CPU_IDLE2 - CPU_IDLE1))',
      'if [ "$CPU_TOTAL_DIFF" -gt 0 ]; then',
      '  CPU_BUSY=$(( (1000 * (CPU_TOTAL_DIFF - CPU_IDLE_DIFF) / CPU_TOTAL_DIFF + 5) / 10 ))',
      'else',
      '  CPU_BUSY=0',
      'fi',
      '',
      '# 3) Network signal (combined RX+TX throughput)',
      'NET_IFACE=$(ip -o -4 route show to default | awk \'{print $5}\' | head -1)',
      'if [ -z "$NET_IFACE" ]; then',
      '  NET_IFACE=$(ls /sys/class/net 2>/dev/null | grep -E -v "^(lo|docker|br-|veth)" | head -1)',
      'fi',
      'NET_KBPS=0',
      'if [ -n "$NET_IFACE" ] && [ -r "/sys/class/net/$NET_IFACE/statistics/rx_bytes" ] && [ -r "/sys/class/net/$NET_IFACE/statistics/tx_bytes" ]; then',
      '  RX1=$(cat "/sys/class/net/$NET_IFACE/statistics/rx_bytes")',
      '  TX1=$(cat "/sys/class/net/$NET_IFACE/statistics/tx_bytes")',
      '  sleep 1',
      '  RX2=$(cat "/sys/class/net/$NET_IFACE/statistics/rx_bytes")',
      '  TX2=$(cat "/sys/class/net/$NET_IFACE/statistics/tx_bytes")',
      '  TOTAL_BYTES=$(( (RX2 - RX1) + (TX2 - TX1) ))',
      '  NET_KBPS=$(( TOTAL_BYTES / 1024 ))',
      'fi',
      '',
      '# 4) Disk signal (combined read/write IOPS + throughput)',
      'read -r DISK_IO1 DISK_SECTORS1 <<< "$(awk \'$3 !~ /^(loop|ram|fd|sr|dm-|md)/ {io += $4 + $8; sectors += $6 + $10} END {print io + 0, sectors + 0}\' /proc/diskstats)"',
      'sleep 1',
      'read -r DISK_IO2 DISK_SECTORS2 <<< "$(awk \'$3 !~ /^(loop|ram|fd|sr|dm-|md)/ {io += $4 + $8; sectors += $6 + $10} END {print io + 0, sectors + 0}\' /proc/diskstats)"',
      'DISK_IOPS=$((DISK_IO2 - DISK_IO1))',
      'DISK_KBPS=$(( ((DISK_SECTORS2 - DISK_SECTORS1) * 512) / 1024 ))',
      '',
      'WORKLOAD_IDLE_SIGNALS=0',
      'WORKLOAD_REASON=""',
      '',
      'if [ "$CPU_BUSY" -lt "$CPU_IDLE_THRESHOLD" ]; then',
      '  WORKLOAD_IDLE_SIGNALS=$((WORKLOAD_IDLE_SIGNALS + 1))',
      '  WORKLOAD_REASON="${WORKLOAD_REASON:+$WORKLOAD_REASON; }cpu=${CPU_BUSY}%"',
      'fi',
      '',
      'if [ "$NET_KBPS" -lt "$NET_KBPS_THRESHOLD" ]; then',
      '  WORKLOAD_IDLE_SIGNALS=$((WORKLOAD_IDLE_SIGNALS + 1))',
      '  WORKLOAD_REASON="${WORKLOAD_REASON:+$WORKLOAD_REASON; }net=${NET_KBPS}KB/s"',
      'fi',
      '',
      'if [ "$DISK_IOPS" -lt "$DISK_IOPS_THRESHOLD" ] && [ "$DISK_KBPS" -lt "$DISK_KBPS_THRESHOLD" ]; then',
      '  WORKLOAD_IDLE_SIGNALS=$((WORKLOAD_IDLE_SIGNALS + 1))',
      '  WORKLOAD_REASON="${WORKLOAD_REASON:+$WORKLOAD_REASON; }disk=${DISK_IOPS}IOPS/${DISK_KBPS}KB/s"',
      'fi',
      '',
      'echo "$(date): SSH=$ACTIVE_SSH SSHD=$SSHD_PROCESSES Screen=$SCREEN_SESSIONS CPU=${CPU_BUSY}% NET=${NET_KBPS}KB/s DISK=${DISK_IOPS}IOPS/${DISK_KBPS}KB/s WorkloadIdleSignals=${WORKLOAD_IDLE_SIGNALS}/3 IdleCount=$IDLE_COUNT" >> "$LOG_FILE"',
      '',
      'if [ "$ACTIVE_SSH" -eq 0 ] && [ "$SSHD_PROCESSES" -eq 0 ] && [ "$SCREEN_SESSIONS" -eq 0 ] && [ "$WORKLOAD_IDLE_SIGNALS" -ge "$WORKLOAD_IDLE_SIGNALS_REQUIRED" ]; then',
      '  IDLE_COUNT=$((IDLE_COUNT + 1))',
      '  echo "$IDLE_COUNT" > "$STATE_FILE"',
      '  echo "$(date): Idle quorum met (ssh=idle, workload_idle_signals=$WORKLOAD_IDLE_SIGNALS). Idle count: $IDLE_COUNT/$IDLE_THRESHOLD" >> "$LOG_FILE"',
      '  if [ "$IDLE_COUNT" -ge "$IDLE_THRESHOLD" ]; then',
      '    echo "$(date): Idle threshold reached. Initiating shutdown..." >> "$LOG_FILE"',
      '    sync',
      '    /sbin/shutdown -h now "Auto-shutdown: SSH idle and workload idle quorum met ($WORKLOAD_REASON)"',
      '  fi',
      'else',
      '  echo "0" > "$STATE_FILE"',
      '  echo "$(date): Activity detected or quorum not met. Idle count reset." >> "$LOG_FILE"',
      'fi',
      '',
      'flock -u 200',
      'SCRIPT',
      '',
      'chmod +x /usr/local/bin/check-ssh-idle.sh',
      '',
      '# Create systemd timer for periodic checks',
      'cat > /etc/systemd/system/autoshutdown.service << EOF',
      '[Unit]',
      'Description=Check for multi-signal inactivity and shutdown if idle',
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=/usr/local/bin/check-ssh-idle.sh',
      'EOF',
      '',
      'cat > /etc/systemd/system/autoshutdown.timer << EOF',
      '[Unit]',
      'Description=Run inactivity check every 5 minutes',
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
      'echo "$(date): Workload signal thresholds: CPU<5%, NET<20KB/s, DISK<2IOPS and <10KB/s" >> /var/log/autoshutdown.log',
      'echo "$(date): Decision rule: SSH idle and at least 2 workload idle signals" >> /var/log/autoshutdown.log',
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

    // Keep CPU alarm as observability signal; shutdown action is handled by the
    // multi-signal in-instance detector to avoid single-metric false positives.

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
