# Example: CDK Stack Destruction Process

This document shows what happens when you run the CDK destroyer script.

## Command

```bash
./destroy-cdk-project.sh
```

## Full Interactive Session

```
╔═══════════════════════════════════════════╗
║   AWS CDK Stack Destroyer                ║
╚═══════════════════════════════════════════╝

⚠️  WARNING: This will permanently destroy AWS resources

Checking AWS credentials...
✓ Connected to AWS Account: 123456789012
✓ Region: us-east-1

Step 1: Discovering CDK Projects
Scanning directory: /home/ubuntu/dev/aws-cdk-templates

Available CDK Projects:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No.  Project Name              Stacks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.   aws-3tier-app              Aws3TierAppStack
2.   ec2-autoshutdown           Ec2AutoshutdownStack
3.   trainium-spot              TrainiumSpotStack
4.   aws-infra-poc              AwsInfraPocStack
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select project number (1-4) or 'q' to quit: 2

Selected Project:
  Name: ec2-autoshutdown
  Path: /home/ubuntu/dev/aws-cdk-templates/ec2-autoshutdown/
  Description: EC2 auto-shutdown scheduler

Step 2: Analyzing Stacks
Fetching stack information...

Stacks to be destroyed:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Ec2AutoshutdownStack
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Checking deployed resources...

Stack: Ec2AutoshutdownStack
  - AWS::Lambda::Function: ShutdownFunction
  - AWS::Events::Rule: DailyShutdownRule
  - AWS::IAM::Role: ShutdownFunctionRole
  - AWS::Lambda::Permission: ShutdownPermission
  - AWS::Logs::LogGroup: ShutdownLogGroup
  - AWS::CloudWatch::Alarm: HighCPUAlarm

⚠️  DANGER ZONE ⚠️

This will permanently delete:
  • 1 stack(s) from project 'ec2-autoshutdown'
  • All AWS resources managed by these stacks
  • Data may be lost permanently

Account: 123456789012
Region: us-east-1

Type the project name 'ec2-autoshutdown' to continue (or anything else to cancel): ec2-autoshutdown

Are you ABSOLUTELY SURE you want to destroy these stacks? [y/N]: y

Starting destruction process...

Step 3: Destroying Stacks

Executing: cdk destroy --all --force

Ec2AutoshutdownStack: destroying...

Ec2AutoshutdownStack: destroying... 0/11 | 12:34:56 PM | DELETE_IN_PROGRESS   | AWS::CloudFormation::Stack | Ec2AutoshutdownStack
Ec2AutoshutdownStack: destroying... 1/11 | 12:34:58 PM | DELETE_IN_PROGRESS   | AWS::CloudWatch::Alarm | HighCPUAlarm
Ec2AutoshutdownStack: destroying... 2/11 | 12:35:00 PM | DELETE_COMPLETE      | AWS::CloudWatch::Alarm | HighCPUAlarm
Ec2AutoshutdownStack: destroying... 3/11 | 12:35:02 PM | DELETE_IN_PROGRESS   | AWS::Lambda::Permission | ShutdownPermission
Ec2AutoshutdownStack: destroying... 4/11 | 12:35:04 PM | DELETE_COMPLETE      | AWS::Lambda::Permission | ShutdownPermission
Ec2AutoshutdownStack: destroying... 5/11 | 12:35:06 PM | DELETE_IN_PROGRESS   | AWS::Events::Rule | DailyShutdownRule
Ec2AutoshutdownStack: destroying... 6/11 | 12:35:08 PM | DELETE_COMPLETE      | AWS::Events::Rule | DailyShutdownRule
Ec2AutoshutdownStack: destroying... 7/11 | 12:35:10 PM | DELETE_IN_PROGRESS   | AWS::Lambda::Function | ShutdownFunction
Ec2AutoshutdownStack: destroying... 8/11 | 12:35:15 PM | DELETE_COMPLETE      | AWS::Lambda::Function | ShutdownFunction
Ec2AutoshutdownStack: destroying... 9/11 | 12:35:17 PM | DELETE_IN_PROGRESS   | AWS::Logs::LogGroup | ShutdownLogGroup
Ec2AutoshutdownStack: destroying... 10/11 | 12:35:19 PM | DELETE_COMPLETE     | AWS::Logs::LogGroup | ShutdownLogGroup
Ec2AutoshutdownStack: destroying... 11/11 | 12:35:21 PM | DELETE_IN_PROGRESS  | AWS::IAM::Role | ShutdownFunctionRole
Ec2AutoshutdownStack: destroying... 11/11 | 12:35:35 PM | DELETE_COMPLETE     | AWS::IAM::Role | ShutdownFunctionRole

 ✅  Ec2AutoshutdownStack: destroyed

╔═══════════════════════════════════════════╗
║   Destruction Complete                   ║
╚═══════════════════════════════════════════╝

✓ All stacks from 'ec2-autoshutdown' have been destroyed

```

