# CDK Template Deployer

Deploy any CDK template from this repository with guided prompts.

## Quick Start

```bash
./deploy-cdk-project.sh
# Select template → auto-install dependencies → deploy
# For EC2 templates: optionally create start script
```

## How It Works

1. **Discovery**: **Dynamically scans** repository for any directory with `cdk.json`
2. **Selection**: Choose from available templates (list updates as you add/remove templates)
3. **Dependencies**: Auto-installs npm packages if needed
4. **Bootstrap**: Checks/runs CDK bootstrap if required
5. **Review**: Shows `cdk diff` before deploying
6. **Deploy**: Runs `cdk deploy` with auto-approval
7. **Integration**: For EC2 templates, offers to create start script

**Note**: The template list is completely dynamic - add a new CDK project to the repo and it will appear automatically.

## What You'll See

The script **automatically discovers** all CDK templates in the repository:

```
Available CDK Templates:
----------------------------------------
No.  Template              Description
----------------------------------------
1.   ec2-autoshutdown      EC2 with auto-shutdown
2.   trainium-spot         ML workload spot instance
----------------------------------------
(List is dynamic - shows all templates with cdk.json)

Select template: 1

✓ Selected: ec2-autoshutdown
  Path: /home/ubuntu/dev/aws-cdk-templates/ec2-autoshutdown/

Installing Dependencies...
✓ Dependencies installed

CDK Bootstrap Check...
✓ CDK already bootstrapped

Reviewing Changes...
[cdk diff output]

Deploy this stack? [Y/n]: y

Deploying Stack...
[deployment progress]

╔═══════════════════════════════════════════╗
║   Deployment Successful                  ║
╚═══════════════════════════════════════════╝

Stack Outputs:
  InstanceId: i-0123456789abcdef0
  SSHKeyPath: ./ec2-key.pem

╔═══════════════════════════════════════════╗
║   EC2 Instance Detected                  ║
╚═══════════════════════════════════════════╝

Create start script for this instance? [Y/n]: y

[Launches create-start-script.sh automatically]
```

## EC2 Integration

For templates that deploy EC2 instances:

1. Deployment completes
2. Script detects EC2 instance in outputs
3. Prompts to create start script
4. Automatically launches `create-start-script.sh`
5. You select the deployed instance
6. Complete end-to-end setup!

## Complete Workflow Example

```bash
# 1. Deploy template
./deploy-cdk-project.sh
# Select: ec2-autoshutdown
# Deploy: yes
# Create starter: yes
# → Automatically finds new instance
# → Configure project name + SSH key

# 2. Start instance
start-aws-ec2-autoshutdown

# 3. Connect
ssh ec2-autoshutdown

# 4. When done, destroy
./destroy-cdk-project.sh
# Select: ec2-autoshutdown
# Confirm: yes
```

## Requirements

- AWS CLI configured
- AWS CDK CLI: `npm install -g aws-cdk`
- Node.js + npm
- IAM permissions for CloudFormation

## Features

**Automatic Dependency Management**
- Checks for `node_modules`
- Runs `npm install` if needed

**Bootstrap Handling**
- Checks if CDK is bootstrapped
- Offers to bootstrap if not
- Per-region check

**Review Before Deploy**
- Shows `cdk diff` output
- Confirm before deploying
- See exactly what will change

**Output Parsing**
- Captures stack outputs
- Detects EC2 instances
- Extracts instance ID and SSH key path

**Seamless Integration**
- Chains to `create-start-script.sh` for EC2
- Complete deployment-to-connection workflow
- No manual copying of instance IDs

## Troubleshooting

**"CDK not bootstrapped"**
- Accept the bootstrap prompt
- Or manually: `cdk bootstrap`

**"Dependencies failed to install"**
- Check Node.js version
- Try manual: `cd <template> && npm install`

**"Deployment failed"**
- Check CloudFormation console for errors
- Common: insufficient IAM permissions
- Check stack limits in your account

**No EC2 integration prompt**
- Template may not output instance info
- Manually run `create-start-script.sh` after deployment
