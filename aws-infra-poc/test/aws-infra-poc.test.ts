import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AwsInfraPocStack } from '../lib/aws-infra-poc-stack';

describe('AwsInfraPocStack', () => {
  let app: cdk.App;
  let stack: AwsInfraPocStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new AwsInfraPocStack(app, 'TestStack', {
      env: {
        account: '123456789012',
        region: 'ap-southeast-1',
      },
    });
    template = Template.fromStack(stack);
  });

  describe('VPC', () => {
    test('creates VPC with correct configuration', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    test('creates public subnets in 2 AZs', () => {
      template.resourceCountIs('AWS::EC2::Subnet', 2);
    });
  });

  describe('Security Groups', () => {
    test('creates ALB security group allowing HTTP', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for Application Load Balancer',
      });
    });

    test('creates EC2 security group', () => {
      template.hasResourceProperties('AWS::EC2::SecurityGroup', {
        GroupDescription: 'Security group for EC2 instance - ALB access only',
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

  describe('EC2 Instance', () => {
    test('creates t4g.nano instance', () => {
      template.hasResourceProperties('AWS::EC2::Instance', {
        InstanceType: 't4g.nano',
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

  describe('CloudFront Distributions', () => {
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
        Name: 'aws-infra-poc-waf',
        Scope: 'REGIONAL',
      });
    });

    test('WAF has rate limiting rule', () => {
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
    test('exports CloudFront URLs', () => {
      template.hasOutput('StaticCloudFrontUrl', {});
      template.hasOutput('ApiCloudFrontUrl', {});
    });

    test('exports EC2 instance ID', () => {
      template.hasOutput('Ec2InstanceId', {});
    });

    test('exports WAF ARN', () => {
      template.hasOutput('WafWebAclArn', {});
    });
  });
});
