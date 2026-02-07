# EC2 Instance Launcher

Auto-discover EC2 instances and create one-command starters with automatic SSH config.

## Quick Start

```bash
./create-start-script.sh
# Select instance → set project name → specify SSH key
# Creates: start-aws-<project-name>

start-aws-<project-name>
# Starts instance + auto-configures SSH

ssh <project-name>
# Connect!
```

## How It Works

1. **Discovery**: Scans all AWS regions for EC2 instances
2. **Selection**: Choose your instance from a table
3. **Configuration**: Set project name and SSH key path
4. **Generation**: Creates a start script in `~/.local/bin/`
5. **Automation**: Script handles starting + SSH config on each run

## What the Start Script Does

```
start-aws-myproject
```

1. Starts EC2 instance in the correct region
2. Waits for boot + status checks
3. Gets new public IP
4. **Automatically creates/updates** `~/.ssh/config`:
   ```
   # MYPROJECT_AWS_START
   Host myproject
     HostName <dynamic-ip>
     User ubuntu
     IdentityFile ~/.ssh/your-key.pem
     StrictHostKeyChecking no
     UserKnownHostsFile /dev/null
   # MYPROJECT_AWS_END
   ```
5. Desktop notification (if available)

## SSH Config Management

### First Run
- Creates SSH config block automatically
- Uses the key path you specified during setup

### Subsequent Runs
- Updates only the `HostName` (IP address)
- Preserves your customizations (user, key, options)

### Customization
Edit `~/.ssh/config` to add options:
```
# MYPROJECT_AWS_START
Host myproject
  HostName 54.123.45.67           # ← Auto-updated
  User ubuntu                      # ← Change if needed
  IdentityFile ~/.ssh/mykey.pem   # ← Your actual key
  ForwardAgent yes                 # ← Add custom options
  LocalForward 8888 localhost:8888
# MYPROJECT_AWS_END
```

## Requirements

- AWS CLI v2 configured (`aws configure`)
- IAM permissions:
  - `ec2:DescribeInstances`
  - `ec2:DescribeRegions`
  - `ec2:StartInstances`
- SSH private key for your instances

## Multiple Projects

Create separate starters for different instances:

```bash
# Project 1
./create-start-script.sh
# Select instance 1 → creates start-aws-project1

# Project 2
./create-start-script.sh
# Select instance 2 → creates start-aws-project2
```

## Troubleshooting

**No instances found**
- Check default region: `aws configure get region`
- Verify credentials: `aws sts get-caller-identity`
- Ensure instances exist: `aws ec2 describe-instances`

**"Command not found"**
- Add to PATH: `export PATH="$HOME/.local/bin:$PATH"`
- Add to `~/.bashrc` and run `source ~/.bashrc`

**SSH connection fails**
- Verify key path in `~/.ssh/config`
- Check key permissions: `chmod 400 ~/.ssh/your-key.pem`
- Ensure security group allows SSH (port 22)

**Wrong key path**
- Edit `~/.ssh/config` and update `IdentityFile`
- Or regenerate: `./create-start-script.sh` (select same instance, overwrite)
