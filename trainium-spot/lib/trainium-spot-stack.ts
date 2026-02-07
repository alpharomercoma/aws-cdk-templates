import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

/**
 * Trainium Spot Instance Stack
 *
 * This stack creates a highly cost-optimized AWS Trainium1 (trn1.2xlarge) spot instance
 * with aggressive auto-shutdown capabilities for ML/AI workloads.
 *
 * Cost Optimization Features:
 * - Spot instance pricing (up to 90% savings vs on-demand)
 * - Aggressive 2-minute inactivity shutdown
 * - Minimal storage (50 GiB gp3)
 * - CPU threading optimization (1 thread per core)
 * - Single AZ deployment (no redundancy costs)
 *
 * Auto-Shutdown Mechanisms:
 * 1. CloudWatch Alarm - Stops instance when CPU < 3% for 2 minutes
 * 2. SSH Session Detection - Shuts down after 2 consecutive 1-min checks with no sessions
 *
 * Trainium1 Specifications (trn1.2xlarge):
 * - 1x Trainium accelerator (16 NeuronCores)
 * - 8 vCPUs
 * - 32 GiB memory
 * - Up to 25 Gbps network bandwidth
 */
export class TrainiumSpotStack extends cdk.Stack {
  public readonly launchTemplate: ec2.LaunchTemplate;
  public readonly cpuAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // VPC Configuration - Minimal setup for cost optimization
    // ============================================================
    const vpc = new ec2.Vpc(this, 'TrainiumVpc', {
      natGateways: 0, // No NAT gateway costs
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
      // Use single AZ to avoid context lookups and minimize costs
      availabilityZones: [`${cdk.Stack.of(this).region}c`],
    });

    // ============================================================
    // Security Group
    // ============================================================
    const securityGroup = new ec2.SecurityGroup(this, 'TrainiumSecurityGroup', {
      vpc,
      description: 'Security group for Trainium spot instance',
      allowAllOutbound: true,
    });

