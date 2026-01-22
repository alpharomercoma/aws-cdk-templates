import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Aws3TierAppStack } from '../lib/aws-3tier-app-stack';

describe('Aws3TierAppStack', () => {
  let app: cdk.App;
  let stack: Aws3TierAppStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new Aws3TierAppStack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'ap-southeast-1',
      },
    });
    template = Template.fromStack(stack);
  });

  describe('VPC', () => {
    test('creates VPC with DNS enabled', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test('creates subnets in 2 AZs (public, private, isolated)', () => {
      // 2 AZs × 3 subnet types = 6 subnets
      template.resourceCountIs('AWS::EC2::Subnet', 6);
    });

    test('creates NAT Gateway', () => {
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });
  });

  describe('Security Groups', () => {
    test('creates ALB security group', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for ALB - accepts HTTP/HTTPS from internet',
      });
    });

    test('creates EC2 security group', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for EC2 - accepts traffic from ALB only',
      });
    });

    test('creates RDS security group', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for RDS - accepts traffic from EC2 only',
      });
    });

    test('creates Redis security group', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for ElastiCache - accepts traffic from EC2 only',
      });
    });
  });

  describe('RDS PostgreSQL', () => {
    test('creates PostgreSQL instance', () => {
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        Engine: 'postgres',
        DBInstanceClass: 'db.t4g.micro',
        StorageEncrypted: true,
        PubliclyAccessible: false,
      });
    });

    test('creates database secret in Secrets Manager', () => {
      template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Description: 'PostgreSQL database credentials',
      });
    });

    test('RDS has backup retention', () => {
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        BackupRetentionPeriod: 7,
      });
    });

    test('RDS has Performance Insights enabled', () => {
      template.hasResourceProperties('AWS::RDS::DBInstance', {
        EnablePerformanceInsights: true,
      });
    });
  });

  describe('ElastiCache Redis', () => {
    test('creates Redis cluster', () => {
      template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
        Engine: 'redis',
        CacheNodeType: 'cache.t4g.micro',
        NumCacheNodes: 1,
      });
    });

    test('creates Redis subnet group', () => {
      template.hasResourceProperties('AWS::ElastiCache::SubnetGroup', {
        Description: 'Subnet group for ElastiCache Redis',
      });
    });
  });

  describe('EC2 Instance', () => {
    test('creates t4g.small instance', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 't4g.small',
      });
    });

    test('EC2 has encrypted EBS volume', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        BlockDeviceMappings: Match.arrayWith([
          Match.objectLike({
            Ebs: Match.objectLike({
              Encrypted: true,
              VolumeType: 'gp3',
            }),
          }),
        ]),
      });
    });
  });

  describe('Application Load Balancer', () => {
    test('creates internet-facing ALB', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Scheme: 'internet-facing',
        Type: 'application',
      });
    });

    test('creates target group with health check', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckPath: '/health',
        Port: 8000,
        Protocol: 'HTTP',
      });
    });
  });

  describe('S3 Bucket', () => {
    test('creates S3 bucket with encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    test('S3 bucket blocks public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  describe('CloudFront', () => {
    test('creates two CloudFront distributions', () => {
      template.resourceCountIs('AWS::CloudFront::Distribution', 2);
    });

    test('creates CloudFront OAC for S3', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: Match.objectLike({
          OriginAccessControlOriginType: 's3',
        }),
      });
    });
  });

  describe('WAF', () => {
    test('creates WAF Web ACL', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Name: 'aws-3tier-waf',
        Scope: 'REGIONAL',
      });
    });

    test('WAF has SQL injection rules', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'AWSManagedRulesSQLiRuleSet',
          }),
        ]),
      });
    });

    test('WAF has rate limiting', () => {
      template.hasResourceProperties('AWS::WAFv2::WebACL', {
        Rules: Match.arrayWith([
          Match.objectLike({
            Name: 'RateLimitRule',
            Statement: {
              RateBasedStatement: {
                Limit: 2000,
              },
            },
          }),
        ]),
      });
    });

    test('WAF is associated with ALB', () => {
      template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    });
  });

  describe('IAM', () => {
    test('creates EC2 role with SSM policy', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            'Fn::Join': Match.arrayWith([
              Match.arrayWith([
                Match.stringLikeRegexp('AmazonSSMManagedInstanceCore'),
              ]),
            ]),
          }),
        ]),
      });
    });
  });

  describe('Outputs', () => {
    test('exports static URL', () => {
      template.hasOutput('StaticUrl', {});
    });

    test('exports API URL', () => {
      template.hasOutput('ApiUrl', {});
    });

    test('exports database endpoint', () => {
      template.hasOutput('DatabaseEndpoint', {});
    });

    test('exports Redis endpoint', () => {
      template.hasOutput('RedisEndpoint', {});
    });

    test('exports EC2 instance ID', () => {
      template.hasOutput('Ec2InstanceId', {});
    });

    test('exports health endpoint', () => {
      template.hasOutput('HealthEndpoint', {});
    });
  });
});
