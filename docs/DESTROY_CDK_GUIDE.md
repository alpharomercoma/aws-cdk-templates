# CDK Stack Destroyer

⚠️ **WARNING**: Permanently deletes AWS resources.

## Quick Start

```bash
./destroy-cdk-project.sh
# Select project → review resources → confirm twice → destroy
```

## How It Works

1. **Discovery**: Finds all CDK projects in the repository
2. **Selection**: Choose project from a table
3. **Analysis**: Lists all stacks and resources
4. **Confirmation**:
   - Type exact project name
   - Final yes/no (defaults to "No")
5. **Destruction**: Runs `cdk destroy --all --force`

## Safety Features

### Multi-Layer Protection
1. Shows all resources before destroying
2. Requires typing exact project name
3. Final confirmation (default: No)
4. No accidental deletions possible

### What You'll See
```
Available CDK Projects:
----------------------------------------
No.  Project Name         Stacks
----------------------------------------
1.   ec2-autoshutdown     Ec2AutoshutdownStack
2.   trainium-spot        TrainiumSpotStack
----------------------------------------

Select project: 1

Stacks to be destroyed:
  • Ec2AutoshutdownStack

Resources:
  - AWS::Lambda::Function: ShutdownFunction
  - AWS::Events::Rule: DailyShutdownRule
  - AWS::IAM::Role: ShutdownFunctionRole
  ...

Type 'ec2-autoshutdown' to continue: ec2-autoshutdown
Are you ABSOLUTELY SURE? [y/N]: y

[Destroying...]
```

## Requirements

- AWS CDK CLI: `npm install -g aws-cdk`
- AWS CLI configured
- IAM permissions for CloudFormation stack deletion
- Node.js + npm (for dependency installation)

## Common Issues

**S3 bucket not empty**
- Empty bucket first or enable auto-delete in CDK code

**Dependencies not installed**
- Script will prompt to run `npm install` automatically

**Resources still exist**
- Check CloudFormation console for failed deletions
- Some resources (snapshots, etc.) may be retained

## After Destruction

Verify everything is gone:
```bash
aws cloudformation list-stacks --region us-east-1
```

Check for leftover resources in AWS Console.
