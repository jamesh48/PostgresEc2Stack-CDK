# Quick Command Reference

## Initial Setup (Run these from your local machine)

```bash
# 0. Install Session Manager Plugin
# macOS:
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/mac/sessionmanager-bundle.zip" -o "sessionmanager-bundle.zip"
unzip sessionmanager-bundle.zip
sudo ./sessionmanager-bundle/install -i /usr/local/sessionmanagerplugin -b /usr/local/bin/session-manager-plugin

# Linux:
curl "https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb" -o "session-manager-plugin.deb"
sudo dpkg -i session-manager-plugin.deb

# 1. Install AWS CDK globally (if not already installed)
npm install -g aws-cdk

# 2. Create project directory
mkdir postgres-ec2-cdk
cd postgres-ec2-cdk

# 3. Initialize CDK project
cdk init app --language typescript

# 4. Copy the postgres-ec2-stack-simple.ts to lib/postgres-ec2-cdk-stack.ts
# (Download from the files provided)

# 5. Update bin/postgres-ec2-cdk.ts with the new stack import
# Add: postgresPassword: process.env.POSTGRES_PASSWORD || 'changeme123'

# 6. Configure password
echo 'POSTGRES_PASSWORD=YourSecurePassword123!' > .env
echo '.env' >> .gitignore

# Or generate a strong password:
openssl rand -base64 32

# 7. Install dependencies
npm install

# 8. Bootstrap CDK (first time only per account/region)
cdk bootstrap

# 9. Deploy
source .env && cdk deploy
```

## Post-Deployment Commands

```bash
# Get your instance ID from CDK outputs, then:

# Connect via SSM (optional - to verify installation)
aws ssm start-session --target <INSTANCE_ID>

# Check PostgreSQL status
sudo systemctl status postgresql

# Exit
exit

# Start port forwarding (keep this running in Terminal 1)
aws ssm start-session --target <INSTANCE_ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=5432,localPortNumber=5432"

# In Terminal 2, connect to PostgreSQL
source .env  # Load password
psql postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres
```

## Useful Commands

```bash
# Check what will be deployed
cdk diff

# Deploy changes
source .env && cdk deploy

# Destroy all resources
cdk destroy

# Connect to instance via SSM
aws ssm start-session --target <INSTANCE_ID>

# Port forward PostgreSQL (Terminal 1)
aws ssm start-session --target <INSTANCE_ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters "portNumber=5432,localPortNumber=5432"

# Connect to PostgreSQL (Terminal 2)
source .env
psql postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres

# Manual backup
aws ssm start-session --target <INSTANCE_ID>
sudo /usr/local/bin/backup-postgres.sh
exit

# List backups in S3
aws s3 ls s3://postgres-backups-<ACCOUNT>-<REGION>/

# View backup logs
aws ssm start-session --target <INSTANCE_ID>
tail -f /var/log/postgres-backup.log
exit
```

## Monitoring

```bash
# Check PostgreSQL status
aws ssm start-session --target <INSTANCE_ID>
sudo systemctl status postgresql
exit

# View active connections
aws ssm start-session --target <INSTANCE_ID>
sudo -u postgres psql -c 'SELECT * FROM pg_stat_activity;'
exit

# Check disk space
aws ssm start-session --target <INSTANCE_ID>
df -h
exit

# Check SSM agent status
aws ssm describe-instance-information --filters "Key=InstanceIds,Values=<INSTANCE_ID>"
```