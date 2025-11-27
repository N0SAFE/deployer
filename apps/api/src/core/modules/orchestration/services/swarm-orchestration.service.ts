import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { stringify } from 'yaml';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import type { SwarmStackConfig, StackStatus } from '@repo/api-contracts/modules/orchestration';
import { SwarmOrchestrationRepository } from '../repositories/swarm-orchestration.repository';
@Injectable()
export class SwarmOrchestrationService {
    private readonly logger = new Logger(SwarmOrchestrationService.name);
    private readonly stacksDir = './docker-stacks';
    constructor(
    private readonly swarmOrchestrationRepository: SwarmOrchestrationRepository,
    @InjectQueue('deployment')
    private readonly deploymentQueue: Queue,
    private readonly dockerService: DockerService) {
        // Ensure stacks directory exists
        mkdirSync(this.stacksDir, { recursive: true });
    }
    @Cron(CronExpression.EVERY_MINUTE)
    async monitorStacks() {
        this.logger.debug('Running stack monitoring...');
        try {
            const activeStacks = await this.swarmOrchestrationRepository.findActiveStacks();
            for (const stack of activeStacks) {
                const status = await this.getStackStatus(stack.id);
                if (status) {
                    // Update stack status in database
                    await this.swarmOrchestrationRepository.updateStackStatus(stack.id, status.status);
                }
            }
        }
        catch (error) {
            this.logger.error('Stack monitoring failed:', error);
        }
    }
    async createStack(stackConfig: SwarmStackConfig): Promise<string> {
        try {
            const stackName = `${stackConfig.projectId}-${stackConfig.environment}`;
            // Create stack record in database
            const insertData = {
                name: stackName,
                projectId: stackConfig.projectId,
                environment: stackConfig.environment,
                composeConfig: stackConfig.composeConfig,
                resourceQuotas: null,
                domainMappings: stackConfig.domain ? { [stackName]: [stackConfig.domain] } : null,
                status: 'creating' as any,
            };
            const stack = await this.swarmOrchestrationRepository.createStack(insertData);
            // Queue deployment job
            await this.deploymentQueue.add('deploy-stack', {
                stackId: stack.id,
                stackName: stackName,
                composeConfig: stackConfig.composeConfig
            });
            this.logger.log(`Stack ${stackName} queued for deployment`);
            return stack.id;
        }
        catch (error) {
            this.logger.error(`Failed to create stack:`, error);
            throw error;
        }
    }
    async deployStack(stackId: string, stackName: string, composeConfig: any): Promise<void> {
        try {
            this.logger.log(`Deploying stack: ${stackName}`);
            // Update status to deploying
            await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'updating');
            // Write compose file
            const composeFilePath = join(this.stacksDir, `${stackName}.yml`);
            writeFileSync(composeFilePath, stringify(composeConfig));
            // Deploy to Docker Swarm using Docker API
            await this.deployStackToSwarm(stackName, composeConfig);
            // Update status to running
            await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'running');
            this.logger.log(`Stack ${stackName} deployed successfully`);
        }
        catch (error) {
            this.logger.error(`Failed to deploy stack ${stackName}:`, error);
            // Update status to error
            await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'failed');
            throw error;
        }
    }
    async removeStack(stackId: string): Promise<void> {
        try {
            // Get stack from database
            const stack = await this.swarmOrchestrationRepository.findById(stackId);
            if (!stack) {
                throw new Error(`Stack with ID ${stackId} not found`);
            }
            const stackName = stack.name;
            this.logger.log(`Removing stack: ${stackName}`);
            // Update status
            await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'removing');
            // Remove from Docker Swarm
            await this.removeStackFromSwarm(stackName);
            // Remove from database
            await this.swarmOrchestrationRepository.deleteStack(stackId);
            this.logger.log(`Stack ${stackName} removed successfully`);
        }
        catch (error) {
            this.logger.error(`Failed to remove stack:`, error);
            throw error;
        }
    }
    async updateStack(stackId: string, request: any): Promise<void> {
        try {
            // Find the stack in database
            const stack = await this.swarmOrchestrationRepository.findById(stackId);
            if (!stack) {
                throw new Error(`Stack with ID ${stackId} not found`);
            }
            const stackName = stack.name;
            // Update the stack configuration
            if (request.composeConfig) {
                this.logger.log(`Updating stack: ${stackName}`);
                // Update status
                await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'updating');
                // Deploy updated stack
                await this.deployStackToSwarm(stackName, request.composeConfig);
                // Update database
                await this.swarmOrchestrationRepository.updateStackConfig(stackId, request.composeConfig);
            }
        }
        catch (error) {
            this.logger.error(`Failed to update stack:`, error);
            // Update status to error
            await this.swarmOrchestrationRepository.updateStackStatus(stackId, 'failed');
            throw error;
        }
    }
    async scaleServices(stackId: string, request: any): Promise<void> {
        try {
            // Find the stack
            const stack = await this.swarmOrchestrationRepository.findById(stackId);
            if (!stack) {
                throw new Error(`Stack with ID ${stackId} not found`);
            }
            const stackName = stack.name;
            // Scale each service
            for (const [serviceName, replicas] of Object.entries(request.services || request)) {
                if (typeof replicas === 'number') {
                    const fullServiceName = `${stackName}_${serviceName}`;
                    this.logger.log(`Scaling ${fullServiceName} to ${replicas} replicas`);
                    try {
                        const service = this.dockerService.getDockerClient().getService(fullServiceName);
                        const serviceInfo = await service.inspect();
                        // Update service spec with new replica count
                        const updateSpec = {
                            ...serviceInfo.Spec,
                            Mode: {
                                Replicated: {
                                    Replicas: replicas
                                }
                            }
                        };
                        await service.update({
                            version: serviceInfo.Version.Index,
                            ...updateSpec
                        });
                    }
                    catch (scaleError) {
                        this.logger.error(`Failed to scale service ${fullServiceName}:`, scaleError);
                        throw scaleError;
                    }
                }
            }
        }
        catch (error) {
            this.logger.error(`Failed to scale services:`, error);
            throw error;
        }
    }
    async getStackStatus(stackId: string): Promise<StackStatus | null> {
        try {
            // Get stack from database
            const stack = await this.swarmOrchestrationRepository.findById(stackId);
            if (!stack) {
                return null;
            }
            const stackName = stack.name;
            // Get services in the stack
            const services = await this.dockerService.getDockerClient().listServices({
                filters: { label: [`com.docker.stack.namespace=${stackName}`] }
            });
            const serviceStatuses = await Promise.all(services.map(async (service) => {
                const tasks = await this.dockerService.getDockerClient().listTasks({
                    filters: { service: [service.ID] }
                });
                const runningTasks = tasks.filter(task => task.Status.State === 'running');
                const desiredReplicas = service.Spec?.Mode?.Replicated?.Replicas || 1;
                return {
                    name: service.Spec?.Name || 'unknown',
                    replicas: {
                        desired: desiredReplicas,
                        current: runningTasks.length,
                        updated: runningTasks.length
                    },
                    status: runningTasks.length === desiredReplicas ? 'running' : 'updating',
                    ports: service.Spec?.EndpointSpec?.Ports?.map(p => p.TargetPort).filter((p): p is number => p !== undefined) || [],
                    endpoints: [] // TODO: Extract actual endpoints
                };
            }));
            // Determine overall stack status - map database status to contract status
            let overallStatus: 'pending' | 'deploying' | 'running' | 'error' | 'stopped' = 'running';
            if (serviceStatuses.some(s => s.status === 'updating')) {
                overallStatus = 'deploying';
            }
            else if (serviceStatuses.length === 0) {
                overallStatus = 'stopped';
            }
            return {
                id: stackId,
                name: stackName,
                projectId: stack.projectId,
                environment: stack.environment,
                status: overallStatus,
                services: serviceStatuses,
                createdAt: stack.createdAt,
                updatedAt: stack.updatedAt,
                resourceUsage: {
                    cpu: { allocated: 0, used: 0, percentage: 0 },
                    memory: { allocated: 0, used: 0, percentage: 0 },
                    storage: { allocated: 0, used: 0, percentage: 0 },
                    replicas: {
                        total: serviceStatuses.reduce((sum, s) => sum + s.replicas.desired, 0),
                        running: serviceStatuses.reduce((sum, s) => sum + s.replicas.current, 0)
                    },
                    services: serviceStatuses.length
                }
            };
        }
        catch (error) {
            this.logger.error(`Failed to get stack status for ${stackId}:`, error);
            return null;
        }
    }
    async listStacks(projectId: string): Promise<StackStatus[]> {
        this.logger.debug(`Listing stacks for project: ${projectId}`);
        try {
            // Get all stacks for the project from database
            const stacks = await this.swarmOrchestrationRepository.findByProjectId(projectId);
            // Get current status for each stack
            const stack = stacks;
            const stackStatuses = [await this.getStackStatus(stack.id)];
            // Filter out null statuses and return
            return stackStatuses.filter((status): status is StackStatus => status !== null);
        }
        catch (error) {
            this.logger.error(`Failed to list stacks for project ${projectId}:`, error);
            throw new Error(error instanceof Error ? error.message : 'Failed to list stacks');
        }
    }
    private async deployStackToSwarm(stackName: string, composeConfig: any): Promise<void> {
        if (!composeConfig.services) {
            throw new Error('No services defined in compose configuration');
        }
        for (const [serviceName, serviceConfig] of Object.entries(composeConfig.services)) {
            const fullServiceName = `${stackName}_${serviceName}`;
            const config = serviceConfig as any;
            try {
                // Check if service already exists
                const existingServices = await this.dockerService.getDockerClient().listServices({
                    filters: { name: [fullServiceName] }
                });
                const serviceSpec = {
                    Name: fullServiceName,
                    TaskTemplate: {
                        ContainerSpec: {
                            Image: config.image,
                            Env: config.environment ?
                                Object.entries(config.environment).map(([key, value]) => `${key}=${value}`) :
                                undefined,
                        },
                        Resources: config.deploy?.resources ? {
                            Limits: {
                                NanoCPUs: config.deploy.resources.limits?.cpus ?
                                    Math.floor(parseFloat(config.deploy.resources.limits.cpus) * 1000000000) : undefined,
                                MemoryBytes: config.deploy.resources.limits?.memory ?
                                    this.parseMemoryToBytes(config.deploy.resources.limits.memory) : undefined
                            },
                        } : undefined,
                        RestartPolicy: {
                            Condition: 'on-failure',
                            MaxAttempts: 3
                        },
                    },
                    Mode: {
                        Replicated: {
                            Replicas: config.deploy?.replicas || 1
                        }
                    },
                    EndpointSpec: config.ports ? {
                        Ports: config.ports.map((port: number) => ({
                            Protocol: 'tcp',
                            TargetPort: port,
                            PublishedPort: port
                        }))
                    } : undefined,
                    Labels: {
                        'com.docker.stack.namespace': stackName,
                    }
                };
                if (existingServices.length > 0) {
                    // Update existing service
                    const service = this.dockerService.getDockerClient().getService(existingServices[0].ID);
                    const serviceInfo = await service.inspect();
                    await service.update({
                        version: serviceInfo.Version.Index,
                        ...serviceSpec
                    });
                    this.logger.debug(`Updated service: ${fullServiceName}`);
                }
                else {
                    // Create new service
                    await this.dockerService.getDockerClient().createService(serviceSpec);
                    this.logger.debug(`Created service: ${fullServiceName}`);
                }
            }
            catch (serviceError) {
                this.logger.error(`Failed to deploy service ${fullServiceName}:`, serviceError);
                throw serviceError;
            }
        }
    }
    private async removeStackFromSwarm(stackName: string): Promise<void> {
        try {
            // Get all services in the stack
            const services = await this.dockerService.getDockerClient().listServices({
                filters: { label: [`com.docker.stack.namespace=${stackName}`] }
            });
            // Remove all services
            await Promise.all(services.map(async (serviceInfo) => {
                const service = this.dockerService.getDockerClient().getService(serviceInfo.ID);
                await service.remove();
                this.logger.debug(`Removed service: ${serviceInfo.Spec?.Name}`);
            }));
        }
        catch (error) {
            this.logger.error(`Failed to remove stack from swarm:`, error);
            throw error;
        }
    }
    private parseMemoryToBytes(memory: string): number {
        const value = parseFloat(memory);
        const unit = memory.replace(/[\d.]/g, '').toLowerCase();
        switch (unit) {
            case 'k':
            case 'kb':
                return value * 1024;
            case 'm':
            case 'mb':
                return value * 1024 * 1024;
            case 'g':
            case 'gb':
                return value * 1024 * 1024 * 1024;
            case 't':
            case 'tb':
                return value * 1024 * 1024 * 1024 * 1024;
            default:
                return value;
        }
    }
    // Legacy methods expected by DeploymentProcessor - keep for compatibility
    async executeSwarmDeploy(stackName: string, composeConfig: any): Promise<void> {
        await this.deployStackToSwarm(stackName, composeConfig);
    }
    async executeSwarmRemove(stackName: string): Promise<void> {
        await this.removeStackFromSwarm(stackName);
    }
}
