#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { Aws3TierAppStack } from '../lib/aws-3tier-app-stack';

/**
 * AWS 3-Tier Application
 *
 * This CDK app deploys a production-grade 3-tier architecture:
 *
 * Presentation Tier:
 * - CloudFront (CDN for static and API)
 * - WAF (Web Application Firewall)
 * - S3 (Static website hosting)
 * - Route 53 (DNS - optional)
 *
 * Application Tier:
 * - ALB (Application Load Balancer)
 * - EC2 (FastAPI on t4g.small ARM Graviton)
 *
 * Data Tier:
 * - RDS PostgreSQL (Persistent storage)
 * - ElastiCache Redis (Caching layer)
 * - Secrets Manager (Credential management)
 *
 * Network:
 * - VPC with public, private, and isolated subnets
 * - NAT Gateway for private subnet internet access
 * - Security groups for each tier
 */

const app = new cdk.App();

// Get configuration from context
const domainName = app.node.tryGetContext('domainName');
const hostedZoneId = app.node.tryGetContext('hostedZoneId');

new Aws3TierAppStack(app, 'Aws3TierAppStack', {
  env: {
    region: 'ap-southeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'AWS 3-Tier Application with RDS PostgreSQL, ElastiCache Redis, EC2, ALB, CloudFront, WAF, S3',

  // Optional: Custom domain configuration
  domainName,
  hostedZoneId,
});

app.synth();
