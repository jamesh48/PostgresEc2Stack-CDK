#!/usr/bin/env node
import "source-map-support/register";
import dotenv from "dotenv";
import * as cdk from "aws-cdk-lib";
import { PostgresEc2Stack } from "../lib/postgres-ec2-cdk-stack";
dotenv.config({ path: "../.env" });

const app = new cdk.App();

const postgresPassword = process.env.POSTGRES_PASSWORD;

if (!postgresPassword) {
  throw new Error("POSTGRES_PASSWORD env not defined!");
}

new PostgresEc2Stack(app, "PostgresEc2Stack", {
  postgresPassword,
  // todo replace with env
  vpcId: "vpc-02eb6737e1516a04d",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
