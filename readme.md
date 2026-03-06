# PostgreSQL on EC2 with AWS CDK

A simple, low-cost PostgreSQL deployment on EC2 using AWS CDK (TypeScript).

## Features

- ✅ PostgreSQL 14+ on Ubuntu 22.04
- ✅ t4g.micro instance (~$6/month)
- ✅ Automated daily backups to S3
- ✅ 30-day backup retention
- ✅ Encrypted EBS volume
- ✅ IAM roles for secure S3 access
- ✅ Infrastructure as Code with CDK

## Prerequisites

- Node.js 18+ installed
- AWS CLI configured with credentials
- AWS CDK CLI installed: `npm install -g aws-cdk`
- An AWS account
- **Session Manager Plugin** for AWS CLI: [Install Instructions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)

## Quick Start

### 1. Initialize the CDK Project

```bash
# Create and navigate to project directory
mkdir postgres-ec2-cdk
cd postgres-ec2-cdk

# Initialize CDK project
cdk init app --language typescript

# Install dependencies
npm install
```

### 2. Add the PostgreSQL Stack

Copy the `postgres-ec2-stack-simple.ts` file to `lib/postgres-ec2-cdk-stack.ts`

Update `bin/postgres-ec2-cdk.ts`:

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PostgresEc2Stack } from '../lib/postgres-ec2-cdk-stack';