    // Allow SSH access
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access'
    );

    // ============================================================
    // EC2 Key Pair
    // ============================================================
    const keyPair = new ec2.KeyPair(this, 'TrainiumKeyPair', {
      keyPairName: `${this.stackName}-keypair`,
      type: ec2.KeyPairType.ED25519,
    });

    // ============================================================
    // IAM Role for EC2
    // ============================================================
    const role = new iam.Role(this, 'TrainiumRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for Trainium spot instance with SSM and self-shutdown access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // ============================================================
    // User Data Script - Aggressive 2-minute SSH Inactivity Detection
    // ============================================================
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# ============================================================',
      '# Aggressive SSH Inactivity Auto-Shutdown Script (2 min)',
      '# ============================================================',
      '# Optimized for cost savings on expensive Trainium instances.',
      '# Checks every 1 minute, shuts down after 2 consecutive idle checks.',
      '# Includes grace period for initial SSH connection.',
      '# ============================================================',
      '',
      '# Install Neuron SDK for Trainium support',
      'echo "Installing AWS Neuron SDK..."',
      '. /etc/os-release',
      'sudo tee /etc/apt/sources.list.d/neuron.list > /dev/null <<EOF',
      'deb https://apt.repos.neuron.amazonaws.com ${VERSION_CODENAME} main',
      'EOF',
      'wget -qO - https://apt.repos.neuron.amazonaws.com/GPG-PUB-KEY-AMAZON-AWS-NEURON.PUB | sudo apt-key add -',
      'sudo apt-get update -y',
      'sudo apt-get install -y aws-neuronx-runtime-lib aws-neuronx-collectives aws-neuronx-tools || true',
      '',
      '# Create the auto-shutdown check script with improved edge case handling',
      'cat > /usr/local/bin/check-ssh-idle.sh << \'SCRIPT\'',
      '#!/bin/bash',
      '',
      '# Aggressive settings for expensive Trainium instance',
      'IDLE_THRESHOLD=2           # 2 consecutive checks = 2 min idle',
      'LOG_FILE="/var/log/autoshutdown.log"',
      'STATE_FILE="/var/run/autoshutdown-idle-count"',
      'LOCK_FILE="/var/run/autoshutdown.lock"',
      '',
      '# Use file locking to prevent race conditions',
      'exec 200>"$LOCK_FILE"',
      'flock -n 200 || { echo "$(date): Another check is running, skipping." >> "$LOG_FILE"; exit 0; }',
      '',
      '# Boot grace period: skip first 5 minutes after boot to allow initial SSH and system stabilization',
      '# This also protects against CloudWatch alarm triggering during boot',
      'UPTIME_SECONDS=$(awk \'{print int($1)}\' /proc/uptime)',
      'if [ "$UPTIME_SECONDS" -lt 300 ]; then',
      '    echo "$(date): Boot grace period active (uptime: ${UPTIME_SECONDS}s < 300s). Skipping check." >> "$LOG_FILE"',
      '    exit 0',
      'fi',
      '',
      '# Initialize state file if not exists',
      'if [ ! -f "$STATE_FILE" ]; then',
      '    echo "0" > "$STATE_FILE"',
      'fi',
      '',
      '# Get current idle count',
      'IDLE_COUNT=$(cat "$STATE_FILE" 2>/dev/null || echo "0")',
      '',
      '# ============================================================',
      '# Activity Detection - Multiple Methods for Robustness',
      '# ============================================================',
      '',
      '# 1. Check for active SSH sessions via who (pts terminals)',
      'ACTIVE_SSH=$(who 2>/dev/null | grep -c "pts/" || echo "0")',
      '',
      '# 2. Check for SSM Session Manager sessions',
      'SSM_SESSIONS=$(pgrep -c "ssm-session-worker" 2>/dev/null || echo "0")',
      '',
      '# 3. Check for screen/tmux sessions (user might have detached)',
      'SCREEN_SESSIONS=$(pgrep -c "screen|tmux" 2>/dev/null || echo "0")',
      '',
      '# 4. Check for active Neuron/ML processes (specific patterns)',
      '# neuron-cc: Neuron compiler',
      '# neuronx-cc: Neuron compiler for Trainium',
      '# neuron-ls: Neuron device listing',
      '# torch.*neuron: PyTorch with Neuron',
      'NEURON_PROCS=$(pgrep -fc "(neuron-cc|neuronx-cc|neuron_|nrt_|torch.*neuron)" 2>/dev/null || echo "0")',
      '',
      '# 5. Check for any training/inference scripts (common patterns)',
      'ML_PROCS=$(pgrep -fc "(train\\.py|inference\\.py|run_.*\\.py|transformers|huggingface)" 2>/dev/null || echo "0")',
      '',
      '# 6. Check CPU usage using /proc/stat (more reliable than top)',
      '# Read CPU stats, wait 1 second, read again, calculate usage',
      'read -r cpu user nice system idle iowait irq softirq steal _ < /proc/stat',
      'PREV_IDLE=$idle',
      'PREV_TOTAL=$((user + nice + system + idle + iowait + irq + softirq + steal))',
      'sleep 1',
      'read -r cpu user nice system idle iowait irq softirq steal _ < /proc/stat',
      'CURR_IDLE=$idle',
      'CURR_TOTAL=$((user + nice + system + idle + iowait + irq + softirq + steal))',
      'DIFF_IDLE=$((CURR_IDLE - PREV_IDLE))',
      'DIFF_TOTAL=$((CURR_TOTAL - PREV_TOTAL))',
      'if [ "$DIFF_TOTAL" -gt 0 ]; then',
      '    CPU_BUSY=$(( (1000 * (DIFF_TOTAL - DIFF_IDLE) / DIFF_TOTAL + 5) / 10 ))',
      'else',
      '    CPU_BUSY=0',
      'fi',
      '',
      '# 7. Check for Neuron device activity (if neuron-top is available)',
      'NEURON_ACTIVE=0',
      'if command -v neuron-top &> /dev/null; then',
      '    # Check if any Neuron cores are active (non-zero utilization)',
      '    NEURON_UTIL=$(timeout 2 neuron-top -t 1 2>/dev/null | grep -c "%" || echo "0")',
      '    [ "$NEURON_UTIL" -gt 0 ] && NEURON_ACTIVE=1',
      'fi',
      '',
      '# 8. Check for high memory usage (training jobs use lots of memory)',
      'MEM_USED_PCT=$(free | awk \'/^Mem:/ {printf "%.0f", $3/$2 * 100}\')',
      '',
      '# Log current state',
      'echo "$(date): SSH=$ACTIVE_SSH, SSM=$SSM_SESSIONS, Screen=$SCREEN_SESSIONS, Neuron=$NEURON_PROCS, ML=$ML_PROCS, CPU=$CPU_BUSY%, Mem=$MEM_USED_PCT%, NeuronDev=$NEURON_ACTIVE, IdleCount=$IDLE_COUNT" >> "$LOG_FILE"',
      '',
      '# Determine if system is active',
      'IS_ACTIVE=0',
      'REASON=""',
      '',
      'if [ "$ACTIVE_SSH" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="Active SSH sessions"',
      'elif [ "$SSM_SESSIONS" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="SSM Session Manager connected"',
      'elif [ "$SCREEN_SESSIONS" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="Screen/tmux sessions running"',
      'elif [ "$NEURON_PROCS" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="Neuron processes running"',
      'elif [ "$ML_PROCS" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="ML training/inference processes"',
      'elif [ "$NEURON_ACTIVE" -gt 0 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="Neuron device active"',
      'elif [ "$CPU_BUSY" -gt 10 ]; then',
      '    IS_ACTIVE=1',
      '    REASON="CPU busy (${CPU_BUSY}% > 10%)"',
      'elif [ "$MEM_USED_PCT" -gt 80 ]; then',
      '    # High memory usage often indicates training in progress',
      '    IS_ACTIVE=1',
      '    REASON="High memory usage (${MEM_USED_PCT}% > 80%)"',
      'fi',
      '',
      'if [ "$IS_ACTIVE" -eq 0 ]; then',
      '    IDLE_COUNT=$((IDLE_COUNT + 1))',
      '    echo "$IDLE_COUNT" > "$STATE_FILE"',
      '    echo "$(date): No activity detected. Idle count: $IDLE_COUNT/$IDLE_THRESHOLD" >> "$LOG_FILE"',
      '    ',
      '    if [ "$IDLE_COUNT" -ge "$IDLE_THRESHOLD" ]; then',
      '        echo "$(date): IDLE THRESHOLD REACHED. Initiating shutdown..." >> "$LOG_FILE"',
      '        # Sync filesystem before shutdown',
      '        sync',
      '        /sbin/shutdown -h now "Auto-shutdown: No activity for 2+ minutes"',
      '    fi',
      'else',
      '    echo "0" > "$STATE_FILE"',
      '    echo "$(date): Activity detected ($REASON). Idle count reset." >> "$LOG_FILE"',
      'fi',
      '',
      '# Release lock',
      'flock -u 200',
      'SCRIPT',
      '',
      'chmod +x /usr/local/bin/check-ssh-idle.sh',
      '',
      '# Create systemd service',
      'cat > /etc/systemd/system/autoshutdown.service << EOF',
      '[Unit]',
      'Description=Aggressive inactivity check for Trainium cost optimization',
      '',
      '[Service]',
      'Type=oneshot',
      'ExecStart=/usr/local/bin/check-ssh-idle.sh',
      'EOF',
      '',
      '# Create systemd timer - Check every 1 minute for aggressive shutdown',
      'cat > /etc/systemd/system/autoshutdown.timer << EOF',
      '[Unit]',
      'Description=Run inactivity check every 1 minute',
      '',
      '[Timer]',
      'OnBootSec=5min',
      'OnUnitActiveSec=1min',
      'AccuracySec=10s',
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
      'echo "$(date): Trainium Auto-Shutdown Initialized" > /var/log/autoshutdown.log',
      'echo "$(date): Mode: AGGRESSIVE (2 min inactivity)" >> /var/log/autoshutdown.log',
      'echo "$(date): Check interval: 1 minute" >> /var/log/autoshutdown.log',
      'echo "$(date): Boot grace period: 5 minutes" >> /var/log/autoshutdown.log',
      'echo "$(date): Activity detection: SSH, SSM, Screen/Tmux, Neuron, ML procs, CPU, Memory" >> /var/log/autoshutdown.log',
    );

    // ============================================================
    // Launch Template for Spot Instance with CPU Optimization
    // ============================================================
    this.launchTemplate = new ec2.LaunchTemplate(this, 'TrainiumLaunchTemplate', {
      launchTemplateName: `${this.stackName}-trainium-lt`,

      // trn1.2xlarge - Smallest Trainium instance type
      instanceType: new ec2.InstanceType('trn1.2xlarge'),

      // Ubuntu 24.04 LTS x86_64 - Latest via SSM Parameter
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
        { os: ec2.OperatingSystemType.LINUX }
      ),

      // Security group
      securityGroup,

      // Key pair for SSH access
      keyPair,

      // IAM role
      role,

      // User data for auto-shutdown
      userData,

      // Enable detailed monitoring for fast CloudWatch alarm response
      detailedMonitoring: true,

      // 50 GiB gp3 storage - minimal but sufficient
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(50, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
            iops: 3000,      // gp3 baseline
            throughput: 125,  // gp3 baseline MB/s
          }),
        },
      ],

      // CPU Options: 1 thread per core across 2 cores
      // trn1.2xlarge has 8 vCPUs (4 cores x 2 threads)
      // Setting 2 cores with 1 thread each = 2 vCPUs total
      cpuCredits: undefined, // Not applicable to trn1

      // Request Spot Instance
      spotOptions: {
        requestType: ec2.SpotRequestType.PERSISTENT,
        interruptionBehavior: ec2.SpotInstanceInterruption.STOP,
        maxPrice: undefined, // Use current spot price (most cost effective)
      },
    });

    // ============================================================
    // CfnLaunchTemplate for CPU Options (L1 construct override)
    // ============================================================
    // CDK L2 doesn't expose CpuOptions, so we use escape hatch
    const cfnLaunchTemplate = this.launchTemplate.node.defaultChild as ec2.CfnLaunchTemplate;
    cfnLaunchTemplate.addPropertyOverride('LaunchTemplateData.CpuOptions', {
      CoreCount: 2,
      ThreadsPerCore: 1,
    });

    // ============================================================
    // EC2 Instance using Launch Template
    // ============================================================
    const instance = new ec2.CfnInstance(this, 'TrainiumInstance', {
      launchTemplate: {
        launchTemplateId: this.launchTemplate.launchTemplateId,
        version: this.launchTemplate.latestVersionNumber,
      },
      subnetId: vpc.publicSubnets[0].subnetId,
      tags: [
        { key: 'Name', value: `${this.stackName}-trainium` },
        { key: 'AutoShutdown', value: 'enabled' },
        { key: 'CostOptimization', value: 'aggressive' },
      ],
    });

    // ============================================================
    // CloudWatch Alarm - Aggressive CPU-based Auto-Stop
    // ============================================================
    // Stop instance when CPU < 3% for 3 minutes (3 x 1-min periods)
    // Using 3 periods provides boot protection while remaining aggressive
    // Trainium instances can cost $1.34/hr+ so aggressive shutdown is critical
    this.cpuAlarm = new cloudwatch.Alarm(this, 'CpuIdleAlarm', {
      alarmName: `${this.stackName}-cpu-idle-alarm`,
      alarmDescription:
        'Stop Trainium instance when CPU < 3% for 3 minutes (cost optimization)',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          InstanceId: instance.ref,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(1), // 1-minute periods for fast response
      }),
      threshold: 3, // Very low threshold for Trainium
      evaluationPeriods: 3, // 3 x 1-min = 3 minutes total (boot protection)
      datapointsToAlarm: 3, // Require all 3 datapoints to be below threshold
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Add EC2 stop action
    this.cpuAlarm.addAlarmAction(
      new cloudwatchActions.Ec2Action(cloudwatchActions.Ec2InstanceAction.STOP)
    );

    // ============================================================
    // Outputs
    // ============================================================
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.ref,
      description: 'Trainium Spot Instance ID',
    });

    new cdk.CfnOutput(this, 'InstanceType', {
      value: 'trn1.2xlarge (Spot)',
      description: 'Instance type with spot pricing',
    });

    new cdk.CfnOutput(this, 'CpuConfiguration', {
      value: '2 cores x 1 thread = 2 vCPUs',
      description: 'CPU optimization settings',
    });

    new cdk.CfnOutput(this, 'AutoShutdownConfig', {
      value: '2 minutes inactivity (1-min checks)',
      description: 'Aggressive auto-shutdown configuration',
    });

    new cdk.CfnOutput(this, 'AlarmArn', {
      value: this.cpuAlarm.alarmArn,
      description: 'CloudWatch Alarm ARN for CPU idle detection',
    });

    new cdk.CfnOutput(this, 'KeyPairId', {
      value: keyPair.keyPairId,
      description: 'EC2 Key Pair ID',
    });

    new cdk.CfnOutput(this, 'GetPrivateKeyCommand', {
      value: `aws ssm get-parameter --name /ec2/keypair/${keyPair.keyPairId} --region ${this.region} --with-decryption --query Parameter.Value --output text > ~/.ssh/${this.stackName}-keypair.pem && chmod 400 ~/.ssh/${this.stackName}-keypair.pem`,
      description: 'Command to retrieve private key from SSM Parameter Store',
    });

    new cdk.CfnOutput(this, 'KeyPairName', {
      value: keyPair.keyPairName!,
      description: 'EC2 Key Pair Name',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'Deployment region',
    });

    new cdk.CfnOutput(this, 'LaunchTemplateId', {
      value: this.launchTemplate.launchTemplateId!,
      description: 'Launch Template ID for spot instance',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });

    new cdk.CfnOutput(this, 'CostOptimizationSummary', {
      value: 'Spot pricing + 2-min shutdown + minimal storage + reduced CPU threads',
      description: 'Cost optimization features enabled',
    });
  }
}
