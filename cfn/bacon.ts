// Drawing from https://github.com/PracticeVelocity/Airflow-on-Fargate
import ec2 = require('aws-cdk-lib/aws-ec2');
import ecs = require('aws-cdk-lib/aws-ecs');
import efs = require("aws-cdk-lib/aws-efs")
import cdk = require('aws-cdk-lib');
import logs = require("aws-cdk-lib/aws-logs")
import { App, Aws, Fn, CfnOutput, CfnParameter } from 'aws-cdk-lib';
import { Airflow } from "./src/airflow";
import { Registrar } from "./src/registrar"
import { SweepTask } from "./src/sweep-task"
import { config } from "../src/config"


export interface EfsVolumeInfo {
    readonly volumeName: string;
    readonly fileSystem: efs.FileSystem;
    readonly containerPath: string;
}

class Bacon extends cdk.Stack {
    
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        cdk.Tags.of(scope).add("Stack", cdk.Aws.STACK_NAME);

        let vpc = new ec2.Vpc(this, 'Vpc', {
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                {
                    name: "public",
                    cidrMask: 24,
                    subnetType: ec2.SubnetType.PUBLIC,
                    mapPublicIpOnLaunch: true
                },
                {
                    name: "private",
                    cidrMask: 24,
                    subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
                }
            ]
        });
        let defaultVpcSecurityGroup = new ec2.SecurityGroup(
            this, "SecurityGroup", { vpc: vpc }
        );
        
        let efsSecurityGroup = new ec2.SecurityGroup(
            this, "EfsSecurityGroup", { vpc: vpc }
        )
        let fileSystem = new efs.FileSystem(this, "AirflowEfsVolume", {
            vpc: vpc,
            securityGroup: efsSecurityGroup
        })
        let volumeInfo: EfsVolumeInfo = {
            containerPath: config.EFS_MOUNT_POINT,
            volumeName: "SharedVolume",
            fileSystem: fileSystem
        }
        new CfnOutput(this, "EfsFileSystemId", {
            value: fileSystem.fileSystemId,
            exportName: Fn.join("-", [Aws.STACK_NAME, "EfsFileSystemId"])
        })
        
        new Registrar(this, "Registrar", { fileSystem: fileSystem, vpc: vpc })

        let logGroup = new logs.LogGroup(this, "BaconLogs", {
            logGroupName: Fn.join("/", ["", Aws.STACK_NAME, "logs"]),
            retention: logs.RetentionDays.ONE_MONTH
        })

        let cluster = new ecs.Cluster(this, 'ECSCluster', { vpc: vpc });
        new Airflow(this, "AirflowService", {
            cluster: cluster,
            vpc: vpc,
            defaultVpcSecurityGroup: defaultVpcSecurityGroup,
            subnets: vpc.privateSubnets,
            volumeInfo: volumeInfo,
            logGroup: logGroup,
            sweepTask: new SweepTask(this, "SweepTask", { 
                vpc, 
                volumeInfo, 
                logGroup, 
                defaultSecurityGroup: defaultVpcSecurityGroup
            })
        });
    }
}


const app = new App();
new Bacon(app, `bacon-${app.node.tryGetContext("env")}`)
