import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Stack properties with optional domain configuration
 */
export interface AwsInfraPocStackProps extends cdk.StackProps {
  /**
   * Optional: Custom domain name (e.g., 'example.com')
   * If not provided, CloudFront default domains will be used
   */
  domainName?: string;

  /**
   * Optional: Route 53 Hosted Zone ID for the domain
   * Required if domainName is provided
   */
  hostedZoneId?: string;
}

/**
 * AWS Infrastructure Proof of Concept Stack
 *
 * This stack demonstrates industry-grade AWS service integration:
 * - VPC with public subnets (cost-optimized for PoC)
 * - S3 for static website hosting with CloudFront OAC
 * - EC2 t4g.nano running FastAPI (ARM Graviton)
 * - ALB for load balancing and health checks
 * - CloudFront for global CDN (static + API)
 * - WAF for security (OWASP rules, rate limiting)
 * - Route 53 for DNS (optional, if domain provided)
 * - IAM with least privilege access
 *
 * Architecture Flow:
 * User -> Route53 -> CloudFront -> WAF -> S3 (static)
 *                                      -> ALB -> EC2 (API)
 */
export class AwsInfraPocStack extends cdk.Stack {
  // Public references for testing and cross-stack access
  public readonly vpc: ec2.Vpc;
  public readonly staticBucket: s3.Bucket;
  public readonly instance: ec2.Instance;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly staticDistribution: cloudfront.Distribution;
  public readonly apiDistribution: cloudfront.Distribution;
  public readonly wafWebAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props?: AwsInfraPocStackProps) {
    super(scope, id, props);

    // ================================================================
    // VPC Configuration
    // ================================================================
    // Single AZ with public subnet for cost optimization in PoC
    // Production should use multiple AZs
    this.vpc = new ec2.Vpc(this, 'PocVpc', {
      maxAzs: 2, // Multi-AZ for ALB requirement
      natGateways: 0, // No NAT for cost savings in PoC
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
      // Enable DNS support for internal resolution
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // ================================================================
    // Security Groups
    // ================================================================

    // ALB Security Group - accepts traffic from anywhere (CloudFront)
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    // Allow HTTP from anywhere (CloudFront doesn't have fixed IPs)
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from CloudFront'
    );

    // EC2 Security Group - only accepts traffic from ALB
    const ec2SecurityGroup = new ec2.SecurityGroup(this, 'Ec2SecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for EC2 instance - ALB access only',
      allowAllOutbound: true,
    });

    // Only allow traffic from ALB
    ec2SecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(8000),
      'Allow traffic from ALB on port 8000'
    );

    // ================================================================
    // IAM Role for EC2
    // ================================================================
    const ec2Role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for EC2 instance with SSM and CloudWatch access',
      managedPolicies: [
        // SSM for Session Manager access (no SSH needed)
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        // CloudWatch for logging
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // ================================================================
    // S3 Bucket for Static Website
    // ================================================================
    this.staticBucket = new s3.Bucket(this, 'StaticBucket', {
      bucketName: `aws-infra-poc-static-${this.account}-${this.region}`,
      // Block all public access - CloudFront OAC handles access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // Encryption at rest
      encryption: s3.BucketEncryption.S3_MANAGED,
      // Versioning for rollback capability
      versioned: true,
      // Auto-delete for PoC cleanup
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // CORS for potential API interactions
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // ================================================================
    // EC2 Instance with FastAPI
    // ================================================================
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      '',
      '# ============================================================',
      '# FastAPI Application Deployment Script',
      '# ============================================================',
      '',
      '# Update system',
      'apt-get update -y',
      'apt-get upgrade -y',
      '',
      '# Install Python and dependencies',
      'apt-get install -y python3 python3-pip python3-venv',
      '',
      '# Create application directory',
      'mkdir -p /opt/fastapi-app/templates',
      'cd /opt/fastapi-app',
      '',
      '# Create virtual environment',
      'python3 -m venv venv',
      'source venv/bin/activate',
      '',
      '# Install dependencies',
      'pip install --upgrade pip',
      'pip install fastapi uvicorn[standard] gunicorn jinja2',
      '',
      '# Create the FastAPI application',
      'cat > /opt/fastapi-app/main.py << \'PYEOF\'',
      'from datetime import datetime',
      'from zoneinfo import ZoneInfo',
      'from fastapi import FastAPI, Request',
      'from fastapi.responses import HTMLResponse, JSONResponse',
      'from fastapi.templating import Jinja2Templates',
      '',
      'app = FastAPI(',
      '    title="AWS Infrastructure PoC API",',
      '    description="Demonstration API for AWS integration",',
      '    version="1.0.0",',
      ')',
      '',
      'templates = Jinja2Templates(directory="templates")',
      'PH_TZ = ZoneInfo("Asia/Manila")',
      '',
      '@app.get("/health")',
      'async def health_check():',
      '    return {"status": "healthy", "service": "aws-infra-poc-api"}',
      '',
      '@app.get("/hello")',
      'async def hello_world():',
      '    return {"message": "Hello World", "source": "AWS EC2 FastAPI"}',
      '',
      '@app.get("/time")',
      'async def get_philippine_time():',
      '    now = datetime.now(PH_TZ)',
      '    return {',
      '        "timezone": "Asia/Manila",',
      '        "utc_offset": "+08:00",',
      '        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),',
      '        "iso_format": now.isoformat(),',
      '        "unix_timestamp": int(now.timestamp()),',
      '        "day_of_week": now.strftime("%A"),',
      '    }',
      '',
      '@app.get("/time-html", response_class=HTMLResponse)',
      'async def get_philippine_time_html(request: Request):',
      '    now = datetime.now(PH_TZ)',
      '    return templates.TemplateResponse(',
      '        "time.html",',
      '        {',
      '            "request": request,',
      '            "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),',
      '            "timezone": "Asia/Manila (Philippine Standard Time)",',
      '            "day_of_week": now.strftime("%A"),',
      '            "date_formatted": now.strftime("%B %d, %Y"),',
      '        },',
      '    )',
      '',
      '@app.get("/")',
      'async def root():',
      '    return {',
      '        "message": "AWS Infrastructure PoC API",',
      '        "docs": "/docs",',
      '        "endpoints": {',
      '            "health": "/health",',
      '            "hello": "/hello",',
      '            "time_json": "/time",',
      '            "time_html": "/time-html",',
      '        },',
      '    }',
      'PYEOF',
      '',
      '# Create HTML template',
      'cat > /opt/fastapi-app/templates/time.html << \'HTMLEOF\'',
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '    <meta charset="UTF-8">',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '    <title>Philippine Time</title>',
      '    <style>',
      '        body { font-family: system-ui, sans-serif; background: linear-gradient(135deg, #1a1a2e, #0f3460); min-height: 100vh; display: flex; justify-content: center; align-items: center; color: #fff; margin: 0; }',
      '        .container { text-align: center; padding: 3rem; background: rgba(255,255,255,0.1); border-radius: 20px; backdrop-filter: blur(10px); }',
      '        h1 { color: #e94560; margin-bottom: 0.5rem; }',
      '        .time { font-size: 3rem; font-family: monospace; margin: 1rem 0; }',
      '        .date { font-size: 1.2rem; color: #4ecca3; }',
      '        .badge { margin-top: 2rem; padding: 1rem; background: rgba(255,153,0,0.2); border-radius: 10px; }',
      '        .badge h3 { color: #ff9900; }',
      '    </style>',
      '</head>',
      '<body>',
      '    <div class="container">',
      '        <h1>Philippine Time</h1>',
      '        <p>{{ timezone }}</p>',
      '        <div class="time">{{ current_time.split(" ")[1] }}</div>',
      '        <div class="date">{{ date_formatted }} - {{ day_of_week }}</div>',
      '        <div class="badge"><h3>Powered by AWS EC2 + FastAPI</h3></div>',
      '    </div>',
      '</body>',
      '</html>',
      'HTMLEOF',
      '',
      '# Create systemd service',
      'cat > /etc/systemd/system/fastapi.service << EOF',
      '[Unit]',
      'Description=FastAPI application',
      'After=network.target',
      '',
      '[Service]',
      'User=root',
      'WorkingDirectory=/opt/fastapi-app',
      'ExecStart=/opt/fastapi-app/venv/bin/gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000',
      'Restart=always',
      'RestartSec=3',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      '# Enable and start service',
      'systemctl daemon-reload',
      'systemctl enable fastapi.service',
      'systemctl start fastapi.service',
      '',
      '# Log completion',
      'echo "FastAPI application deployed successfully" >> /var/log/user-data.log',
    );

    this.instance = new ec2.Instance(this, 'FastApiInstance', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: ec2SecurityGroup,
      role: ec2Role,

      // t4g.nano - ARM Graviton, cost-effective
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.NANO
      ),

      // Ubuntu 24.04 LTS ARM64
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
        { os: ec2.OperatingSystemType.LINUX }
      ),

      // Storage
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],

      userData,
      detailedMonitoring: true,
    });

    // ================================================================
    // Application Load Balancer
    // ================================================================
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Target Group for EC2 instance
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: this.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      // Deregistration delay for graceful shutdown
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Register EC2 instance as target
    targetGroup.addTarget(new targets.InstanceTarget(this.instance, 8000));

    // HTTP Listener
    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // ================================================================
    // WAF Web ACL (for CloudFront - must be CLOUDFRONT scope)
    // ================================================================
    // Note: For CloudFront, WAF must be created in us-east-1
    // In this PoC, we create a regional WAF. For production with
    // CloudFront WAF, use a separate stack in us-east-1.
    this.wafWebAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'aws-infra-poc-waf',
      description: 'WAF Web ACL for AWS Infrastructure PoC',
      scope: 'REGIONAL', // Use REGIONAL for ALB, CLOUDFRONT for CF (requires us-east-1)
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'AwsInfraPocWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
        // AWS Managed Rules - Common Rule Set (CRS)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - Known Bad Inputs
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // AWS Managed Rules - SQL Injection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        // Rate Limiting Rule - 2000 requests per 5 minutes per IP
        {
          name: 'RateLimitRule',
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF with ALB
    new wafv2.CfnWebACLAssociation(this, 'WafAlbAssociation', {
      resourceArn: this.alb.loadBalancerArn,
      webAclArn: this.wafWebAcl.attrArn,
    });

    // ================================================================
    // CloudFront Distribution for Static Content (S3)
    // ================================================================
    // Origin Access Control for S3
    const s3Oac = new cloudfront.S3OriginAccessControl(this, 'S3Oac', {
      description: 'OAC for static S3 bucket',
    });

    this.staticDistribution = new cloudfront.Distribution(this, 'StaticDistribution', {
      comment: 'CloudFront for static content (S3)',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.staticBucket, {
          originAccessControl: s3Oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US, Canada, Europe
      enabled: true,
    });

    // ================================================================
    // CloudFront Distribution for API (ALB)
    // ================================================================
    this.apiDistribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: 'CloudFront for API (ALB origin)',
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(this.alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // API requests should not be cached heavily
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Forward all headers, cookies, and query strings
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
    });

    // ================================================================
    // Deploy Static Files to S3
    // ================================================================
    new s3deploy.BucketDeployment(this, 'DeployStaticFiles', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'static'))],
      destinationBucket: this.staticBucket,
      distribution: this.staticDistribution,
      distributionPaths: ['/*'],
    });

    // ================================================================
    // Route 53 (Optional - if domain provided)
    // ================================================================
    if (props?.domainName && props?.hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });

      // Static site: www.example.com
      new route53.ARecord(this, 'StaticAliasRecord', {
        zone: hostedZone,
        recordName: `www.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.staticDistribution)
        ),
      });

      // API: api.example.com
      new route53.ARecord(this, 'ApiAliasRecord', {
        zone: hostedZone,
        recordName: `api.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.apiDistribution)
        ),
      });

      // Output custom domains
      new cdk.CfnOutput(this, 'StaticDomainUrl', {
        value: `https://www.${props.domainName}`,
        description: 'Static website URL (custom domain)',
      });

      new cdk.CfnOutput(this, 'ApiDomainUrl', {
        value: `https://api.${props.domainName}`,
        description: 'API URL (custom domain)',
      });
    }

    // ================================================================
    // Outputs
    // ================================================================

    // Static Content URLs
    new cdk.CfnOutput(this, 'StaticCloudFrontUrl', {
      value: `https://${this.staticDistribution.distributionDomainName}`,
      description: 'Static website CloudFront URL',
    });

    new cdk.CfnOutput(this, 'StaticBucketName', {
      value: this.staticBucket.bucketName,
      description: 'S3 bucket name for static files',
    });

    // API URLs
    new cdk.CfnOutput(this, 'ApiCloudFrontUrl', {
      value: `https://${this.apiDistribution.distributionDomainName}`,
      description: 'API CloudFront URL',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'ALB DNS name (direct access, bypasses CloudFront)',
    });

    // EC2 Instance
    new cdk.CfnOutput(this, 'Ec2InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
    });

    // WAF
    new cdk.CfnOutput(this, 'WafWebAclArn', {
      value: this.wafWebAcl.attrArn,
      description: 'WAF Web ACL ARN',
    });

    // API Endpoints
    new cdk.CfnOutput(this, 'ApiHelloEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/hello`,
      description: 'Hello World API endpoint',
    });

    new cdk.CfnOutput(this, 'ApiTimeEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/time`,
      description: 'Philippine Time JSON API endpoint',
    });

    new cdk.CfnOutput(this, 'ApiTimeHtmlEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/time-html`,
      description: 'Philippine Time HTML endpoint',
    });

    new cdk.CfnOutput(this, 'ApiDocsEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/docs`,
      description: 'FastAPI Swagger UI documentation',
    });

    // SSM Session Manager command
    new cdk.CfnOutput(this, 'SsmSessionCommand', {
      value: `aws ssm start-session --target ${this.instance.instanceId} --region ${this.region}`,
      description: 'Command to connect via SSM Session Manager',
    });
  }
}
