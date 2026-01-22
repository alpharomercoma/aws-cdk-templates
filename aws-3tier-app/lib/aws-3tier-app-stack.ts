import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Stack properties with optional domain configuration
 */
export interface Aws3TierAppStackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
}

/**
 * AWS 3-Tier Application Stack
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     PRESENTATION TIER                          │
 * │  Route 53 → CloudFront → WAF → S3 (static) / ALB (api)        │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     APPLICATION TIER                           │
 * │  ALB (public subnet) → EC2 FastAPI (private subnet)           │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        DATA TIER                               │
 * │  PostgreSQL RDS + ElastiCache Redis (isolated subnet)         │
 * │  Secrets Manager for credentials                               │
 * └─────────────────────────────────────────────────────────────────┘
 */
export class Aws3TierAppStack extends cdk.Stack {
  // Public references
  public readonly vpc: ec2.Vpc;
  public readonly database: rds.DatabaseInstance;
  public readonly redisCluster: elasticache.CfnCacheCluster;
  public readonly instance: ec2.Instance;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly staticBucket: s3.Bucket;
  public readonly staticDistribution: cloudfront.Distribution;
  public readonly apiDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: Aws3TierAppStackProps) {
    super(scope, id, props);

    // ================================================================
    // VPC with 3-Tier Subnet Architecture
    // ================================================================
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1, // Single NAT for cost optimization in PoC
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // ================================================================
    // Security Groups
    // ================================================================

    // ALB Security Group (public-facing)
    const albSg = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ALB - accepts HTTP/HTTPS from internet',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS');

    // EC2 Security Group (application tier)
    const ec2Sg = new ec2.SecurityGroup(this, 'Ec2SecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for EC2 - accepts traffic from ALB only',
      allowAllOutbound: true,
    });
    ec2Sg.addIngressRule(albSg, ec2.Port.tcp(8000), 'Allow from ALB');

    // RDS Security Group (data tier)
    const rdsSg = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS - accepts traffic from EC2 only',
      allowAllOutbound: false,
    });
    rdsSg.addIngressRule(ec2Sg, ec2.Port.tcp(5432), 'Allow PostgreSQL from EC2');

    // ElastiCache Security Group (data tier)
    const redisSg = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache - accepts traffic from EC2 only',
      allowAllOutbound: false,
    });
    redisSg.addIngressRule(ec2Sg, ec2.Port.tcp(6379), 'Allow Redis from EC2');

    // ================================================================
    // RDS PostgreSQL (Data Tier)
    // ================================================================

    // Database credentials in Secrets Manager
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `${this.stackName}/database/credentials`,
      description: 'PostgreSQL database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'appuser' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // RDS PostgreSQL instance
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSg],
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'appdb',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false, // Single AZ for PoC cost savings
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // Set to true for production
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change for production
      publiclyAccessible: false,
      // Performance Insights
      enablePerformanceInsights: true,
      performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
    });

    // ================================================================
    // ElastiCache Redis (Data Tier)
    // ================================================================

    // Redis subnet group
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for ElastiCache Redis',
      subnetIds: this.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
      cacheSubnetGroupName: `${this.stackName}-redis-subnet-group`.toLowerCase(),
    });

    // Redis cluster
    this.redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t4g.micro',
      engine: 'redis',
      numCacheNodes: 1,
      clusterName: `${this.stackName}-redis`.toLowerCase().substring(0, 20),
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      engineVersion: '7.1',
      port: 6379,
      // Snapshot for backup
      snapshotRetentionLimit: 1,
    });
    this.redisCluster.addDependency(redisSubnetGroup);

    // ================================================================
    // IAM Role for EC2
    // ================================================================
    const ec2Role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Role for EC2 with SSM, CloudWatch, and Secrets Manager access',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });

    // Allow reading database secret
    dbSecret.grantRead(ec2Role);

    // ================================================================
    // S3 Bucket for Static Content
    // ================================================================
    this.staticBucket = new s3.Bucket(this, 'StaticBucket', {
      bucketName: `aws-3tier-static-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ================================================================
    // EC2 Instance (Application Tier)
    // ================================================================
    const userData = this.createUserData(
      dbSecret.secretArn,
      this.database.instanceEndpoint.hostname,
      this.redisCluster.attrRedisEndpointAddress
    );

    this.instance = new ec2.Instance(this, 'AppInstance', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: ec2Sg,
      role: ec2Role,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.SMALL // Slightly larger for DB connections
      ),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
        { os: ec2.OperatingSystemType.LINUX }
      ),
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

    // Ensure EC2 waits for database and Redis
    this.instance.node.addDependency(this.database);
    this.instance.node.addDependency(this.redisCluster);

    // ================================================================
    // Application Load Balancer
    // ================================================================
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: this.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    targetGroup.addTarget(new targets.InstanceTarget(this.instance, 8000));

    this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // ================================================================
    // WAF Web ACL
    // ================================================================
    const wafWebAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'aws-3tier-waf',
      description: 'WAF for 3-Tier Application',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'Aws3TierWaf',
        sampledRequestsEnabled: true,
      },
      rules: [
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
            metricName: 'CommonRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRuleSet',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'RateLimitRule',
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Associate WAF with ALB
    new wafv2.CfnWebACLAssociation(this, 'WafAlbAssociation', {
      resourceArn: this.alb.loadBalancerArn,
      webAclArn: wafWebAcl.attrArn,
    });

    // ================================================================
    // CloudFront Distributions
    // ================================================================

    // Static content distribution (S3)
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
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
    });

    // API distribution (ALB)
    this.apiDistribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: 'CloudFront for API (ALB origin)',
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(this.alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
    });

    // ================================================================
    // Deploy Static Files
    // ================================================================
    new s3deploy.BucketDeployment(this, 'DeployStaticFiles', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', 'static'))],
      destinationBucket: this.staticBucket,
      distribution: this.staticDistribution,
      distributionPaths: ['/*'],
    });

    // ================================================================
    // Route 53 (Optional)
    // ================================================================
    if (props?.domainName && props?.hostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });

      new route53.ARecord(this, 'StaticAliasRecord', {
        zone: hostedZone,
        recordName: `www.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.staticDistribution)
        ),
      });

      new route53.ARecord(this, 'ApiAliasRecord', {
        zone: hostedZone,
        recordName: `api.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.apiDistribution)
        ),
      });
    }

    // ================================================================
    // Outputs
    // ================================================================

    // URLs
    new cdk.CfnOutput(this, 'StaticUrl', {
      value: `https://${this.staticDistribution.distributionDomainName}`,
      description: 'Static website URL',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: `https://${this.apiDistribution.distributionDomainName}`,
      description: 'API URL',
    });

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: `http://${this.alb.loadBalancerDnsName}`,
      description: 'ALB DNS name (direct)',
    });

    // Database
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'Database credentials secret ARN',
    });

    // Redis
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redisCluster.attrRedisEndpointAddress,
      description: 'ElastiCache Redis endpoint',
    });

    // EC2
    new cdk.CfnOutput(this, 'Ec2InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'SsmSessionCommand', {
      value: `aws ssm start-session --target ${this.instance.instanceId} --region ${this.region}`,
      description: 'SSM Session Manager command',
    });

    // API Endpoints
    new cdk.CfnOutput(this, 'HealthEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/health`,
      description: 'Health check endpoint',
    });

    new cdk.CfnOutput(this, 'ApiDocsEndpoint', {
      value: `https://${this.apiDistribution.distributionDomainName}/docs`,
      description: 'API documentation',
    });
  }

  /**
   * Create EC2 user data script for FastAPI deployment
   */
  private createUserData(
    secretArn: string,
    dbHost: string,
    redisHost: string
  ): ec2.UserData {
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      'exec > >(tee /var/log/user-data.log) 2>&1',
      '',
      'echo "=== Starting 3-Tier Application Deployment ==="',
      '',
      '# Update system',
      'apt-get update -y',
      'apt-get upgrade -y',
      '',
      '# Install dependencies',
      'apt-get install -y python3 python3-pip python3-venv jq awscli',
      '',
      '# Create application directory',
      'mkdir -p /opt/app/templates',
      'cd /opt/app',
      '',
      '# Create virtual environment',
      'python3 -m venv venv',
      'source venv/bin/activate',
      '',
      '# Install Python packages',
      'pip install --upgrade pip',
      'pip install fastapi uvicorn[standard] gunicorn jinja2 asyncpg "redis[hiredis]" boto3 pydantic',
      '',
      '# Get database credentials from Secrets Manager',
      `SECRET_ARN="${secretArn}"`,
      'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
      'SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id $SECRET_ARN --region $REGION --query SecretString --output text)',
      'DB_USER=$(echo $SECRET_JSON | jq -r .username)',
      'DB_PASSWORD=$(echo $SECRET_JSON | jq -r .password)',
      '',
      '# Set environment variables',
      `echo "DB_HOST=${dbHost}" >> /etc/environment`,
      'echo "DB_PORT=5432" >> /etc/environment',
      'echo "DB_NAME=appdb" >> /etc/environment',
      'echo "DB_USER=$DB_USER" >> /etc/environment',
      'echo "DB_PASSWORD=$DB_PASSWORD" >> /etc/environment',
      `echo "REDIS_HOST=${redisHost}" >> /etc/environment`,
      'echo "REDIS_PORT=6379" >> /etc/environment',
      '',
      '# Export for current session',
      `export DB_HOST="${dbHost}"`,
      'export DB_PORT=5432',
      'export DB_NAME=appdb',
      'export DB_USER=$DB_USER',
      'export DB_PASSWORD=$DB_PASSWORD',
      `export REDIS_HOST="${redisHost}"`,
      'export REDIS_PORT=6379',
      '',
      '# Create FastAPI application',
      'cat > /opt/app/main.py << \'PYEOF\'',
      this.getFastApiCode(),
      'PYEOF',
      '',
      '# Create HTML template',
      'cat > /opt/app/templates/time.html << \'HTMLEOF\'',
      this.getTimeTemplate(),
      'HTMLEOF',
      '',
      '# Create systemd service',
      'cat > /etc/systemd/system/fastapi.service << EOF',
      '[Unit]',
      'Description=FastAPI 3-Tier Application',
      'After=network.target',
      '',
      '[Service]',
      'User=root',
      'WorkingDirectory=/opt/app',
      'EnvironmentFile=/etc/environment',
      'ExecStart=/opt/app/venv/bin/gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 --timeout 120',
      'Restart=always',
      'RestartSec=5',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      '# Start service',
      'systemctl daemon-reload',
      'systemctl enable fastapi.service',
      'systemctl start fastapi.service',
      '',
      'echo "=== Deployment Complete ==="',
    );

    return userData;
  }

  /**
   * FastAPI application code (embedded in user data)
   */
  private getFastApiCode(): string {
    return `
import os
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

import asyncpg
import redis.asyncio as redis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PH_TZ = ZoneInfo("Asia/Manila")

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "appdb")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

CACHE_TTL = 60

class VisitorCreate(BaseModel):
    name: str
    message: Optional[str] = None

db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[redis.Redis] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client
    logger.info("Starting application...")

    try:
        db_pool = await asyncpg.create_pool(
            host=DB_HOST, port=DB_PORT, database=DB_NAME,
            user=DB_USER, password=DB_PASSWORD,
            min_size=2, max_size=10, command_timeout=60,
        )
        logger.info(f"Connected to PostgreSQL at {DB_HOST}")

        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS visitors (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    message TEXT,
                    visit_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    visit_count INTEGER DEFAULT 1
                )
            """)
            await conn.execute("CREATE INDEX IF NOT EXISTS idx_visitors_name ON visitors(name)")
        logger.info("Database initialized")
    except Exception as e:
        logger.error(f"PostgreSQL error: {e}")
        db_pool = None

    try:
        redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True, socket_timeout=5)
        await redis_client.ping()
        logger.info(f"Connected to Redis at {REDIS_HOST}")
    except Exception as e:
        logger.error(f"Redis error: {e}")
        redis_client = None

    yield

    if db_pool: await db_pool.close()
    if redis_client: await redis_client.close()

app = FastAPI(title="AWS 3-Tier API", version="1.0.0", lifespan=lifespan)
templates = Jinja2Templates(directory="templates")

async def get_db():
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with db_pool.acquire() as conn:
        yield conn

async def get_redis():
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Cache unavailable")
    return redis_client

@app.get("/health")
async def health():
    db_status = cache_status = "healthy"
    try:
        if db_pool:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
        else:
            db_status = "unavailable"
    except Exception as e:
        db_status = f"unhealthy: {e}"

    try:
        if redis_client:
            await redis_client.ping()
        else:
            cache_status = "unavailable"
    except Exception as e:
        cache_status = f"unhealthy: {e}"

    status = "healthy" if db_status == "healthy" and cache_status == "healthy" else "degraded"
    return {"status": status, "database": db_status, "cache": cache_status, "timestamp": datetime.now(PH_TZ).isoformat()}

@app.get("/")
async def root():
    return {
        "message": "AWS 3-Tier Application API",
        "architecture": {"presentation": "CloudFront+ALB", "application": "EC2 FastAPI", "data": "PostgreSQL+Redis"},
        "endpoints": {"health": "/health", "hello": "/hello", "time": "/time", "visitors": "/visitors", "stats": "/stats"},
    }

@app.get("/hello")
async def hello():
    return {"message": "Hello from 3-Tier Architecture!", "tiers": ["CloudFront/ALB", "EC2", "RDS/Redis"]}

@app.get("/time")
async def get_time(cache=Depends(get_redis)):
    try:
        cached = await cache.get("ph_time")
        if cached:
            data = json.loads(cached)
            data["from_cache"] = True
            return data
    except: pass

    now = datetime.now(PH_TZ)
    data = {"timezone": "Asia/Manila", "current_time": now.strftime("%Y-%m-%d %H:%M:%S"), "day_of_week": now.strftime("%A"), "from_cache": False}

    try:
        await cache.setex("ph_time", 1, json.dumps(data))
    except: pass

    return data

@app.get("/time-html", response_class=HTMLResponse)
async def get_time_html(request: Request):
    now = datetime.now(PH_TZ)
    return templates.TemplateResponse("time.html", {
        "request": request,
        "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "Asia/Manila (PST)",
        "day_of_week": now.strftime("%A"),
        "date_formatted": now.strftime("%B %d, %Y"),
    })

@app.post("/visitors")
async def create_visitor(visitor: VisitorCreate, conn=Depends(get_db), cache=Depends(get_redis)):
    existing = await conn.fetchrow("SELECT id, visit_count FROM visitors WHERE name = $1", visitor.name)
    if existing:
        result = await conn.fetchrow(
            "UPDATE visitors SET message = $1, visit_time = NOW(), visit_count = visit_count + 1 WHERE name = $2 RETURNING *",
            visitor.message, visitor.name
        )
    else:
        result = await conn.fetchrow(
            "INSERT INTO visitors (name, message) VALUES ($1, $2) RETURNING *",
            visitor.name, visitor.message
        )

    try:
        await cache.delete(f"visitor:{visitor.name}", "visitors:all", "stats")
    except: pass

    return {"id": result["id"], "name": result["name"], "message": result["message"],
            "visit_time": result["visit_time"].isoformat(), "visit_count": result["visit_count"]}

@app.get("/visitors")
async def get_visitors(limit: int = 10, conn=Depends(get_db), cache=Depends(get_redis)):
    try:
        cached = await cache.get("visitors:all")
        if cached:
            return {"visitors": json.loads(cached), "from_cache": True}
    except: pass

    rows = await conn.fetch("SELECT * FROM visitors ORDER BY visit_time DESC LIMIT $1", limit)
    visitors = [{"id": r["id"], "name": r["name"], "message": r["message"],
                 "visit_time": r["visit_time"].isoformat(), "visit_count": r["visit_count"]} for r in rows]

    try:
        await cache.setex("visitors:all", CACHE_TTL, json.dumps(visitors))
    except: pass

    return {"visitors": visitors, "from_cache": False}

@app.get("/stats")
async def get_stats(conn=Depends(get_db), cache=Depends(get_redis)):
    try:
        cached = await cache.get("stats")
        if cached:
            data = json.loads(cached)
            data["from_cache"] = True
            return data
    except: pass

    stats = await conn.fetchrow("""
        SELECT COUNT(*) as total_visitors, COALESCE(SUM(visit_count), 0) as total_visits,
               MAX(visit_time) as last_visit FROM visitors
    """)
    top = await conn.fetch("SELECT name, visit_count FROM visitors ORDER BY visit_count DESC LIMIT 5")

    data = {
        "total_visitors": stats["total_visitors"],
        "total_visits": stats["total_visits"],
        "last_visit": stats["last_visit"].isoformat() if stats["last_visit"] else None,
        "top_visitors": [{"name": v["name"], "visits": v["visit_count"]} for v in top],
        "from_cache": False,
    }

    try:
        await cache.setex("stats", CACHE_TTL, json.dumps(data))
    except: pass

    return data

@app.get("/cache/stats")
async def cache_stats(cache=Depends(get_redis)):
    info = await cache.info()
    return {"used_memory": info.get("used_memory_human"), "connected_clients": info.get("connected_clients"),
            "keyspace_hits": info.get("keyspace_hits"), "keyspace_misses": info.get("keyspace_misses")}
`;
  }

  /**
   * Time HTML template
   */
  private getTimeTemplate(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Philippine Time - 3-Tier</title>
    <style>
        body { font-family: system-ui; background: linear-gradient(135deg, #1a1a2e, #0f3460); min-height: 100vh; display: flex; justify-content: center; align-items: center; color: #fff; margin: 0; }
        .container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 20px; }
        h1 { color: #e94560; }
        .time { font-size: 3rem; font-family: monospace; margin: 1rem 0; }
        .date { color: #4ecca3; }
        .badge { margin-top: 1.5rem; padding: 1rem; background: rgba(255,153,0,0.2); border-radius: 10px; }
        .badge h3 { color: #ff9900; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Philippine Time</h1>
        <p>{{ timezone }}</p>
        <div class="time">{{ current_time.split(" ")[1] }}</div>
        <div class="date">{{ date_formatted }} - {{ day_of_week }}</div>
        <div class="badge"><h3>3-Tier: CloudFront → EC2 → PostgreSQL + Redis</h3></div>
    </div>
</body>
</html>`;
  }
}
