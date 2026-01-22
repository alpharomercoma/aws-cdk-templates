# AWS Infrastructure Proof of Concept

A comprehensive, industry-grade proof of concept demonstrating the integration of key AWS services with modern development workflows using AWS CDK (TypeScript) and FastAPI (Python).

## Architecture Overview

```
                             ┌─────────────────┐
                             │    Route 53     │
                             │   (DNS Zone)    │
                             └────────┬────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               │                                             │
      ┌────────▼─────────┐                      ┌────────────▼────────────┐
      │   CloudFront     │                      │      CloudFront         │
      │   (Static CDN)   │                      │       (API CDN)         │
      └────────┬─────────┘                      └────────────┬────────────┘
               │                                             │
      ┌────────▼─────────┐                      ┌────────────▼────────────┐
      │       WAF        │                      │          WAF            │
      │   (Web ACL)      │                      │       (Web ACL)         │
      └────────┬─────────┘                      └────────────┬────────────┘
               │                                             │
      ┌────────▼─────────┐                      ┌────────────▼────────────┐
      │        S3        │                      │          ALB            │
      │  (Static Files)  │                      │   (Load Balancer)       │
      └──────────────────┘                      └────────────┬────────────┘
                                                             │
                                                ┌────────────▼────────────┐
                                                │          EC2            │
                                                │   (FastAPI t4g.nano)    │
                                                └─────────────────────────┘
```

## AWS Services Demonstrated

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **WAF** | Web Application Firewall | AWS Managed Rules (CRS, SQLi, Known Bad Inputs) + Rate Limiting |
| **ALB** | Application Load Balancer | HTTP listener, health checks, target group |
| **EC2** | Compute | t4g.nano (ARM Graviton), Ubuntu 24.04, FastAPI + Gunicorn |
| **Route 53** | DNS | Alias records to CloudFront (optional, requires domain) |
| **CloudFront** | CDN | Two distributions - static (S3 OAC) and API (ALB origin) |
| **S3** | Static Hosting | Private bucket with OAC, versioning, encryption |
| **IAM** | Access Control | Least privilege roles for EC2 (SSM + CloudWatch) |

## API Endpoints

| Endpoint | Method | Description | Response Type |
|----------|--------|-------------|---------------|
| `/health` | GET | Health check for ALB | JSON |
| `/hello` | GET | Hello World message | JSON |
| `/time` | GET | Current Philippine time | JSON |
| `/time-html` | GET | Current Philippine time | HTML |
| `/docs` | GET | Swagger UI documentation | HTML |

## Prerequisites

- **AWS CLI** configured with credentials
- **Node.js** 20.x or later
- **AWS CDK** CLI (`npm install -g aws-cdk`)
- **AWS Account** with permissions to create:
  - VPC, EC2, S3, CloudFront, ALB, WAF, IAM, Route 53

## Quick Start

### 1. Install Dependencies

```bash
cd aws-infra-poc
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
npx cdk bootstrap aws://ACCOUNT-ID/ap-southeast-1
```

### 3. Deploy

```bash
# Review changes first
npx cdk diff

# Deploy all resources
npx cdk deploy
```

### 4. Access Your Application

After deployment, CDK outputs will show:

```
Outputs:
AwsInfraPocStack.StaticCloudFrontUrl = https://dxxxxx.cloudfront.net
AwsInfraPocStack.ApiCloudFrontUrl = https://dyyyyy.cloudfront.net
AwsInfraPocStack.ApiHelloEndpoint = https://dyyyyy.cloudfront.net/hello
...
```

## Project Structure

```
aws-infra-poc/
├── bin/
│   └── aws-infra-poc.ts          # CDK app entry point
├── lib/
│   └── aws-infra-poc-stack.ts    # Main infrastructure stack
├── app/                          # FastAPI application (reference)
│   ├── main.py                   # FastAPI endpoints
│   ├── templates/
│   │   └── time.html             # Jinja2 template
│   └── requirements.txt          # Python dependencies
├── static/                       # Static files for S3
│   ├── index.html                # Landing page
│   └── about.html                # About page
├── test/
│   └── aws-infra-poc.test.ts     # CDK unit tests
├── .github/workflows/
│   ├── deploy.yml                # CI/CD deployment workflow
│   └── destroy.yml               # Manual destruction workflow
├── package.json                  # Node.js dependencies
├── tsconfig.json                 # TypeScript configuration
├── cdk.json                      # CDK configuration
└── README.md                     # This file
```

## Configuration Options

### Custom Domain (Optional)

To use a custom domain with Route 53:

```bash
npx cdk deploy \
  --context domainName=example.com \
  --context hostedZoneId=Z1234567890
```

This will create:
- `www.example.com` → Static CloudFront
- `api.example.com` → API CloudFront

