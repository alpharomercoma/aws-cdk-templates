# AWS 3-Tier Application

A production-grade 3-tier architecture on AWS demonstrating the integration of PostgreSQL RDS, ElastiCache Redis, EC2, ALB, CloudFront, WAF, and S3 with industry best practices.

## Architecture Overview

```
                                        ┌─────────────────┐
                                        │    Route 53     │
                                        │   (DNS Zone)    │
                                        └────────┬────────┘
                                                 │
                      ┌──────────────────────────┴──────────────────────────┐
                      │                                                     │
             ┌────────▼─────────┐                              ┌────────────▼────────────┐
             │   CloudFront     │                              │      CloudFront         │
             │   (Static CDN)   │                              │       (API CDN)         │
             └────────┬─────────┘                              └────────────┬────────────┘
                      │                                                     │
             ┌────────▼─────────┐                              ┌────────────▼────────────┐
             │       WAF        │                              │          WAF            │
             └────────┬─────────┘                              └────────────┬────────────┘
                      │                                                     │
             ┌────────▼─────────┐                              ┌────────────▼────────────┐
             │        S3        │    ═══ PUBLIC SUBNET ═══     │          ALB            │
             │  (Static Files)  │                              │   (Load Balancer)       │
             └──────────────────┘                              └────────────┬────────────┘
                                                                            │
                                     ═══ PRIVATE SUBNET ═══    ┌────────────▼────────────┐
                                                               │          EC2            │
                                                               │   (FastAPI t4g.small)   │
                                                               └────────────┬────────────┘
                                                                            │
                      ┌─────────────────────────────────────────────────────┼──────────────┐
                      │                                                     │              │
             ┌────────▼─────────┐    ═══ ISOLATED SUBNET ═══   ┌────────────▼────────────┐ │
             │   ElastiCache    │                              │      PostgreSQL         │ │
             │     (Redis)      │                              │         RDS             │ │
             └──────────────────┘                              └─────────────────────────┘ │
                                                                                           │
                                     ═══ MANAGEMENT ═══        ┌───────────────────────────▼┐
                                                               │       Secrets Manager      │
                                                               │    (DB Credentials)        │
                                                               └────────────────────────────┘
```

## Three Tiers

| Tier | Components | Subnet Type | Purpose |
|------|------------|-------------|---------|
| **Presentation** | CloudFront, WAF, S3, ALB | Public | Content delivery, security, load balancing |
| **Application** | EC2 (FastAPI + Gunicorn) | Private | Business logic, API processing |
| **Data** | PostgreSQL RDS, ElastiCache Redis | Isolated | Persistent storage, caching |

## Features

### Security
- **WAF**: AWS Managed Rules (Common, SQLi) + Rate limiting (2000 req/5min)
- **Network Isolation**: 3-tier subnet architecture (public → private → isolated)
- **Security Groups**: Strict ingress rules between tiers
- **Secrets Manager**: Automatic credential management for RDS
- **Encryption**: At rest (RDS, S3, EBS) and in transit (TLS)
- **IAM**: Least privilege roles

### Performance
- **Redis Caching**: Cache-aside pattern with 60s TTL
- **Connection Pooling**: asyncpg pool (2-10 connections)
- **CloudFront**: Edge caching for static content
- **ARM Graviton**: t4g instances for best price/performance

### Observability
- **Health Checks**: `/health` endpoint checks DB + Redis
- **Cache Statistics**: `/cache/stats` endpoint
- **RDS Performance Insights**: Enabled by default
- **CloudWatch Metrics**: WAF, ALB, EC2, RDS

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (DB + Redis status) |
| `/hello` | GET | Hello World with tier info |
| `/time` | GET | Philippine time (cached 1s) |
| `/time-html` | GET | Philippine time as HTML |
| `/visitors` | GET | List visitors (cached 60s) |
| `/visitors` | POST | Create/update visitor |
| `/visitors/{name}` | GET | Get visitor by name |
| `/visitors/{name}` | DELETE | Delete visitor |
| `/stats` | GET | Visitor statistics (cached) |
| `/cache/stats` | GET | Redis cache statistics |
| `/docs` | GET | Swagger UI documentation |

## Prerequisites

- **AWS CLI** configured with credentials
- **Node.js** 20.x or later
- **AWS CDK** CLI (`npm install -g aws-cdk`)
- **AWS Account** with permissions for: VPC, EC2, RDS, ElastiCache, S3, CloudFront, ALB, WAF, IAM, Secrets Manager

## Quick Start

### 1. Install Dependencies

```bash
cd aws-3tier-app
npm install
```

### 2. Bootstrap CDK

```bash
npx cdk bootstrap aws://ACCOUNT-ID/ap-southeast-1
```

### 3. Deploy

```bash
# Review changes
npx cdk diff

# Deploy (takes ~15-20 minutes due to RDS and ElastiCache)
npx cdk deploy
```

### 4. Access Application

After deployment, outputs will show:

```
Outputs:
Aws3TierAppStack.StaticUrl = https://dxxxxx.cloudfront.net
Aws3TierAppStack.ApiUrl = https://dyyyyy.cloudfront.net
Aws3TierAppStack.HealthEndpoint = https://dyyyyy.cloudfront.net/health
Aws3TierAppStack.DatabaseEndpoint = xxx.rds.amazonaws.com
Aws3TierAppStack.RedisEndpoint = xxx.cache.amazonaws.com
```

## Project Structure

```
aws-3tier-app/
├── bin/
│   └── aws-3tier-app.ts          # CDK app entry point
├── lib/
│   └── aws-3tier-app-stack.ts    # Main infrastructure stack
├── app/                          # FastAPI application (reference)
│   ├── main.py                   # Full application code
│   ├── templates/
│   │   └── time.html
│   └── requirements.txt
├── static/                       # Static files for S3
│   ├── index.html
│   └── about.html
├── test/
│   └── aws-3tier-app.test.ts     # CDK unit tests (30+ tests)
├── .github/workflows/
│   ├── deploy.yml                # CI/CD pipeline
│   └── destroy.yml               # Manual destruction
├── package.json
├── tsconfig.json
├── cdk.json
└── README.md
```

## Caching Strategy

This application implements the **cache-aside (lazy loading)** pattern:

```
┌─────────┐     ┌───────────┐     ┌──────────────┐
│  Client │────▶│  FastAPI  │────▶│    Redis     │
└─────────┘     └─────┬─────┘     │   (Cache)    │
                      │           └──────────────┘
                      │ Cache Miss
                      ▼
                ┌──────────────┐
                │  PostgreSQL  │
                │    (RDS)     │
                └──────────────┘
```

**Read Path:**
1. Check Redis cache
2. If hit → return cached data
3. If miss → query PostgreSQL → store in Redis → return

**Write Path:**
1. Write to PostgreSQL
2. Invalidate related cache keys

## Cost Estimation (PoC)

| Resource | Specification | Est. Monthly Cost |
|----------|---------------|-------------------|
| EC2 | t4g.small (ARM) | ~$12 |
| RDS PostgreSQL | db.t4g.micro, 20GB | ~$15 |
| ElastiCache Redis | cache.t4g.micro | ~$12 |
| ALB | Application LB | ~$16 |
| NAT Gateway | Single AZ | ~$32 |
| CloudFront + WAF | Basic usage | ~$10 |
| **Total** | | **~$97/month** |

> **Note:** NAT Gateway is the largest cost. For production, consider NAT instances or AWS PrivateLink.

## Production Considerations

- [ ] **Multi-AZ**: Enable RDS Multi-AZ and ElastiCache replication
- [ ] **Auto Scaling**: Add ASG for EC2 instances
- [ ] **SSL/TLS**: Add ACM certificates for custom domains
- [ ] **Monitoring**: CloudWatch dashboards and alarms
- [ ] **Backup**: Configure RDS automated backups (already enabled, 7 days)
- [ ] **DR**: Cross-region replication for critical data
- [ ] **Deletion Protection**: Enable for RDS in production

## CI/CD with GitHub Actions

### Setup

Add secrets to GitHub repository:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (optional, defaults to ap-southeast-1)

### Workflows

- **deploy.yml**: Runs on push to main, validates and deploys
- **destroy.yml**: Manual workflow, requires typing "DESTROY" to confirm

## Connect to EC2

```bash
# Via SSM Session Manager (no SSH needed)
aws ssm start-session --target INSTANCE_ID --region ap-southeast-1

# Check service status
sudo systemctl status fastapi
sudo journalctl -u fastapi -f

# Test endpoints locally
curl http://localhost:8000/health
```

## Troubleshooting

### Health Check Failing

```bash
# Connect via SSM
aws ssm start-session --target INSTANCE_ID

# Check service
sudo systemctl status fastapi
sudo journalctl -u fastapi -n 100

# Check database connectivity
curl http://localhost:8000/health
```

### Database Connection Issues

```bash
# Verify environment variables
cat /etc/environment

# Check user-data log
cat /var/log/user-data.log

# Test database from EC2
psql -h DB_ENDPOINT -U appuser -d appdb
```

### Redis Connection Issues

```bash
# Test Redis connectivity
redis-cli -h REDIS_ENDPOINT ping
```

## Cleanup

```bash
# Destroy all resources (including RDS data!)
npx cdk destroy

# Or via GitHub Actions
# Go to Actions → "Destroy 3-Tier Infrastructure" → Run workflow → Type "DESTROY"
```

## References

- [AWS CDK Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/)
- [Deploy ElastiCache with CDK](https://aws.amazon.com/blogs/database/deploy-amazon-elasticache-for-redis-using-aws-cdk/)
- [RDS PostgreSQL on CDK](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_rds-readme.html)
- [3-Tier Architecture on AWS](https://docs.aws.amazon.com/whitepapers/latest/serverless-multi-tier-architectures-api-gateway-lambda/three-tier-architecture-overview.html)

## License

MIT License
