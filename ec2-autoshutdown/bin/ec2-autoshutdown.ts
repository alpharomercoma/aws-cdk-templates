#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { Ec2AutoshutdownStack } from '../lib/ec2-autoshutdown-stack';

const app = new cdk.App();
new Ec2AutoshutdownStack(app, 'Ec2AutoshutdownStack', {
  env: {
    region: 'ap-southeast-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  description: 'EC2 instance with auto-shutdown on inactivity detection',
});
