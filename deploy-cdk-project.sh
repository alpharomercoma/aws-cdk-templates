#!/bin/bash

# AWS CDK Project Deployer
# Discovers CDK templates and deploys them interactively

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   AWS CDK Project Deployer               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not installed${NC}"
    exit 1
fi

if ! command -v cdk &> /dev/null; then
    echo -e "${RED}Error: AWS CDK CLI not installed${NC}"
    echo "Install: npm install -g aws-cdk"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not installed${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    echo "Run: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")

echo -e "${GREEN}✓ AWS Account: $ACCOUNT_ID${NC}"
echo -e "${GREEN}✓ Region: $REGION${NC}"
echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Function to check if directory is a CDK project
is_cdk_project() {
    local dir=$1
    [ -f "$dir/cdk.json" ] && [ -f "$dir/package.json" ]
}

# Function to get project description
get_description() {
    local dir=$1
    if [ -f "$dir/README.md" ]; then
        head -5 "$dir/README.md" | grep -v "^#" | head -1 | sed 's/^[[:space:]]*//' || echo "No description"
    else
        echo "No description"
    fi
}

# Discover CDK projects
echo -e "${YELLOW}Step 1: Discovering CDK Templates${NC}"
echo "Scanning: $SCRIPT_DIR"
echo ""

declare -a PROJECT_PATHS
declare -a PROJECT_NAMES
declare -a PROJECT_DESCRIPTIONS

counter=0
for dir in "$SCRIPT_DIR"/*/; do
    if is_cdk_project "$dir"; then
        counter=$((counter + 1))
        project_name=$(basename "$dir")
        description=$(get_description "$dir")

        PROJECT_PATHS+=("$dir")
        PROJECT_NAMES+=("$project_name")
        PROJECT_DESCRIPTIONS+=("$description")
    fi
done

if [ $counter -eq 0 ]; then
    echo -e "${RED}No CDK projects found${NC}"
    exit 1
fi

# Display projects
echo "Available CDK Templates:"
echo "--------------------------------------------------------------------------------------------------------"
printf "%-4s %-25s %-60s\n" "No." "Template" "Description"
echo "--------------------------------------------------------------------------------------------------------"

for i in "${!PROJECT_NAMES[@]}"; do
    num=$((i + 1))
    name="${PROJECT_NAMES[$i]}"
    desc="${PROJECT_DESCRIPTIONS[$i]}"

    # Truncate long descriptions
    if [ ${#desc} -gt 58 ]; then
        desc="${desc:0:55}..."
    fi

    printf "%-4s %-25s %-60s\n" "$num." "$name" "$desc"
done

echo "--------------------------------------------------------------------------------------------------------"
echo ""

# Select project
while true; do
    read -p "Select template number (1-$counter) or 'q' to quit: " selection

    if [ "$selection" = "q" ] || [ "$selection" = "Q" ]; then
        echo "Cancelled."
        exit 0
    fi

    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "$counter" ]; then
        break
    else
        echo -e "${RED}Invalid selection${NC}"
    fi
done

# Get selected project
idx=$((selection - 1))
SELECTED_PATH="${PROJECT_PATHS[$idx]}"
SELECTED_NAME="${PROJECT_NAMES[$idx]}"

echo ""
echo -e "${GREEN}✓ Selected: $SELECTED_NAME${NC}"
echo "  Path: $SELECTED_PATH"
echo ""

cd "$SELECTED_PATH"

# Check if dependencies are installed
echo -e "${YELLOW}Step 2: Installing Dependencies${NC}"
if [ ! -d "node_modules" ]; then
    echo "Installing npm packages..."
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi
echo ""

# Bootstrap check
echo -e "${YELLOW}Step 3: CDK Bootstrap Check${NC}"
echo "Checking if CDK is bootstrapped in $REGION..."

if aws cloudformation describe-stacks --stack-name CDKToolkit --region "$REGION" &> /dev/null; then
    echo -e "${GREEN}✓ CDK already bootstrapped${NC}"
else
    echo -e "${YELLOW}CDK not bootstrapped in this region${NC}"
    read -p "Bootstrap now? [Y/n]: " bootstrap
    bootstrap=${bootstrap:-Y}

    if [[ "$bootstrap" =~ ^[Yy]$ ]]; then
        cdk bootstrap
        echo -e "${GREEN}✓ Bootstrap complete${NC}"
    else
        echo -e "${RED}Cannot deploy without bootstrapping${NC}"
        exit 1
    fi
fi
echo ""

# Show diff
echo -e "${YELLOW}Step 4: Reviewing Changes${NC}"
echo "Running: cdk diff"
echo ""
cdk diff || true
echo ""

# Confirm deployment
read -p "Deploy this stack? [Y/n]: " confirm_deploy
confirm_deploy=${confirm_deploy:-Y}

if [[ ! "$confirm_deploy" =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi

# Deploy
echo ""
echo -e "${YELLOW}Step 5: Deploying Stack${NC}"
echo -e "${BLUE}Running: cdk deploy${NC}"
echo ""

# Capture outputs
OUTPUT_FILE=$(mktemp)
if cdk deploy --require-approval never --outputs-file "$OUTPUT_FILE"; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Deployment Successful                  ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""

    # Check if outputs exist and if it's an EC2 template
    if [ -s "$OUTPUT_FILE" ]; then
        echo -e "${CYAN}Stack Outputs:${NC}"
        cat "$OUTPUT_FILE"
        echo ""

        # Check for EC2 instance outputs
        INSTANCE_ID=$(jq -r '.. | select(.InstanceId?) | .InstanceId' "$OUTPUT_FILE" 2>/dev/null || echo "")
        SSH_KEY_PATH=$(jq -r '.. | select(.SSHKeyPath?) | .SSHKeyPath' "$OUTPUT_FILE" 2>/dev/null || echo "")

        if [ -n "$INSTANCE_ID" ]; then
            echo -e "${YELLOW}╔═══════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║   EC2 Instance Detected                  ║${NC}"
            echo -e "${YELLOW}╚═══════════════════════════════════════════╝${NC}"
            echo ""
            echo "Instance ID: $INSTANCE_ID"
            [ -n "$SSH_KEY_PATH" ] && echo "SSH Key: $SSH_KEY_PATH"
            echo ""

            read -p "Create start script for this instance? [Y/n]: " create_starter
            create_starter=${create_starter:-Y}

            if [[ "$create_starter" =~ ^[Yy]$ ]]; then
                echo ""
                echo -e "${BLUE}Launching start script generator...${NC}"
                echo ""
                cd "$SCRIPT_DIR"

                # If we have the SSH key path, we could pass it as an argument
                # For now, just run the interactive script
                ./create-start-script.sh
            fi
        fi
    fi

    rm -f "$OUTPUT_FILE"
else
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   Deployment Failed                      ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    rm -f "$OUTPUT_FILE"
    exit 1
fi

# Desktop notification
if command -v notify-send &> /dev/null; then
    notify-send "AWS CDK" "Deployment of $SELECTED_NAME complete" -u normal -t 5000
fi

echo -e "${GREEN}✨ All done!${NC}"
