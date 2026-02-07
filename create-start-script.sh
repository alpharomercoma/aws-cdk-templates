#!/bin/bash

# AWS EC2 Start Script Generator
# This script creates a personalized starter script for your AWS EC2 instance

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
LOCAL_BIN="$HOME/.local/bin"
SSH_CONFIG="$HOME/.ssh/config"

# Ensure ~/.local/bin exists
mkdir -p "$LOCAL_BIN"

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   AWS EC2 Start Script Generator         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed.${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured.${NC}"
    echo "Run: aws configure"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials valid${NC}"
echo ""

# Get default region
DEFAULT_REGION=$(aws configure get region)
if [ -z "$DEFAULT_REGION" ]; then
    DEFAULT_REGION="us-east-1"
fi

# Function to fetch instances from a region
fetch_instances() {
    local region=$1
    aws ec2 describe-instances \
        --region "$region" \
        --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0],State.Name,InstanceType,Placement.AvailabilityZone]' \
        --output text 2>/dev/null | grep -v "^$" || true
}

# Function to get all regions
get_all_regions() {
    aws ec2 describe-regions --query 'Regions[].RegionName' --output text
}

# Query instances
echo -e "${YELLOW}Step 1: Discovering EC2 Instances${NC}"
echo ""
read -p "Search all regions? [Y/n] (recommended): " search_all
search_all=${search_all:-Y}

