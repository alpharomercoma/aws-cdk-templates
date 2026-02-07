# AWS EC2 Start Script Generator

This tool creates personalized starter scripts for your AWS EC2 instances. Each script is tailored to your project and can be run with a simple keyword command.

**NEW**: The script now automatically discovers your EC2 instances from AWS - no need to manually copy instance IDs!

## Quick Start

1. **Run the generator:**
   ```bash
   ./create-start-script.sh
   ```

2. **Follow the prompts:**
   - Select your EC2 instance from the auto-discovered list
   - Confirm or customize your project name (auto-suggested from instance Name tag)
   - (Optional) Set SSH config marker name

3. **Use your new starter:**
   ```bash
   start-aws-<your-project-name>
   ```

## Features

✅ **Auto-discovery**: Automatically queries AWS for your EC2 instances
✅ **Multi-region support**: Search in default region or all regions
✅ **Smart naming**: Uses EC2 Name tag or derives from current directory
✅ **Safe overwrites**: Prompts before replacing existing scripts (defaults to "no")
✅ **Region-aware**: Handles instances in any AWS region
✅ **SSH integration**: Optionally updates SSH config with new IP
✅ **Desktop notifications**: Visual feedback on Linux desktops (i3, GNOME, etc.)
✅ **User-friendly**: Colored output, table display, and progress indicators

## Example Walkthrough

```bash
$ ./create-start-script.sh

╔═══════════════════════════════════════════╗
║   AWS EC2 Start Script Generator         ║
╚═══════════════════════════════════════════╝

Checking AWS credentials...
✓ AWS credentials valid

Step 1: Discovering EC2 Instances
Searching in region: us-east-1

Available EC2 Instances:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No.  Name                 Instance ID            State        Type            Region
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1.   dev-server           i-0a1b2c3d4e5f6g7h8    stopped      t3.medium       us-east-1
2.   ml-workstation       i-0123456789abcdef0    running      g4dn.xlarge     us-west-2
3.   web-app-prod         i-0fedcba987654321     running      t3.large        us-east-1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select instance number (1-3) or 'q' to quit: 1

✓ Selected: dev-server (i-0a1b2c3d4e5f6g7h8) in us-east-1

Step 2: Project Configuration
Suggested project name: dev-server

Use 'dev-server' as project name? [Y/n]: y
✓ Project name set to: dev-server

Step 3: SSH Configuration (Optional)
If you want to update SSH config, enter the host marker name.
SSH config marker name [default: DEV-SERVER_AWS]:

Step 4: Generating Script
Creating: /home/user/.local/bin/start-aws-dev-server

✓ Script created successfully!

═══════════════════════════════════════════
Summary:
  Script name:    start-aws-dev-server
  Location:       /home/user/.local/bin/start-aws-dev-server
  Instance ID:    i-0a1b2c3d4e5f6g7h8
  Region:         us-east-1
  Project name:   dev-server
  SSH marker:     DEV-SERVER_AWS
═══════════════════════════════════════════

Next Steps:
1. Run your script anytime with:
   start-aws-dev-server

2. (Optional) Add SSH config entry between markers:
   # DEV-SERVER_AWS_START
   Host dev-server
   HostName <will-be-updated>
   User ubuntu
   IdentityFile ~/.ssh/your-key.pem
   StrictHostKeyChecking no
   UserKnownHostsFile /dev/null
   # DEV-SERVER_AWS_END

✨ All done! Your AWS starter is ready.
```

## What the Generated Script Does

When you run `start-aws-<project>`, it will:

1. 🚀 Start your EC2 instance in the correct AWS region
2. ⏳ Wait for the instance to fully boot and pass status checks
3. 📍 Retrieve the new public IP address
4. 🔄 Update your SSH config (if markers are present)
5. 💻 Send desktop notification
6. ✅ Display connection information

The script is region-aware and will automatically use the correct region for your instance.

## SSH Config Integration (Optional)

To enable automatic IP updates, add this to `~/.ssh/config`:

```
# YOUR_PROJECT_AWS_START
Host my-project
  HostName 1.2.3.4
  User ubuntu
  IdentityFile ~/.ssh/my-key.pem
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# YOUR_PROJECT_AWS_END
```

The marker name is generated automatically (e.g., `DEV-SERVER_AWS` for a project named "dev-server"). The `HostName` line will be automatically updated each time the instance starts with the new public IP.

## Instance Discovery

The script automatically queries your AWS account for EC2 instances:

- **Default Region**: Searches your configured default region first
- **All Regions**: If no instances are found, offers to search all AWS regions
- **Visual Display**: Shows instance Name, ID, State, Type, and Region in a table
- **State Indicators**: Color-coded states (🟢 running, 🟡 stopped, 🔴 other)

## Requirements

- AWS CLI configured with credentials (`aws configure`)
- Proper IAM permissions:
  - `ec2:DescribeInstances` - To list instances
  - `ec2:StartInstances` - To start instances
  - `ec2:DescribeRegions` - To search all regions (optional)
- `~/.local/bin` in your PATH (usually automatic in Fedora/Ubuntu)

## Adding ~/.local/bin to PATH

If the command isn't found, add this to your `~/.bashrc` or `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then reload:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

## Managing Multiple Projects

Create a starter for each project/instance:

```bash
# Project 1
cd ~/dev/web-app
./create-start-script.sh
# Creates: start-aws-web-app

# Project 2
cd ~/dev/api-server
./create-start-script.sh
# Creates: start-aws-api-server
```

## Troubleshooting

**"AWS credentials not configured"**
- Run `aws configure` to set up your credentials
- You need AWS Access Key ID and Secret Access Key

**"No EC2 instances found"**
- Verify you have instances: `aws ec2 describe-instances`
- Check your default region: `aws configure get region`
- Try searching all regions when prompted

**"Command not found" (after creating script)**
- Make sure `~/.local/bin` is in your PATH
- Run `chmod +x ~/.local/bin/start-aws-*` if needed
- Restart your terminal or run `source ~/.bashrc`

**"Failed to start instance"**
- Check AWS credentials: `aws sts get-caller-identity`
- Ensure IAM permissions include `ec2:StartInstances` and `ec2:DescribeInstances`
- Verify the instance is in a startable state (stopped)

**"Permission denied" errors**
- Check IAM policies attached to your user/role
- Instance may be in a different account or restricted

**Script exists but won't run**
- Make it executable: `chmod +x ~/.local/bin/start-aws-<project>`

## Customization

The generated scripts are standalone bash files. You can edit them directly in `~/.local/bin/` to:
- Change notification messages
- Add post-start commands
- Modify SSH config behavior
- Add error handling

## Uninstalling

To remove a starter script:
```bash
rm ~/.local/bin/start-aws-<project-name>
```