> **Note:** You'll need to create ACM certificates in us-east-1 for CloudFront.

## Security Features

### WAF Protection

The WAF Web ACL includes:

1. **AWS Managed Rules - Common Rule Set (CRS)**
   - Protects against OWASP Top 10 vulnerabilities
   - Cross-site scripting (XSS)
   - Local file inclusion

2. **AWS Managed Rules - Known Bad Inputs**
   - Blocks requests with malicious patterns
   - Java deserialization exploits
   - Host header attacks

3. **AWS Managed Rules - SQL Injection**
   - SQL injection attack protection
   - SQLi patterns in query strings, headers, body

4. **Rate Limiting**
   - 2000 requests per 5 minutes per IP
   - Prevents brute force and DDoS

### Network Security

- **S3**: Private bucket, accessible only via CloudFront OAC
- **EC2**: No public IP needed (SSM Session Manager), only accepts traffic from ALB
- **ALB**: Accepts traffic only from CloudFront IP ranges (recommended to add)

### IAM Least Privilege

EC2 role includes only:
- `AmazonSSMManagedInstanceCore` - Session Manager access
- `CloudWatchAgentServerPolicy` - Logging

## CI/CD with GitHub Actions

### Setup

1. Add secrets to your GitHub repository:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (optional, defaults to ap-southeast-1)

2. Push to `main` branch to trigger deployment

### Workflow Features

- **Validation**: TypeScript compilation, linting, tests
- **CDK Diff**: Posts infrastructure changes as PR comments
- **Deployment**: Automatic on main branch
- **Health Check**: Verifies deployment success

### Manual Destruction

To destroy all resources:

1. Go to Actions → "Destroy Infrastructure"
2. Click "Run workflow"
3. Type `DESTROY` to confirm
4. Click "Run workflow"

## Local Development

### FastAPI Application

```bash
cd app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run locally
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### CDK Development

```bash
# Watch for changes
npm run watch

# Run tests
npm test

# Synthesize CloudFormation
npx cdk synth

# View diff
npx cdk diff
```

## Cost Optimization

This PoC is designed to minimize costs:

| Resource | Cost Optimization |
|----------|-------------------|
| EC2 | t4g.nano (ARM Graviton) - lowest cost instance |
| NAT Gateway | None - EC2 in public subnet |
| CloudFront | PRICE_CLASS_100 (US, Canada, Europe only) |
| AZs | 2 AZs (minimum for ALB) |
| S3 | Standard tier with lifecycle policies |

### Estimated Monthly Cost

- **EC2 t4g.nano**: ~$3-4/month
- **ALB**: ~$16/month + data transfer
- **CloudFront**: Pay per request + data transfer
- **S3**: Minimal (small static files)
- **WAF**: ~$5/month + request charges

**Total**: ~$25-35/month for basic usage

## Monitoring

### CloudWatch Metrics

- **EC2**: CPU, Network, Disk
- **ALB**: RequestCount, TargetResponseTime, HealthyHostCount
- **CloudFront**: Requests, BytesDownloaded, ErrorRate
- **WAF**: BlockedRequests, AllowedRequests

### Logs

- **FastAPI**: Application logs via systemd journal
- **CloudWatch**: Can be configured via CloudWatch Agent

### Access EC2 via SSM

```bash
# No SSH needed - use Session Manager
aws ssm start-session --target INSTANCE_ID --region ap-southeast-1

# Check FastAPI service
sudo systemctl status fastapi
sudo journalctl -u fastapi -f
```

## Cleanup

```bash
# Destroy all resources
npx cdk destroy

# Or via GitHub Actions (see Manual Destruction above)
```

## Troubleshooting

### EC2 Health Check Failing

```bash
# Connect via SSM
aws ssm start-session --target INSTANCE_ID

# Check service status
sudo systemctl status fastapi

# View logs
sudo journalctl -u fastapi -n 100

# Test health endpoint locally
curl http://localhost:8000/health
```

### CloudFront 502 Errors

1. Check ALB target group health
2. Verify EC2 security group allows ALB traffic
3. Confirm FastAPI is running on port 8000

### WAF Blocking Requests

Check CloudWatch metrics for `AwsInfraPocWaf`:
- View sampled requests in WAF console
- Adjust rules if legitimate traffic is blocked

## References

- [AWS CDK Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/)
- [FastAPI Deployment Guide](https://fastapi.tiangolo.com/deployment/)
- [AWS WAF Documentation](https://docs.aws.amazon.com/waf/)
- [CloudFront OAC](https://aws.amazon.com/blogs/devops/a-new-aws-cdk-l2-construct-for-amazon-cloudfront-origin-access-control-oac/)

## License

MIT License - See LICENSE file for details.
