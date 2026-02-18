#!/usr/bin/env bash
# AWS EC2 Start Script Generator
# Creates a one-command launcher to start and SSH into an EC2 instance.
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

echo -e "${BLUE}AWS EC2 Start Script Generator${NC}\n"

# Check prerequisites
command -v aws &>/dev/null || { echo -e "${RED}Error: AWS CLI not installed${NC}"; exit 1; }
aws sts get-caller-identity &>/dev/null || { echo -e "${RED}Error: Not authenticated. Run: aws configure${NC}"; exit 1; }

# Select region
read -p "AWS Region [ap-southeast-1]: " REGION
REGION="${REGION:-ap-southeast-1}"

# Discover instances
echo -e "\n${BLUE}Searching for EC2 instances in ${REGION}...${NC}"
INSTANCES=$(aws ec2 describe-instances --region "$REGION" \
  --query 'Reservations[].Instances[].{Id:InstanceId,Name:Tags[?Key==`Name`].Value|[0],State:State.Name,Type:InstanceType}' \
  --output table 2>/dev/null)

if [ -z "$INSTANCES" ]; then
  echo -e "${YELLOW}No instances found in ${REGION}${NC}"
  exit 1
fi

echo "$INSTANCES"
echo ""
read -p "Instance ID: " INSTANCE_ID
[ -z "$INSTANCE_ID" ] && { echo -e "${RED}No instance ID provided${NC}"; exit 1; }

# Get instance name for script naming
INSTANCE_NAME=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value|[0]' --output text 2>/dev/null || echo "ec2")
SCRIPT_NAME="start-aws-${INSTANCE_NAME// /-}"
SCRIPT_NAME=$(echo "$SCRIPT_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')

# SSH key setup
read -p "Path to SSH private key [~/.ssh/${INSTANCE_NAME}-keypair.pem]: " SSH_KEY
SSH_KEY="${SSH_KEY:-$HOME/.ssh/${INSTANCE_NAME}-keypair.pem}"
SSH_KEY="${SSH_KEY/#\~/$HOME}"

read -p "SSH username [ubuntu]: " SSH_USER
SSH_USER="${SSH_USER:-ubuntu}"

# Generate the start script
SCRIPT_PATH="$LOCAL_BIN/$SCRIPT_NAME"
cat > "$SCRIPT_PATH" << STARTSCRIPT
#!/usr/bin/env bash
# Start and connect to EC2 instance: ${INSTANCE_NAME}
set -euo pipefail

INSTANCE_ID="${INSTANCE_ID}"
REGION="${REGION}"
SSH_KEY="${SSH_KEY}"
SSH_USER="${SSH_USER}"
SSH_CONFIG="\${HOME}/.ssh/config"
SSH_HOST_ALIAS="aws-${INSTANCE_NAME// /-}"

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "\$1" "\$2" -u low -t 3000
  fi
}

echo "Checking instance state..."
STATE=\$(aws ec2 describe-instances --region "\$REGION" --instance-ids "\$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' --output text)

if [ "\$STATE" = "stopped" ]; then
  echo "Starting instance \$INSTANCE_ID in \$REGION..."
  notify "AWS Dev Box" "Waking up instance..."
  aws ec2 start-instances --instance-ids "\$INSTANCE_ID" --region "\$REGION" --output text >/dev/null
  echo "Waiting for instance to start..."
  aws ec2 wait instance-running --instance-ids "\$INSTANCE_ID" --region "\$REGION"
elif [ "\$STATE" = "running" ]; then
  echo "Instance already running."
else
  echo "Instance is in state: \$STATE"
  exit 1
fi

echo "Waiting for EC2 status checks..."
aws ec2 wait instance-status-ok --instance-ids "\$INSTANCE_ID" --region "\$REGION"

IP=\$(aws ec2 describe-instances --region "\$REGION" --instance-ids "\$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "Instance is up at: \$IP"

mkdir -p "\$(dirname "\$SSH_CONFIG")"
touch "\$SSH_CONFIG"
if grep -q "# AWS_DEV_BOX_START \${SSH_HOST_ALIAS}" "\$SSH_CONFIG"; then
  sed -i "/# AWS_DEV_BOX_START \${SSH_HOST_ALIAS}/,/# AWS_DEV_BOX_END \${SSH_HOST_ALIAS}/ s/HostName .*/HostName \$IP/" "\$SSH_CONFIG"
else
  cat >> "\$SSH_CONFIG" <<EOF
# AWS_DEV_BOX_START \${SSH_HOST_ALIAS}
Host \${SSH_HOST_ALIAS}
  HostName \$IP
  User \$SSH_USER
  IdentityFile \$SSH_KEY
# AWS_DEV_BOX_END \${SSH_HOST_ALIAS}
EOF
fi
echo "SSH config updated for host alias: \$SSH_HOST_ALIAS"
notify "AWS Dev Box Ready" "Instance is UP at \$IP. SSH config updated."

echo "Connecting via SSH..."
ssh -i "\$SSH_KEY" -o StrictHostKeyChecking=accept-new "\$SSH_USER@\$IP"
STARTSCRIPT

chmod +x "$SCRIPT_PATH"

echo -e "\n${GREEN}Start script created: ${SCRIPT_PATH}${NC}"
echo -e "Run it with: ${BLUE}${SCRIPT_NAME}${NC}"
echo -e "\nMake sure ${LOCAL_BIN} is in your PATH:"
echo -e '  export PATH="$HOME/.local/bin:$PATH"'
