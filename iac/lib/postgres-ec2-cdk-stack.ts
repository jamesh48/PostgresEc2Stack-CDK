import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface PostgresEc2StackProps extends cdk.StackProps {
  postgresPassword?: string;
  vpcId: string;
}

export class PostgresEc2Stack extends cdk.Stack {
  public readonly instance: ec2.IInstance;
  public readonly postgresSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: PostgresEc2StackProps) {
    super(scope, id, props);

    const dbPassword = props.postgresPassword;

    // Import existing VPC instead of creating new one
    const vpc = ec2.Vpc.fromLookup(this, "ImportedVPC", {
      vpcId: props.vpcId,
    });

    // S3 bucket for backups
    const backupBucket = new s3.Bucket(this, "PostgresBackupBucket", {
      bucketName: `postgres-backups-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Security group for PostgreSQL
    const postgresSecurityGroup = new ec2.SecurityGroup(this, "PostgresSecurityGroup", {
      vpc,
      description: "Security group for PostgreSQL EC2 instance",
      allowAllOutbound: true,
    });

    this.postgresSecurityGroup = postgresSecurityGroup;

    // IAM role for EC2 instance
    const role = new iam.Role(this, "PostgresEc2Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });

    backupBucket.grantReadWrite(role);

    // Update user data to allow network connections
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
      "# Configure PostgreSQL to listen on all interfaces (for VPC access)",
      "echo \"listen_addresses = '*'\" >> /etc/postgresql/*/main/postgresql.conf",
      "",
      "# Allow connections from VPC CIDR",
      'echo "host    all             all             10.0.0.0/16            md5" >> /etc/postgresql/*/main/pg_hba.conf',
      "",
      "# Restart PostgreSQL to apply changes",
      "systemctl restart postgresql",
      "",
      "# Ensure PostgreSQL is enabled and started",
      "systemctl enable postgresql",
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
      "sudo -u postgres pg_dumpall | gzip > $BACKUP_FILE",
      "aws s3 cp $BACKUP_FILE s3://$S3_BUCKET/",
      "rm $BACKUP_FILE",
      'echo "Backup completed: $TIMESTAMP"',
      "EOF",
      "",
      "chmod +x /usr/local/bin/backup-postgres.sh",
      "",
      'echo "0 2 * * * root /usr/local/bin/backup-postgres.sh >> /var/log/postgres-backup.log 2>&1" > /etc/cron.d/postgres-backup',
      "",
      "/usr/local/bin/backup-postgres.sh",
      "",
      'echo "PostgreSQL setup complete!"',
    );

    // Create EC2 instance
    const instance = new ec2.Instance(this, "PostgresInstance", {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Or PRIVATE if you have NAT
      },
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
    });

    this.instance = instance;

    // Outputs (same as before)
    new cdk.CfnOutput(this, "InstanceId", {
      value: instance.instanceId,
      exportName: "PostgresDatabaseInstanceId",
      description: "EC2 Instance Id",
    });

    new cdk.CfnOutput(this, "InstancePrivateIp", {
      value: instance.instancePrivateIp,
      exportName: "PostgresInstancePrivateIp",
    });

    new cdk.CfnOutput(this, "PostgresSecurityGroupId", {
      value: postgresSecurityGroup.securityGroupId,
      exportName: "PostgresInstanceSecurityGroupId",
    });

    new cdk.CfnOutput(this, "InstanceRoleArn", {
      value: role.roleArn,
      exportName: "PostgresDatabaseInstanceRoleArn",
    });

    new cdk.CfnOutput(this, "BackupBucket", {
      value: backupBucket.bucketName,
      description: "S3 Backup Bucket Name",
    });
  }
}
