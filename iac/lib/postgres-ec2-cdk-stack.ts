import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface PostgresEc2StackProps extends cdk.StackProps {
  postgresPassword?: string;
}

export class PostgresEc2Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PostgresEc2StackProps) {
    super(scope, id, props);

    // Use provided password or default
    const dbPassword = props?.postgresPassword;

    // Create a simple VPC with public subnets only (cost-effective for MVP)
    const vpc = new ec2.Vpc(this, "PostgresVPC", {
      maxAzs: 2, // Use 2 availability zones
      natGateways: 0, // No NAT gateway = save costs
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // S3 bucket for backups
    const backupBucket = new s3.Bucket(this, "PostgresBackupBucket", {
      bucketName: `postgres-backups-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30), // Keep backups for 30 days
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete backups on stack destroy
    });

    // Security group for PostgreSQL
    const postgresSecurityGroup = new ec2.SecurityGroup(this, "PostgresSecurityGroup", {
      vpc,
      description: "Security group for PostgreSQL EC2 instance",
      allowAllOutbound: true,
    });

    // No inbound rules needed - we'll use SSM for access
    // SSM connects outbound only, no need to expose SSH or PostgreSQL ports

    // IAM role for EC2 instance
    const role = new iam.Role(this, "PostgresEc2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"), // For Systems Manager
      ],
    });

    // Grant S3 access for backups
    backupBucket.grantReadWrite(role);

    // User data script to install and configure PostgreSQL
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "#!/bin/bash",
      "set -e",
      "",
      "# Update system",
      "apt-get update",
      "apt-get upgrade -y",
      "",
      "# Install PostgreSQL",
      "apt-get install -y postgresql postgresql-contrib awscli",
      "",
      "# Configure PostgreSQL password",
      `sudo -u postgres psql -c "ALTER USER postgres PASSWORD '${dbPassword}';"`,
      "",
      "# PostgreSQL is configured to listen on localhost only (default)",
      "# We will use SSM port forwarding to connect securely",
      "",
      "# Ensure PostgreSQL is enabled and started",
      "systemctl enable postgresql",
      "systemctl start postgresql",
      "",
      "# Wait for PostgreSQL to be ready",
      "sleep 5",
      "",
      "# Create backup script",
      "cat > /usr/local/bin/backup-postgres.sh << 'EOF'",
      "#!/bin/bash",
      "TIMESTAMP=$(date +%Y%m%d_%H%M%S)",
      'BACKUP_FILE="/tmp/postgres_backup_$TIMESTAMP.sql.gz"',
      `S3_BUCKET="${backupBucket.bucketName}"`,
      "",
      "# Create backup",
      "sudo -u postgres pg_dumpall | gzip > $BACKUP_FILE",
      "",
      "# Upload to S3",
      "aws s3 cp $BACKUP_FILE s3://$S3_BUCKET/",
      "",
      "# Clean up local backup",
      "rm $BACKUP_FILE",
      "",
      'echo "Backup completed: $TIMESTAMP"',
      "EOF",
      "",
      "chmod +x /usr/local/bin/backup-postgres.sh",
      "",
      "# Set up daily backup cron job (runs at 2 AM)",
      'echo "0 2 * * * root /usr/local/bin/backup-postgres.sh >> /var/log/postgres-backup.log 2>&1" > /etc/cron.d/postgres-backup',
      "",
      "# Run initial backup",
      "/usr/local/bin/backup-postgres.sh",
      "",
      "# Ensure PostgreSQL is still running after initial backup",
      "systemctl start postgresql",
      "",
      'echo "PostgreSQL setup complete!"',
    );

    // Create EC2 instance
    const instance = new ec2.Instance(this, "PostgresInstance", {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.fromSsmParameter(
        "/aws/service/canonical/ubuntu/server/22.04/stable/current/arm64/hvm/ebs-gp2/ami-id",
        { os: ec2.OperatingSystemType.LINUX },
      ),
      securityGroup: postgresSecurityGroup,
      role: role,
      userData: userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      // No SSH key needed - using SSM for access
    });

    // Outputs
    new cdk.CfnOutput(this, "InstanceId", {
      value: instance.instanceId,
      exportName: "PostgresDatabaseInstanceId",
      description: "EC2 Instance Id",
    });

    new cdk.CfnOutput(this, "InstancePublicIp", {
      value: instance.instancePublicIp,
      description: "EC2 Instance Public IP",
    });

    new cdk.CfnOutput(this, "BackupBucket", {
      value: backupBucket.bucketName,
      description: "S3 Backup Bucket Name",
    });

    new cdk.CfnOutput(this, "SSMConnectCommand", {
      value: `aws ssm start-session --target ${instance.instanceId}`,
      description: "Command to connect via SSM Session Manager",
    });

    new cdk.CfnOutput(this, "SSMPortForwardCommand", {
      value: `aws ssm start-session --target ${instance.instanceId} --document-name AWS-StartPortForwardingSession --parameters "portNumber=5432,localPortNumber=5432"`,
      description: "Command to forward PostgreSQL port via SSM",
    });

    new cdk.CfnOutput(this, "PostgresConnectionString", {
      value: `postgresql://postgres:<YOUR_PASSWORD>@localhost:5432/postgres`,
      description: "PostgreSQL Connection String (use after SSM port forwarding)",
    });

    new cdk.CfnOutput(this, "InstanceRoleArn", {
      value: role.roleArn,
      description: "IAM Role ARN for the PostgreSQL EC2 instance",
      exportName: "PostgresDatabaseInstanceRoleArn",
    });
  }
}