const app = new cdk.App();
new PostgresEc2Stack(app, 'PostgresEc2Stack', {
  postgresPassword: process.env.POSTGRES_PASSWORD,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

### 3. Configure Your Password

Create a `.env` file in your project root (add to `.gitignore`!):

```bash
# Create .env file
echo 'POSTGRES_PASSWORD=YourSecurePassword123!' > .env

# Add to .gitignore
echo '.env' >> .gitignore
```

**Or** hardcode it in `bin/postgres-ec2-cdk.ts`:
```typescript
postgresPassword: 'YourSecurePassword123!', // Replace with your password
```

**Generate a strong password:**
```bash
openssl rand -base64 32
```

### 4. Install Session Manager Plugin

**IMPORTANT**: Install the Session Manager plugin for AWS CLI:

**macOS:**
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin
```

**Linux:**
```bash
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
sudo dpkg -i session-manager-plugin.deb
```

**Windows:**
Download from [AWS Documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)

### 5. Bootstrap CDK (first time only)

```bash
cdk bootstrap
```

### 6. Deploy

```bash
# Load environment variables
source .env

# Preview changes
cdk diff

# Deploy the stack
cdk deploy
```

The deployment takes ~5 minutes. You'll see outputs like:
```
PostgresEc2Stack.InstanceId = i-0123456789abcdef0
PostgresEc2Stack.InstancePublicIp = 54.123.45.67
PostgresEc2Stack.BackupBucket = postgres-backups-123456789-us-east-1
PostgresEc2Stack.SSMConnectCommand = aws ssm start-session --target i-0123456789abcdef0
PostgresEc2Stack.SSMPortForwardCommand = aws ssm start-session --target i-0123456789abcdef0 --document-name AWS-StartPortForwardingSession --parameters "portNumber=5432,localPortNumber=5432"
PostgresEc2Stack.PostgresConnectionString = postgresql://postgres:<YOUR_PASSWORD>@localhost:5432/postgres
```

### 7. Connect to Your Instance (Optional)

You can connect via SSM to verify the installation:

```bash
# Connect via SSM (use the command from CDK output)
aws ssm start-session --target <instance-id>

# Check PostgreSQL is running
sudo systemctl status postgresql

# Exit
exit
```

The password was already configured during deployment, so you're ready to connect!

## Connecting to Your Database

### Step 1: Start Port Forwarding

In one terminal window, run:
```bash
# Use the SSMPortForwardCommand from your CDK output
aws ssm start-session --target <instance-id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=5432,localPortNumber=5432"
```

Keep this terminal open while you work.

### Step 2: Connect to PostgreSQL

In another terminal:
```bash
# Load your password from .env if using environment variable
source .env

# Connect via localhost
psql postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres

# Or if you hardcoded the password, use it directly
psql postgresql://postgres:YourPassword@localhost:5432/postgres
```

Or use any PostgreSQL client:
- Host: `localhost` (or `127.0.0.1`)
- Port: `5432`
- Username: `postgres`
- Password: `<the password you configured>`
- Database: `postgres`

**Benefits of SSM:**
- ✅ No IP whitelisting needed
- ✅ Works from anywhere (home, coffee shop, office)
- ✅ No SSH keys to manage
- ✅ No open ports on the internet
- ✅ All connections logged in CloudTrail

## Backups

Backups run automatically daily at 2 AM UTC and are stored in S3 for 30 days.

### Manual Backup

```bash
# Connect via SSM
aws ssm start-session --target <instance-id>

# Run backup manually
sudo /usr/local/bin/backup-postgres.sh

# Exit
exit
```

### Restore from Backup

```bash
# Download backup from S3
aws s3 cp s3://postgres-backups-<account>-<region>/postgres_backup_YYYYMMDD_HHMMSS.sql.gz .

# Restore
gunzip < postgres_backup_YYYYMMDD_HHMMSS.sql.gz | sudo -u postgres psql
```

## Monitoring

```bash
# Connect via SSM
aws ssm start-session --target <instance-id>

# Check PostgreSQL status
sudo systemctl status postgresql

# View backup logs
tail -f /var/log/postgres-backup.log

# Check database connections
sudo -u postgres psql -c "SELECT * FROM pg_stat_activity;"

# Exit
exit
```

## Cost Estimate

- EC2 t4g.micro: ~$6/month
- EBS 20GB gp3: ~$1.60/month
- S3 storage (varies): ~$0.50/month for backups
- **Total: ~$8-10/month**

## Cleanup

To destroy all resources:

```bash
cdk destroy
```

**Note**: The S3 backup bucket is retained by default. Delete it manually if needed:
```bash
aws s3 rb s3://postgres-backups-<account>-<region> --force
```

## Customization

### Change Instance Type

In `postgres-ec2-stack.ts`:
```typescript
instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
```

### Increase Storage

```typescript
volume: ec2.BlockDeviceVolume.ebs(50, { // 50 GB instead of 20
```

### Change Backup Retention

```typescript
lifecycleRules: [
  {
    expiration: cdk.Duration.days(90), // Keep for 90 days
  },
],
```

### Change Backup Schedule

SSH into instance and edit:
```bash
sudo nano /etc/cron.d/postgres-backup
# Change "0 2 * * *" to your preferred schedule
```

## Troubleshooting

### Can't connect to database

1. Ensure Session Manager plugin is installed
2. Check you have AWS credentials configured
3. Verify instance is running: `aws ec2 describe-instances --instance-ids <instance-id>`
4. Test SSM connection: `aws ssm start-session --target <instance-id>`
5. Verify PostgreSQL is running: Connect via SSM and run `sudo systemctl status postgresql`

### Can't start SSM session

```bash
# Check if SSM agent is running on the instance
aws ssm describe-instance-information --filters "Key=InstanceIds,Values=<instance-id>"

# If no results, the instance may still be initializing (wait 2-3 minutes after deployment)
```

### Backups not running

```bash
# Connect via SSM
aws ssm start-session --target <instance-id>

# Check cron job
cat /etc/cron.d/postgres-backup

# Check logs
tail -f /var/log/postgres-backup.log

# Test backup script
sudo /usr/local/bin/backup-postgres.sh

# Exit
exit
```

### Out of disk space

```bash
# Check disk usage
df -h

# Clean old logs
sudo journalctl --vacuum-time=7d
```

## Security Best Practices

- ✅ Uses SSM for access (no exposed ports)
- ✅ Strong password configured via environment variable
- ✅ Password never committed to git (use .env and .gitignore)
- ✅ Keep Ubuntu and PostgreSQL updated
- ✅ Enable VPC flow logs for network monitoring
- ✅ Consider setting up CloudWatch alarms
- ✅ All connections logged in CloudTrail
- ✅ No SSH keys to manage or lose
- ✅ Rotate passwords every 90 days for production

## License

MIT