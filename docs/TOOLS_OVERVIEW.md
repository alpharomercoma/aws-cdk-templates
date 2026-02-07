# Management Tools

## EC2 Instance Launcher

**Purpose**: Start EC2 instances with one command + automatic SSH

**Script**: `create-start-script.sh`

**Workflow**:
```bash
./create-start-script.sh    # Setup
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

| Feature | EC2 Launcher | CDK Destroyer |
|---------|--------------|---------------|
| Destructive | No | Yes ⚠️ |
| Frequency | Daily | Rarely |
| Confirmations | None | 2 required |
| Auto-discovery | EC2 instances | CDK projects |
| Requirements | AWS CLI | AWS CLI + CDK CLI |

---

## Getting Started

1. Choose your tool based on needs
2. Read the specific guide:
   - [EC2 Launcher Guide](START_SCRIPT_GUIDE.md)
   - [Destroyer Guide](DESTROY_CDK_GUIDE.md)
3. Run the script
4. Follow the prompts
