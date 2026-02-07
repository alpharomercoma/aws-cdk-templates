# AWS EC2 Start Script Generator

This tool creates personalized starter scripts for your AWS EC2 instances. Each script is tailored to your project and can be run with a simple keyword command.

**NEW**: Automatic SSH config management! No manual setup required - just run the start script and SSH is configured automatically.

## Quick Start

1. **Run the generator:**
   ```bash
   ./create-start-script.sh
   ```

2. **Follow the prompts:**
   - Select your EC2 instance from the auto-discovered list
   - Confirm or customize your project name (auto-suggested from instance Name tag)

3. **Start your instance:**
   ```bash
   start-aws-<your-project-name>
   ```

4. **Connect via SSH:**
   ```bash
   ssh <your-project-name>
   ```

## Features

✅ **Auto-discovery**: Automatically queries AWS for your EC2 instances
✅ **Multi-region by default**: Searches all AWS regions to find all your instances
✅ **Smart naming**: Uses EC2 Name tag or derives from current directory
✅ **Safe overwrites**: Prompts before replacing existing scripts (defaults to "no")
✅ **Region-aware**: Handles instances in any AWS region
✅ **Automatic SSH config**: Creates and updates ~/.ssh/config automatically
✅ **Desktop notifications**: Visual feedback on Linux desktops (i3, GNOME, etc.)
✅ **Clean output**: Simple, straightforward table display

## Example Walkthrough

```bash
$ ./create-start-script.sh

╔═══════════════════════════════════════════╗
║   AWS EC2 Start Script Generator         ║
╚═══════════════════════════════════════════╝

Checking AWS credentials...
✓ AWS credentials valid

Step 1: Discovering EC2 Instances

Search all regions? [Y/n] (recommended): Y

Scanning all regions...
..................

Available EC2 Instances:
--------------------------------------------------------------------------------------------------------
No.  Name                 Instance ID            State        Type            Region
--------------------------------------------------------------------------------------------------------
1.   dev-server           i-0a1b2c3d4e5f6g7h8    stopped      t3.medium       us-east-1
2.   ml-workstation       i-0123456789abcdef0    running      g4dn.xlarge     us-west-2
3.   web-app-prod         i-0fedcba987654321     running      t3.large        ap-southeast-1
--------------------------------------------------------------------------------------------------------

Select instance number (1-3) or 'q' to quit: 1

✓ Selected: dev-server (i-0a1b2c3d4e5f6g7h8) in us-east-1

Step 2: Project Configuration
Suggested project name: dev-server

Use 'dev-server' as project name? [Y/n]: y
✓ Project name set to: dev-server

Step 3: Generating Script
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
1. Run your script to start the instance:
   start-aws-dev-server

2. SSH config will be automatically created at ~/.ssh/config
   Update the IdentityFile path if needed (default: ~/.ssh/your-key.pem)

3. Connect via SSH:
   ssh dev-server

✨ All done! Your AWS starter is ready.
```

## What the Generated Script Does

When you run `start-aws-<project>`, it will:

1. 🚀 Start your EC2 instance in the correct AWS region
2. ⏳ Wait for the instance to fully boot and pass status checks
3. 📍 Retrieve the new public IP address
4. 🔄 **Automatically create/update SSH config** at `~/.ssh/config`
5. 💻 Send desktop notification
6. ✅ Display connection information

The script is region-aware and will automatically use the correct region for your instance.

## SSH Config - Automatic Management

**No manual setup required!** The start script automatically:

1. **Creates** SSH config block on first run:
   ```
   # TRAINIUM_AWS_START
   Host trainium
     HostName <dynamic-ip>
     User ubuntu
     IdentityFile ~/.ssh/your-key.pem
     StrictHostKeyChecking no
     UserKnownHostsFile /dev/null
   # TRAINIUM_AWS_END
   ```

2. **Updates** the IP address every time you start the instance
3. **Preserves** your manual edits (like changing IdentityFile path)

### Customizing SSH Config

After the first run, you can edit `~/.ssh/config` to:
- Change the key file: `IdentityFile ~/.ssh/my-actual-key.pem`
- Add SSH options: `ForwardAgent yes`, `LocalForward 8080 localhost:8080`, etc.
- Change the username: `User ec2-user` (for Amazon Linux)

The script will only update the `HostName` line - your other changes are preserved.

## Instance Discovery

The script automatically queries your AWS account for EC2 instances:

- **Multi-Region by Default**: Recommends searching all regions to find all instances
- **Single Region Option**: Can search just the default region if preferred
- **Visual Display**: Shows instance Name, ID, State, Type, and Region in a simple table
- **All Instances**: Finds instances in any AWS region across your account

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
