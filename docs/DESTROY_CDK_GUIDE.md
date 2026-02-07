# AWS CDK Stack Destroyer Guide

⚠️ **WARNING**: This tool permanently destroys AWS resources. Use with extreme caution.

## Overview

The CDK Stack Destroyer is an interactive script that safely destroys AWS CDK stacks with multiple confirmation prompts and detailed information about what will be deleted.

## Quick Start

```bash
./destroy-cdk-project.sh
```

## Features

🔍 **Auto-discovery**: Automatically finds all CDK projects in the repository
📋 **Resource listing**: Shows all resources that will be destroyed
🔒 **Multiple confirmations**: Requires project name confirmation + final yes/no
🛡️ **Safe defaults**: All destructive prompts default to "No"
🌍 **Region-aware**: Shows account and region information
💻 **Desktop notifications**: Notifies when destruction completes
⚡ **Dependency handling**: Offers to install npm dependencies if needed

## Safety Features

### Multi-Layer Confirmation

1. **Project Selection**: Choose from a list of discovered projects
2. **Resource Review**: See all stacks and resources before proceeding
3. **Name Confirmation**: Must type the exact project name to continue
4. **Final Confirmation**: Yes/No prompt (defaults to No)

### Information Display

Before destruction, the script shows:
- All stacks in the project
- Resources in each stack (up to 20 per stack)
- AWS account ID
- AWS region
- Total resource count

## Example Walkthrough

```bash
$ ./destroy-cdk-project.sh

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
--------------------------------------------------------------------------------------------------------
No.  Project Name              Stacks
--------------------------------------------------------------------------------------------------------
1.   aws-3tier-app              Aws3TierAppStack
2.   ec2-autoshutdown           Ec2AutoshutdownStack
3.   trainium-spot              TrainiumSpotStack
4.   aws-infra-poc              AwsInfraPocStack
--------------------------------------------------------------------------------------------------------

Select project number (1-4) or 'q' to quit: 2

Selected Project:
  Name: ec2-autoshutdown
  Path: /home/ubuntu/dev/aws-cdk-templates/ec2-autoshutdown/
  Description: EC2 auto-shutdown scheduler

Step 2: Analyzing Stacks
Fetching stack information...

Stacks to be destroyed:
--------------------------------------------------------------------------------------------------------
  • Ec2AutoshutdownStack
--------------------------------------------------------------------------------------------------------

Checking deployed resources...

Stack: Ec2AutoshutdownStack
  - AWS::Lambda::Function: ShutdownFunction
  - AWS::Events::Rule: DailyShutdownRule
  - AWS::IAM::Role: ShutdownFunctionRole
  - AWS::Lambda::Permission: ShutdownPermission
  - AWS::Logs::LogGroup: ShutdownLogGroup

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
 ✅  Ec2AutoshutdownStack: destroyed

╔═══════════════════════════════════════════╗
║   Destruction Complete                   ║
╚═══════════════════════════════════════════╝

✓ All stacks from 'ec2-autoshutdown' have been destroyed
```

## When to Use This Tool

✅ **Use when you want to:**
- Permanently remove a CDK project and all its resources
- Clean up testing/development environments
- Decommission infrastructure that's no longer needed
- Free up AWS resources and reduce costs

❌ **DO NOT use if:**
- You only want to update resources (use `cdk deploy` instead)
- You're not sure what resources will be deleted
- Resources contain critical production data
- You haven't backed up important data

## Requirements

- AWS CLI configured with credentials
- AWS CDK CLI installed: `npm install -g aws-cdk`
- Proper IAM permissions for CloudFormation and resource deletion
- Node.js and npm (for CDK projects)

## Common Issues and Solutions

### "Dependencies not installed"

If the project hasn't had `npm install` run, the script will offer to install them automatically.

```
⚠️  Dependencies not installed.
Install dependencies now? [Y/n]: y
```

### "Stack not deployed"

If a stack shows "(Stack not deployed or unable to fetch resources)", it means:
- The stack was never deployed
- The stack was already destroyed manually
- The stack is in a different region/account

This is safe - the script will skip non-existent stacks.

### "Destruction Failed"

Common reasons for failure:

1. **S3 Buckets Not Empty**
   ```
   Solution: Empty the bucket first or enable auto-delete for S3 buckets in CDK
   ```

2. **Resources With Dependencies**
   ```
   Solution: Manually delete dependent resources or update stack to handle dependencies
   ```

3. **Deletion Protection Enabled**
   ```
   Solution: Disable deletion protection in AWS Console or CLI
   ```

4. **Resources Outside Stack**
   ```
   Solution: Manually delete resources created outside CDK
   ```

### Retrying Failed Destructions

If destruction fails, you can:

1. Fix the issue (empty S3 buckets, remove dependencies, etc.)
2. Re-run the script and select the same project
3. Or manually destroy via AWS Console/CLI

## Advanced Usage

### Destroying Specific Stacks

To destroy only specific stacks from a project, manually run:

```bash
cd <project-directory>
cdk destroy <stack-name>
```

### Checking Stack Status

Before destruction, check what's deployed:

```bash
cd <project-directory>
cdk list
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

### Dry Run

To see what would be destroyed without actually destroying:

```bash
cd <project-directory>
cdk destroy --all  # Press 'n' when prompted
```

## Post-Destruction

After successful destruction:

1. ✅ All CloudFormation stacks are deleted
2. ✅ All managed resources are removed
3. ✅ IAM roles and policies created by CDK are deleted
4. ⚠️ Some resources may remain if they were created outside CDK
5. ⚠️ S3 buckets with retention policies may remain

### Verify Destruction

Check that resources are gone:

```bash
# List remaining stacks
aws cloudformation list-stacks --region us-east-1

# Check for leftover resources (example for EC2)
aws ec2 describe-instances --region us-east-1

# Check S3 buckets
aws s3 ls
```

## Best Practices

1. **Review Before Destroying**: Always review the resource list carefully
2. **Backup Data**: Export/backup any important data before destruction
3. **Test in Dev First**: Test destruction process in development environments
4. **Document**: Keep records of what was destroyed and when
5. **Use Cost Explorer**: Monitor AWS costs to ensure resources are actually removed
6. **Check Dependencies**: Ensure no other systems depend on these resources

## Emergency Stop

If you need to stop destruction while it's in progress:

1. Press `Ctrl+C` to interrupt the script
2. Some resources may already be deleted
3. Check AWS Console to see current state
4. May need manual cleanup of partially destroyed stacks

## Troubleshooting

**Script can't find projects**
- Ensure you're running from the repository root
- Check that projects have `cdk.json` and `package.json`

**Permission denied errors**
- Check IAM permissions for CloudFormation
- Ensure you have `cloudformation:DeleteStack` permission
- Some resources may require additional permissions to delete

**Script hangs during destruction**
- CDK destruction can take 5-30 minutes for large stacks
- Check AWS Console for progress
- Some resources (like RDS, NAT Gateways) take longer to delete

**Resources not fully deleted**
- Check for resources with deletion protection
- Some resources may have been created outside CDK
- S3 buckets need to be emptied before deletion

## Related Commands

```bash
# List all CDK projects
ls -d */cdk.json | sed 's|/cdk.json||'

# Check CDK version
cdk --version

# Bootstrap status
aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1
```

## See Also

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [CloudFormation Stack Deletion](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-cli-deleting-stack.html)
- [START_SCRIPT_GUIDE.md](START_SCRIPT_GUIDE.md) - For EC2 instance management
