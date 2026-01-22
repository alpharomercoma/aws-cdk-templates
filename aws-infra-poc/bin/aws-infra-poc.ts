#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AwsInfraPocStack } from '../lib/aws-infra-poc-stack';

/**
 * AWS Infrastructure Proof of Concept
 *
 * This CDK app deploys a comprehensive AWS architecture demonstrating:
 * - WAF (Web Application Firewall)
 * - ALB (Application Load Balancer)
 * - EC2 (t4g.nano with FastAPI)
 * - Route 53 (DNS management)
 * - CloudFront (CDN for static and API)
 * - S3 (Static website hosting)
 * - IAM (Least privilege access)
 *
 * Architecture:
 * - Static content served from S3 via CloudFront
 * - API served from EC2 via ALB and CloudFront
 * - WAF protects both CloudFront distributions
 * - Route 53 provides DNS for both endpoints
 */

const app = new cdk.App();

// Get configuration from context or environment
const domainName = app.node.tryGetContext('domainName');
const hostedZoneId = app.node.tryGetContext('hostedZoneId');

new AwsInfraPocStack(app, 'AwsInfraPocStack', {
  env: {
    region: 'ap-southeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'AWS Infrastructure PoC - WAF, ALB, EC2, Route 53, CloudFront, S3',

  // Optional: Pass domain configuration
  // If not provided, stack will use CloudFront default domains
  domainName,
  hostedZoneId,
});

app.synth();
