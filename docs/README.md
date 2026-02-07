# Documentation

## Management Tools

### [Deploy CDK Template](DEPLOY_CDK_GUIDE.md)
Deploy any CDK template with guided prompts and EC2 integration.

### [EC2 Instance Launcher](START_SCRIPT_GUIDE.md)
Start EC2 instances with one command + automatic SSH configuration.

### [CDK Stack Destroyer](DESTROY_CDK_GUIDE.md)
Safely destroy CDK stacks with multiple confirmation prompts.

### [Tools Comparison](TOOLS_OVERVIEW.md)
Quick reference comparing all tools.

---

## Quick Links

```bash
# Deploy Template
./deploy-cdk-project.sh        # Deploy + optionally create starter

# EC2 Launcher
./create-start-script.sh       # Setup for existing instance
start-aws-<project>            # Start instance
ssh <project>                  # Connect

# Destroyer
./destroy-cdk-project.sh       # Clean up
```
