#!/bin/bash
#
# Trainium Spot Instance Quota Checker
#
# This script helps you check if you have sufficient quota to deploy
# Trainium spot instances and provides instructions for requesting increases.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default region
REGION="${AWS_REGION:-us-east-2}"

echo -e "${BLUE}==================================================================${NC}"
echo -e "${BLUE}  Trainium Spot Instance Quota Checker${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo ""
echo -e "Region: ${YELLOW}${REGION}${NC}"
echo ""

# Check AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI is not installed${NC}"
    echo "Please install it first: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}ERROR: AWS credentials not configured${NC}"
    echo "Please configure credentials first:"
    echo "  - Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables"
    echo "  - Or run: aws configure"
    exit 1
fi

echo -e "${GREEN}✓${NC} AWS CLI configured"
echo ""

# List all Trainium-related quotas
echo -e "${BLUE}Checking Trainium quotas...${NC}"
echo ""

QUOTAS=$(aws service-quotas list-service-quotas \
  --service-code ec2 \
  --region "${REGION}" \
  --query "Quotas[?contains(QuotaName, 'trn')]" 2>&1)

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to query service quotas${NC}"
    echo "Make sure you have permission: service-quotas:ListServiceQuotas"
    exit 1
fi

# Display quotas in a table
echo "$QUOTAS" | jq -r '.[] | "\(.QuotaName)|\(.Value)|\(.QuotaCode)"' | \
while IFS='|' read -r name value code; do
    printf "%-50s %10s    %s\n" "$name" "$value" "$code"
done

echo ""

# Check specifically for Running Dedicated trn Hosts (Spot)
SPOT_QUOTA=$(echo "$QUOTAS" | jq -r '.[] | select(.QuotaName | contains("Running Dedicated trn Hosts")) | .Value')
SPOT_QUOTA_CODE=$(echo "$QUOTAS" | jq -r '.[] | select(.QuotaName | contains("Running Dedicated trn Hosts")) | .QuotaCode')

echo -e "${BLUE}------------------------------------------------------------------${NC}"
echo ""

if [ -z "$SPOT_QUOTA" ]; then
    echo -e "${YELLOW}⚠ WARNING: Could not find 'Running Dedicated trn Hosts' quota${NC}"
    echo "This might mean Trainium is not available in this region."
    echo ""
    echo "Available regions for Trainium: us-east-1, us-east-2, us-west-2"
    exit 1
fi

# trn1.2xlarge requires 8 vCPUs
REQUIRED_VCPUS=8
CURRENT_VCPUS=$(printf "%.0f" "$SPOT_QUOTA")

echo -e "Current Spot Quota: ${YELLOW}${CURRENT_VCPUS} vCPUs${NC}"
echo -e "Required for 1x trn1.2xlarge: ${YELLOW}${REQUIRED_VCPUS} vCPUs${NC}"
echo ""

if [ "$CURRENT_VCPUS" -lt "$REQUIRED_VCPUS" ]; then
    echo -e "${RED}✗ INSUFFICIENT QUOTA${NC}"
    echo ""
    echo -e "${YELLOW}You need to request a quota increase before deploying.${NC}"
    echo ""
    echo -e "${BLUE}Option 1: Request via AWS Console (Recommended)${NC}"
    echo "  1. Go to: https://console.aws.amazon.com/servicequotas/"
    echo "  2. Select region: ${REGION}"
    echo "  3. Navigate to: AWS services → Amazon EC2"
    echo "  4. Search for: Running Dedicated trn Hosts"
    echo "  5. Click: Request quota increase"
    echo "  6. Enter desired value (8 for 1 instance, 128 recommended)"
    echo "  7. Submit request"
    echo ""
    echo -e "${BLUE}Option 2: Request via AWS CLI${NC}"
    echo "  Run this command to request 128 vCPUs (16 instances):"
    echo ""
    echo -e "  ${GREEN}aws service-quotas request-service-quota-increase \\${NC}"
    echo -e "    ${GREEN}--service-code ec2 \\${NC}"
    echo -e "    ${GREEN}--quota-code ${SPOT_QUOTA_CODE} \\${NC}"
    echo -e "    ${GREEN}--desired-value 128 \\${NC}"
    echo -e "    ${GREEN}--region ${REGION}${NC}"
    echo ""
    echo "Approval typically takes a few hours to 1 business day."
    echo ""
    exit 1
else
    MAX_INSTANCES=$((CURRENT_VCPUS / REQUIRED_VCPUS))
    echo -e "${GREEN}✓ QUOTA SUFFICIENT${NC}"
    echo ""
    echo -e "You can deploy up to ${GREEN}${MAX_INSTANCES} trn1.2xlarge instance(s)${NC}"
    echo ""
    echo -e "${GREEN}Ready to proceed with deployment!${NC}"
    echo ""
fi

echo -e "${BLUE}==================================================================${NC}"
