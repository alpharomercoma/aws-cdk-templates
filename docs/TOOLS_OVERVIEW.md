# Management Tools

## CDK Template Deployer

**Purpose**: Deploy any CDK template with guided setup

**Script**: `deploy-cdk-project.sh`

**Workflow**:
```bash
./deploy-cdk-project.sh      # Select template
# → Install dependencies
# → Review changes
# → Deploy
# → (EC2) Auto-create starter
```

**Features**:
- Auto-discovers templates
- Handles dependencies + bootstrap
- Shows diff before deploy
- EC2 integration (auto-starts create-start-script.sh)

**Use Case**: Initial deployment, testing templates

---

## EC2 Instance Launcher

**Purpose**: Start EC2 instances with one command + automatic SSH

**Script**: `create-start-script.sh`

**Workflow**:
```bash
./create-start-script.sh     # Setup once
start-aws-myproject          # Start + configure
ssh myproject                # Connect
```

**Features**:
- Multi-region instance discovery
- Automatic SSH config management
- Dynamic IP updates
- Desktop notifications

**Use Case**: Daily dev work with EC2 instances

---

## CDK Stack Destroyer

**Purpose**: Safely destroy CDK stacks with confirmations

**Script**: `destroy-cdk-project.sh`

**Workflow**:
```bash
./destroy-cdk-project.sh     # Select project
# → Review resources
# → Confirm twice
# → Destroy
```

**Features**:
- Auto-discovers CDK projects
- Shows all resources before deletion
- Multiple confirmation layers
- Safe defaults (No)

**Use Case**: Clean up test/dev environments

---

## Quick Comparison

| Feature | Deployer | EC2 Launcher | Destroyer |
|---------|----------|--------------|-----------|
| Purpose | Deploy | Start/SSH | Destroy |
| Destructive | No | No | Yes ⚠️ |
| Frequency | Once | Daily | Rarely |
| Confirmations | 1 | None | 2 |
| Auto-discovery | Templates | Instances | Projects |
| EC2 Integration | Yes | N/A | No |
| Requirements | CDK CLI | AWS CLI | CDK CLI |

---

## Complete Workflow

```bash
# 1. Deploy a template
./deploy-cdk-project.sh
# → Select ec2-autoshutdown
# → Deploys + creates starter automatically

# 2. Daily usage
start-aws-ec2-autoshutdown   # Start instance
ssh ec2-autoshutdown         # Connect

# 3. Cleanup
./destroy-cdk-project.sh
# → Select ec2-autoshutdown
# → Destroys everything
```

---

## Getting Started

1. Choose your tool:
   - **New deployment?** → Use Deployer
   - **Existing instance?** → Use EC2 Launcher
   - **Clean up?** → Use Destroyer

2. Read the guide:
   - [Deployer Guide](DEPLOY_CDK_GUIDE.md)
   - [EC2 Launcher Guide](START_SCRIPT_GUIDE.md)
   - [Destroyer Guide](DESTROY_CDK_GUIDE.md)

3. Run and follow prompts