if [[ "$search_all" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Scanning all regions...${NC}"
    TEMP_FILE=$(mktemp)

    for region in $(get_all_regions); do
        printf "."
        result=$(fetch_instances "$region")
        if [ -n "$result" ]; then
            echo "$result" | while IFS=$'\t' read -r id name state type zone; do
                echo "$id	$name	$state	$type	$zone	$region" >> "$TEMP_FILE"
            done
        fi
    done
    echo ""
    echo ""

    INSTANCES=$(cat "$TEMP_FILE")
    rm "$TEMP_FILE"
else
    echo "Searching in region: $DEFAULT_REGION"
    echo ""
    INSTANCES=$(fetch_instances "$DEFAULT_REGION")
fi

if [ -z "$INSTANCES" ]; then
    echo -e "${RED}No EC2 instances found.${NC}"
    exit 1
fi

# Parse and display instances
declare -a INSTANCE_IDS
declare -a INSTANCE_NAMES
declare -a INSTANCE_STATES
declare -a INSTANCE_TYPES
declare -a INSTANCE_REGIONS

counter=0
echo "Available EC2 Instances:"
echo "--------------------------------------------------------------------------------------------------------"
printf "%-4s %-20s %-22s %-12s %-15s %-15s\n" "No." "Name" "Instance ID" "State" "Type" "Region"
echo "--------------------------------------------------------------------------------------------------------"

while IFS=$'\t' read -r id name state type zone region; do
    counter=$((counter + 1))

    # Extract region from zone if not provided
    if [ -z "$region" ]; then
        region="${zone%?}"  # Remove last character from zone to get region
    fi

    # Handle empty name
    if [ -z "$name" ] || [ "$name" = "None" ]; then
        name="(no name)"
    fi

    # Truncate long names
    if [ ${#name} -gt 18 ]; then
        name="${name:0:15}..."
    fi

    # Truncate long IDs
    if [ ${#id} -gt 20 ]; then
        id="${id:0:18}.."
    fi

    printf "%-4s %-20s %-22s %-12s %-15s %-15s\n" "$counter." "$name" "$id" "$state" "$type" "$region"

    INSTANCE_IDS+=("$id")
    INSTANCE_NAMES+=("$name")
    INSTANCE_STATES+=("$state")
    INSTANCE_TYPES+=("$type")
    INSTANCE_REGIONS+=("$region")
done <<< "$INSTANCES"

echo "--------------------------------------------------------------------------------------------------------"
echo ""

# Select instance
while true; do
    read -p "Select instance number (1-$counter) or 'q' to quit: " selection

    if [ "$selection" = "q" ] || [ "$selection" = "Q" ]; then
        echo "Cancelled."
        exit 0
    fi

    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "$counter" ]; then
        break
    else
        echo -e "${RED}Invalid selection. Please enter a number between 1 and $counter.${NC}"
    fi
done

# Get selected instance details
idx=$((selection - 1))
INSTANCE_ID="${INSTANCE_IDS[$idx]}"
SELECTED_NAME="${INSTANCE_NAMES[$idx]}"
SELECTED_STATE="${INSTANCE_STATES[$idx]}"
SELECTED_REGION="${INSTANCE_REGIONS[$idx]}"

echo ""
echo -e "${GREEN}✓ Selected: $SELECTED_NAME ($INSTANCE_ID) in $SELECTED_REGION${NC}"
echo ""

# Get project name
echo -e "${YELLOW}Step 2: Project Configuration${NC}"

# Use instance name as default if available
if [ "$SELECTED_NAME" != "(no name)" ]; then
    DEFAULT_PROJECT_NAME=$(echo "$SELECTED_NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
    echo "Suggested project name: $DEFAULT_PROJECT_NAME"
    echo ""
    read -p "Use '$DEFAULT_PROJECT_NAME' as project name? [Y/n]: " use_default
    use_default=${use_default:-Y}

    if [[ "$use_default" =~ ^[Yy]$ ]]; then
        PROJECT_NAME="$DEFAULT_PROJECT_NAME"
    else
        read -p "Enter project name: " PROJECT_NAME
        PROJECT_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
    fi
else
    # No name tag, ask for project name
    current_dir=$(basename "$PWD")
    echo "Current directory: $current_dir"
    read -p "Use '$current_dir' as project name? [Y/n]: " use_current
    use_current=${use_current:-Y}

    if [[ "$use_current" =~ ^[Yy]$ ]]; then
        PROJECT_NAME=$(echo "$current_dir" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
    else
        read -p "Enter project name: " PROJECT_NAME
        PROJECT_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
    fi
fi

echo -e "${GREEN}✓ Project name set to: $PROJECT_NAME${NC}"
echo ""

# Ask for SSH key path
echo -e "${YELLOW}Step 3: SSH Key Configuration${NC}"
read -p "Enter path to SSH private key [~/.ssh/id_rsa]: " SSH_KEY_PATH
SSH_KEY_PATH=${SSH_KEY_PATH:-~/.ssh/id_rsa}
echo -e "${GREEN}✓ SSH key: $SSH_KEY_PATH${NC}"
echo ""

# Define script name and path
SCRIPT_NAME="start-aws-${PROJECT_NAME}"
SCRIPT_PATH="$LOCAL_BIN/$SCRIPT_NAME"

# Check if script already exists
if [ -f "$SCRIPT_PATH" ]; then
    echo -e "${YELLOW}⚠ Warning: Script '$SCRIPT_NAME' already exists!${NC}"
    echo "Location: $SCRIPT_PATH"
    echo ""
    read -p "Replace existing script? [y/N]: " replace_existing
    replace_existing=${replace_existing:-N}

    if [[ ! "$replace_existing" =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Operation cancelled. Existing script preserved.${NC}"
        exit 0
    fi
    echo ""
fi

# Set SSH config marker name
SSH_MARKER="${PROJECT_NAME^^}_AWS"

# Create the start script
echo -e "${YELLOW}Step 4: Generating Script${NC}"
echo "Creating: $SCRIPT_PATH"

cat > "$SCRIPT_PATH" << 'SCRIPT_END'
#!/bin/bash

# AWS EC2 Start Script
# Auto-generated by create-start-script.sh
# =====================================

# CONFIGURATION
# ----------------
INSTANCE_ID="INSTANCE_ID_PLACEHOLDER"
AWS_REGION="AWS_REGION_PLACEHOLDER"
PROJECT_NAME="PROJECT_NAME_PLACEHOLDER"
SSH_KEY_PATH="SSH_KEY_PATH_PLACEHOLDER"
SSH_CONFIG="$HOME/.ssh/config"
SSH_MARKER="SSH_MARKER_PLACEHOLDER"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Starting AWS EC2: $PROJECT_NAME${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Region: $AWS_REGION${NC}"
echo -e "${CYAN}Instance: $INSTANCE_ID${NC}"
echo ""

# 1. START THE INSTANCE
echo -e "${YELLOW}🚀 Starting instance...${NC}"
if command -v notify-send &> /dev/null; then
    notify-send "AWS Dev Box" "Waking up $PROJECT_NAME..." -u low -t 3000
fi

if ! aws ec2 start-instances --region $AWS_REGION --instance-ids $INSTANCE_ID > /dev/null 2>&1; then
    echo -e "${RED}Failed to start instance. Check your AWS credentials and instance ID.${NC}"
    exit 1
fi

# 2. WAIT FOR INSTANCE TO BE RUNNING
echo -e "${YELLOW}⏳ Waiting for instance to be running...${NC}"
aws ec2 wait instance-running --region $AWS_REGION --instance-ids $INSTANCE_ID

# 3. WAIT FOR STATUS CHECKS TO PASS
echo -e "${YELLOW}⏳ Waiting for status checks to pass...${NC}"
aws ec2 wait instance-status-ok --region $AWS_REGION --instance-ids $INSTANCE_ID

# 4. GET NEW PUBLIC IP
NEW_IP=$(aws ec2 describe-instances \
    --region $AWS_REGION \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

echo ""
echo -e "${GREEN}✅ Instance is UP!${NC}"
echo -e "${BLUE}   IP Address: $NEW_IP${NC}"
echo ""

# 5. SETUP AND UPDATE SSH CONFIG
# Ensure SSH config file exists
mkdir -p "$(dirname "$SSH_CONFIG")"
touch "$SSH_CONFIG"

# Check if our SSH config block exists
if ! grep -q "# ${SSH_MARKER}_START" "$SSH_CONFIG" 2>/dev/null; then
    # Create new SSH config block
    echo "" >> "$SSH_CONFIG"
    echo "# ${SSH_MARKER}_START" >> "$SSH_CONFIG"
    echo "Host $PROJECT_NAME" >> "$SSH_CONFIG"
    echo "  HostName $NEW_IP" >> "$SSH_CONFIG"
    echo "  User ubuntu" >> "$SSH_CONFIG"
    echo "  IdentityFile $SSH_KEY_PATH" >> "$SSH_CONFIG"
    echo "  StrictHostKeyChecking no" >> "$SSH_CONFIG"
    echo "  UserKnownHostsFile /dev/null" >> "$SSH_CONFIG"
    echo "# ${SSH_MARKER}_END" >> "$SSH_CONFIG"
    echo -e "${GREEN}✓ SSH config created${NC}"
else
    # Update existing SSH config block
    sed -i "/# ${SSH_MARKER}_START/,/# ${SSH_MARKER}_END/ s/HostName .*/  HostName $NEW_IP/" "$SSH_CONFIG"
    echo -e "${GREEN}✓ SSH config updated${NC}"
fi

# 6. NOTIFY USER
if command -v notify-send &> /dev/null; then
    notify-send "AWS Dev Box Ready" "$PROJECT_NAME is UP at $NEW_IP" -u normal -t 5000
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Ready to connect!                      ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "Connect with: ssh $PROJECT_NAME"
echo "Or use your VS Code Remote-SSH extension"
echo ""
SCRIPT_END

# Replace placeholders
sed -i "s/INSTANCE_ID_PLACEHOLDER/$INSTANCE_ID/" "$SCRIPT_PATH"
sed -i "s/AWS_REGION_PLACEHOLDER/$SELECTED_REGION/" "$SCRIPT_PATH"
sed -i "s/PROJECT_NAME_PLACEHOLDER/$PROJECT_NAME/" "$SCRIPT_PATH"
sed -i "s/SSH_MARKER_PLACEHOLDER/$SSH_MARKER/" "$SCRIPT_PATH"
sed -i "s|SSH_KEY_PATH_PLACEHOLDER|$SSH_KEY_PATH|" "$SCRIPT_PATH"

# Make executable
chmod +x "$SCRIPT_PATH"

echo -e "${GREEN}✓ Script created successfully!${NC}"
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}Summary:${NC}"
echo "  Script:         $SCRIPT_NAME"
echo "  Instance:       $INSTANCE_ID ($SELECTED_REGION)"
echo "  SSH key:        $SSH_KEY_PATH"
echo "  SSH host:       ssh $PROJECT_NAME"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}✨ Ready! Run: $SCRIPT_NAME${NC}"
