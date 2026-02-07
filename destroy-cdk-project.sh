#!/bin/bash

# AWS CDK Project Destroyer
# Interactive script to safely destroy CDK stacks with confirmation prompts

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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${RED}${BOLD}╔═══════════════════════════════════════════╗${NC}"
echo -e "${RED}${BOLD}║   AWS CDK Stack Destroyer                ║${NC}"
echo -e "${RED}${BOLD}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  WARNING: This will permanently destroy AWS resources${NC}"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed.${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo -e "${RED}Error: AWS CDK CLI is not installed.${NC}"
    echo "Install it with: npm install -g aws-cdk"
    exit 1
fi

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured.${NC}"
    echo "Run: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "us-east-1")
echo -e "${GREEN}✓ Connected to AWS Account: $ACCOUNT_ID${NC}"
echo -e "${GREEN}✓ Region: $REGION${NC}"
echo ""

# Function to check if directory is a CDK project
is_cdk_project() {
    local dir=$1
    [ -f "$dir/cdk.json" ] && [ -f "$dir/package.json" ]
}

# Function to get stack names from a CDK project
get_stack_names() {
    local project_dir=$1
    cd "$project_dir" || return 1

    # Try to list stacks (this might fail if dependencies aren't installed)
    if [ -d "node_modules" ]; then
        cdk list 2>/dev/null || echo "(needs npm install)"
    else
        echo "(needs npm install)"
    fi
}

# Function to get project description from package.json
get_project_description() {
    local project_dir=$1
    if [ -f "$project_dir/package.json" ]; then
        grep '"description"' "$project_dir/package.json" | sed 's/.*"description": "\(.*\)".*/\1/' || echo "No description"
    else
        echo "No description"
    fi
}

# Discover CDK projects
echo -e "${YELLOW}Step 1: Discovering CDK Projects${NC}"
echo "Scanning directory: $SCRIPT_DIR"
echo ""

declare -a PROJECT_PATHS
declare -a PROJECT_NAMES
declare -a PROJECT_STACKS
declare -a PROJECT_DESCRIPTIONS

counter=0

# Scan for CDK projects
for dir in "$SCRIPT_DIR"/*/; do
    if is_cdk_project "$dir"; then
        counter=$((counter + 1))
        project_name=$(basename "$dir")

        # Get stacks
        stacks=$(get_stack_names "$dir")

        # Get description
        description=$(get_project_description "$dir")

        PROJECT_PATHS+=("$dir")
        PROJECT_NAMES+=("$project_name")
        PROJECT_STACKS+=("$stacks")
        PROJECT_DESCRIPTIONS+=("$description")
    fi
done

if [ $counter -eq 0 ]; then
    echo -e "${RED}No CDK projects found in $SCRIPT_DIR${NC}"
    exit 1
fi

# Display projects
echo -e "${CYAN}${BOLD}Available CDK Projects:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
printf "${BOLD}%-4s %-25s %-40s${NC}\n" "No." "Project Name" "Stacks"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

for i in "${!PROJECT_NAMES[@]}"; do
    num=$((i + 1))
    name="${PROJECT_NAMES[$i]}"
    stacks="${PROJECT_STACKS[$i]}"

    # Truncate long stack names
    if [ ${#stacks} -gt 38 ]; then
        stacks="${stacks:0:35}..."
    fi

    printf "%-4s %-25s %-40s\n" "$num." "$name" "$stacks"
done

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Select project
while true; do
    read -p "Select project number (1-$counter) or 'q' to quit: " selection

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

# Get selected project details
idx=$((selection - 1))
SELECTED_PATH="${PROJECT_PATHS[$idx]}"
SELECTED_NAME="${PROJECT_NAMES[$idx]}"
SELECTED_STACKS="${PROJECT_STACKS[$idx]}"
SELECTED_DESCRIPTION="${PROJECT_DESCRIPTIONS[$idx]}"

echo ""
echo -e "${YELLOW}Selected Project:${NC}"
echo "  Name: $SELECTED_NAME"
echo "  Path: $SELECTED_PATH"
echo "  Description: $SELECTED_DESCRIPTION"
echo ""

# Navigate to project
cd "$SELECTED_PATH"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Dependencies not installed.${NC}"
    read -p "Install dependencies now? [Y/n]: " install_deps
    install_deps=${install_deps:-Y}

    if [[ "$install_deps" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${BLUE}Installing dependencies...${NC}"
        npm install
        echo -e "${GREEN}✓ Dependencies installed${NC}"
        echo ""
    else
        echo -e "${RED}Cannot proceed without dependencies.${NC}"
        exit 1
    fi
fi

# Get actual stack list
echo -e "${YELLOW}Step 2: Analyzing Stacks${NC}"
echo "Fetching stack information..."
echo ""

STACK_LIST=$(cdk list 2>/dev/null || echo "")

if [ -z "$STACK_LIST" ]; then
    echo -e "${RED}No stacks found or error listing stacks.${NC}"
    exit 1
fi

echo -e "${CYAN}${BOLD}Stacks to be destroyed:${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

stack_count=0
while IFS= read -r stack; do
    if [ -n "$stack" ]; then
        stack_count=$((stack_count + 1))
        echo -e "${RED}  • $stack${NC}"
    fi
done <<< "$STACK_LIST"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ $stack_count -eq 0 ]; then
    echo -e "${GREEN}No stacks to destroy.${NC}"
    exit 0
fi

# Show what will be destroyed
echo -e "${YELLOW}Checking deployed resources...${NC}"
echo ""

# Try to show resources for each stack
for stack in $STACK_LIST; do
    echo -e "${BLUE}Stack: $stack${NC}"

    # Get stack resources from CloudFormation
    resources=$(aws cloudformation describe-stack-resources \
        --stack-name "$stack" \
        --query 'StackResources[*].[ResourceType,LogicalResourceId]' \
        --output text 2>/dev/null || echo "")

    if [ -n "$resources" ]; then
        echo "$resources" | head -20 | while IFS=$'\t' read -r type name; do
            echo "  - $type: $name"
        done

        resource_count=$(echo "$resources" | wc -l)
        if [ "$resource_count" -gt 20 ]; then
            echo "  ... and $((resource_count - 20)) more resources"
        fi
    else
        echo "  (Stack not deployed or unable to fetch resources)"
    fi
    echo ""
done

# First confirmation
echo -e "${RED}${BOLD}⚠️  DANGER ZONE ⚠️${NC}"
echo ""
echo "This will permanently delete:"
echo "  • $stack_count stack(s) from project '$SELECTED_NAME'"
echo "  • All AWS resources managed by these stacks"
echo "  • Data may be lost permanently"
echo ""
echo -e "${YELLOW}Account: $ACCOUNT_ID${NC}"
echo -e "${YELLOW}Region: $REGION${NC}"
echo ""

read -p "Type the project name '$SELECTED_NAME' to continue (or anything else to cancel): " confirm_name

if [ "$confirm_name" != "$SELECTED_NAME" ]; then
    echo -e "${GREEN}Cancelled. No resources were destroyed.${NC}"
    exit 0
fi

echo ""

# Second confirmation with default as No
read -p "Are you ABSOLUTELY SURE you want to destroy these stacks? [y/N]: " final_confirm
final_confirm=${final_confirm:-N}

if [[ ! "$final_confirm" =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Cancelled. No resources were destroyed.${NC}"
    exit 0
fi

echo ""
echo -e "${RED}${BOLD}Starting destruction process...${NC}"
echo ""

# Destroy all stacks
echo -e "${YELLOW}Step 3: Destroying Stacks${NC}"
echo ""

# CDK destroy command with --force flag to skip confirmation
echo -e "${RED}Executing: cdk destroy --all --force${NC}"
echo ""

if cdk destroy --all --force; then
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Destruction Complete                   ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}✓ All stacks from '$SELECTED_NAME' have been destroyed${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   Destruction Failed                     ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${RED}Some stacks failed to destroy.${NC}"
    echo "Check the output above for details."
    echo ""
    echo "Common issues:"
    echo "  • Resources have dependencies that must be removed first"
    echo "  • S3 buckets that need to be emptied first"
    echo "  • Resources protected from deletion"
    echo ""
    exit 1
fi

# Send notification if available
if command -v notify-send &> /dev/null; then
    notify-send "AWS CDK" "Project '$SELECTED_NAME' has been destroyed" -u normal -t 5000
fi
