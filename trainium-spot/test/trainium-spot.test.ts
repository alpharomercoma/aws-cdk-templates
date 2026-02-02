import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { TrainiumSpotStack } from '../lib/trainium-spot-stack';

describe('TrainiumSpotStack', () => {
  let app: cdk.App;
  let stack: TrainiumSpotStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new TrainiumSpotStack(app, 'TestTrainiumSpotStack', {
      env: { region: 'us-east-2', account: '123456789012' },
    });
    template = Template.fromStack(stack);
  });

  describe('VPC Configuration', () => {
    test('creates VPC with single AZ for cost optimization', () => {
      template.resourceCountIs('AWS::EC2::VPC', 1);
      template.resourceCountIs('AWS::EC2::Subnet', 1);
    });

    test('creates no NAT gateways to reduce costs', () => {
      template.resourceCountIs('AWS::EC2::NatGateway', 0);
    });

    test('creates public subnet', () => {
      template.hasResourceProperties('AWS::EC2::Subnet', {
        MapPublicIpOnLaunch: true,
      });
    });
  });

  describe('Security Group Configuration', () => {
    test('creates security group with SSH access', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for Trainium spot instance',
        SecurityGroupIngress: Match.arrayWith([
          Match.objectLike({
            FromPort: 22,
            ToPort: 22,
            IpProtocol: 'tcp',
            CidrIp: '0.0.0.0/0',
          }),
        ]),
      });
    });
  });

  describe('Launch Template Configuration', () => {
    test('creates launch template with trn1.2xlarge instance type', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          InstanceType: 'trn1.2xlarge',
        }),
      });
    });

    test('configures spot instance options', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          InstanceMarketOptions: Match.objectLike({
            MarketType: 'spot',
            SpotOptions: Match.objectLike({
              SpotInstanceType: 'one-time',
              InstanceInterruptionBehavior: 'stop',
            }),
          }),
        }),
      });
    });

    test('configures 50 GiB gp3 storage', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              DeviceName: '/dev/sda1',
              Ebs: Match.objectLike({
                VolumeSize: 50,
                VolumeType: 'gp3',
                Encrypted: true,
                DeleteOnTermination: true,
              }),
            }),
          ]),
        }),
      });
    });

    test('configures CPU options - 2 cores with 1 thread each', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          CpuOptions: {
            CoreCount: 2,
            ThreadsPerCore: 1,
          },
        }),
      });
    });

    test('enables detailed monitoring', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          Monitoring: {
            Enabled: true,
          },
        }),
      });
    });

    test('includes user data for auto-shutdown', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          UserData: Match.anyValue(),
        }),
      });
    });
  });

  describe('EC2 Instance Configuration', () => {
    test('creates EC2 instance using launch template', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        LaunchTemplate: Match.objectLike({
          LaunchTemplateId: Match.anyValue(),
          Version: Match.anyValue(),
        }),
      });
    });

    test('instance has correct tags', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        Tags: Match.arrayWith([
          Match.objectLike({ Key: 'AutoShutdown', Value: 'enabled' }),
          Match.objectLike({ Key: 'CostOptimization', Value: 'aggressive' }),
        ]),
      });
    });
  });

  describe('CloudWatch Alarm Configuration', () => {
    test('creates CPU idle alarm with aggressive thresholds', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Threshold: 3,
        EvaluationPeriods: 3,
        DatapointsToAlarm: 3,
        Period: 60, // 1 minute
        ComparisonOperator: 'LessThanThreshold',
        Statistic: 'Average',
      });
    });

    test('alarm has EC2 stop action', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmActions: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.anyValue(),
          }),
        ]),
      });
      // Verify the alarm action contains the stop action by checking the full template
      const alarms = template.findResources('AWS::CloudWatch::Alarm');
      const alarmKeys = Object.keys(alarms);
      expect(alarmKeys.length).toBe(1);
      const alarmAction = JSON.stringify(alarms[alarmKeys[0]].Properties.AlarmActions);
      expect(alarmAction).toContain('ec2:stop');
    });

    test('alarm treats missing data as not breaching', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        TreatMissingData: 'notBreaching',
      });
    });
  });

  describe('IAM Configuration', () => {
    test('creates IAM role with SSM managed policy', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('.*AmazonSSMManagedInstanceCore.*'),
              ]),
            ]),
          }),
        ]),
      });
    });
  });

  describe('Key Pair Configuration', () => {
    test('creates ED25519 key pair', () => {
      template.hasResourceProperties('AWS::EC2::KeyPair', {
        KeyType: 'ed25519',
      });
    });
  });

  describe('Stack Outputs', () => {
    test('exports instance ID', () => {
      template.hasOutput('InstanceId', {});
    });

    test('exports alarm ARN', () => {
      template.hasOutput('AlarmArn', {});
    });

    test('exports key pair ID', () => {
      template.hasOutput('KeyPairId', {});
    });

    test('exports launch template ID', () => {
      template.hasOutput('LaunchTemplateId', {});
    });

    test('exports cost optimization summary', () => {
      template.hasOutput('CostOptimizationSummary', {
        Value: 'Spot pricing + 2-min shutdown + minimal storage + reduced CPU threads',
      });
    });
  });

  describe('Cost Optimization Verification', () => {
    test('uses spot instance (not on-demand)', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          InstanceMarketOptions: {
            MarketType: 'spot',
            SpotOptions: Match.anyValue(),
          },
        }),
      });
    });

    test('uses minimal storage size (50 GiB)', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          BlockDeviceMappings: Match.arrayWith([
            Match.objectLike({
              Ebs: Match.objectLike({
                VolumeSize: 50,
              }),
            }),
          ]),
        }),
      });
    });

    test('uses reduced CPU threads (1 per core)', () => {
      template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
        LaunchTemplateData: Match.objectLike({
          CpuOptions: {
            CoreCount: 2,
            ThreadsPerCore: 1,
          },
        }),
      });
    });
  });
});