## Desktop Notification

If `notify-send` is available:

**Notification**: "AWS CDK - Project 'ec2-autoshutdown' has been destroyed"

## Cancellation Examples

### Example 1: Wrong Project Name

```
Type the project name 'ec2-autoshutdown' to continue (or anything else to cancel): ec2-shutdown
Cancelled. No resources were destroyed.
```

### Example 2: Final Confirmation Refused

```
Type the project name 'ec2-autoshutdown' to continue (or anything else to cancel): ec2-autoshutdown

Are you ABSOLUTELY SURE you want to destroy these stacks? [y/N]: n
Cancelled. No resources were destroyed.
```

### Example 3: Quit at Selection

```
Select project number (1-4) or 'q' to quit: q
Cancelled.
```

## Error Scenarios

### Scenario 1: S3 Bucket Not Empty

```
Step 3: Destroying Stacks

Executing: cdk destroy --all --force

Ec2AutoshutdownStack: destroying...

 ❌  Ec2AutoshutdownStack failed: Error: The bucket you tried to delete is not empty. You must delete all versions in the bucket.

╔═══════════════════════════════════════════╗
║   Destruction Failed                     ║
╚═══════════════════════════════════════════╝

Some stacks failed to destroy.
Check the output above for details.

Common issues:
  • Resources have dependencies that must be removed first
  • S3 buckets that need to be emptied first
  • Resources protected from deletion
```

### Scenario 2: No Dependencies Installed

```
Selected Project:
  Name: trainium-spot
  Path: /home/ubuntu/dev/aws-cdk-templates/trainium-spot/
  Description: Trainium Spot instance deployment

⚠️  Dependencies not installed.
Install dependencies now? [Y/n]: y

Installing dependencies...
npm install

added 234 packages in 15s
✓ Dependencies installed

Step 2: Analyzing Stacks
[continues normally...]
```

### Scenario 3: Stack Not Deployed

```
Stack: TestStack
  (Stack not deployed or unable to fetch resources)

[This is safe - the script will skip this stack]
```

## Timeline

**Typical destruction times:**

- **Small stack** (Lambda + EventBridge): ~30-45 seconds
- **Medium stack** (EC2 + VPC + Security Groups): ~2-5 minutes
- **Large stack** (RDS + NAT Gateway + Load Balancer): ~10-30 minutes

**Longest-running deletions:**
- RDS Instances: 5-15 minutes
- NAT Gateways: 3-5 minutes
- ECS Services: 3-10 minutes
- Load Balancers: 2-5 minutes

## What Gets Deleted

### CloudFormation Resources
✅ All resources defined in CDK stacks
✅ IAM roles and policies created by CDK
✅ CloudWatch log groups
✅ Lambda functions
✅ EC2 instances and related resources
✅ VPCs, subnets, and network resources

### Potentially Retained Resources
⚠️ S3 buckets with retention policies
⚠️ DynamoDB tables with point-in-time recovery
⚠️ EBS snapshots (if configured to retain)
⚠️ CloudWatch Logs with retention settings
⚠️ Resources created outside of CDK

## Verification After Destruction

Check that resources are gone:

```bash
# Check CloudFormation stacks
aws cloudformation list-stacks \
  --stack-status-filter DELETE_COMPLETE \
  --query 'StackSummaries[?StackName==`Ec2AutoshutdownStack`]'

# Should return empty or show DELETE_COMPLETE status

# Check for any remaining resources manually
aws lambda list-functions | grep Shutdown
aws events list-rules | grep Shutdown
```

## Cost Impact

After successful destruction:
- ✅ No more charges for destroyed resources
- ✅ Associated data transfer charges stop
- ⏱️ Charges may appear for up to 1 hour after deletion (AWS billing lag)
- 💰 Check AWS Cost Explorer after 24 hours to confirm

## Recovery

⚠️ **Destruction is permanent** - there is no "undo"

If you need to restore:
1. Redeploy the CDK stack: `cdk deploy`
2. Restore data from backups (if available)
3. Reconfigure any manual settings

## Best Practices Demonstrated

1. ✅ **Multiple confirmations** prevent accidental destruction
2. ✅ **Resource preview** shows what will be deleted
3. ✅ **Default to safe** - all prompts default to "No"
4. ✅ **Clear feedback** with colored output and progress
5. ✅ **Account/region display** prevents wrong-account destruction
6. ✅ **Graceful error handling** with helpful messages
