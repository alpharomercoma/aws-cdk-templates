#!/usr/bin/env bash
# AWS CDK Stack Destroyer
# Safely destroys CDK stacks with confirmation.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}AWS CDK Stack Destroyer${NC}\n"

# Check prerequisites
command -v aws &>/dev/null || { echo -e "${RED}Error: AWS CLI not installed${NC}"; exit 1; }
command -v npx &>/dev/null || { echo -e "${RED}Error: Node.js/npx not installed${NC}"; exit 1; }
aws sts get-caller-identity &>/dev/null || { echo -e "${RED}Error: Not authenticated. Run: aws configure${NC}"; exit 1; }

# Discover CDK projects
echo -e "${BLUE}Available CDK projects:${NC}"
PROJECTS=()
for dir in "$SCRIPT_DIR"/*/; do
  if [ -f "$dir/cdk.json" ]; then
    PROJECT_NAME=$(basename "$dir")
    PROJECTS+=("$PROJECT_NAME")
    echo "  - $PROJECT_NAME"
  fi
done

if [ ${#PROJECTS[@]} -eq 0 ]; then
  echo -e "${YELLOW}No CDK projects found${NC}"
  exit 1
fi

echo ""
read -p "Project to destroy: " PROJECT

# Validate selection
FOUND=false
for p in "${PROJECTS[@]}"; do
  [ "$p" = "$PROJECT" ] && FOUND=true
done
$FOUND || { echo -e "${RED}Invalid project: ${PROJECT}${NC}"; exit 1; }

PROJECT_DIR="$SCRIPT_DIR/$PROJECT"

# Get the stack name from the bin/*.ts file
STACK_NAME=$(grep -oP "new \w+\(app, '\K[^']+'" "$PROJECT_DIR"/bin/*.ts 2>/dev/null | tr -d "'" | head -1)
[ -z "$STACK_NAME" ] && STACK_NAME="$PROJECT"

echo -e "\n${YELLOW}WARNING: This will permanently destroy stack '${STACK_NAME}' and all its AWS resources.${NC}"
read -p "Type the stack name to confirm: " CONFIRM
[ "$CONFIRM" != "$STACK_NAME" ] && { echo -e "${RED}Confirmation failed. Aborting.${NC}"; exit 1; }

# Destroy
cd "$PROJECT_DIR"
echo -e "\n${BLUE}Destroying stack ${STACK_NAME}...${NC}"
npx cdk destroy --force

echo -e "\n${GREEN}Stack ${STACK_NAME} destroyed successfully.${NC}"
