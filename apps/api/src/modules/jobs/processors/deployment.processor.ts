import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { deployments, deploymentLogs, deploymentStatusEnum, projects, services } from '../../../core/modules/db/drizzle/schema/deployment';
import { TraefikService } from '../../traefik/services/traefik.service';
import { DockerService } from '../../../core/services/docker.service';
import { GitService } from '../../../core/services/git.service';
import { DeploymentService } from '../../../core/services/deployment.service';
import { FileUploadService } from '../../storage/services/file-upload.service';
import { StaticFileServingService } from '../../storage/services/static-file-serving.service';
import type { DeploymentJobData, DeploymentJobResult } from '../types/deployment-job.types';
@Processor('deployment')
export class DeploymentProcessor {
    private readonly logger = new Logger(DeploymentProcessor.name);
    constructor(
        private readonly databaseService: DatabaseService, 
        private readonly dockerService: DockerService, 
        private readonly gitService: GitService, 
        private readonly traefikService: TraefikService, 
        private readonly fileUploadService: FileUploadService, 
        private readonly staticFileServingService: StaticFileServingService,
        private readonly deploymentService: DeploymentService
    ) { }
    @Process('deploy')
    async handleDeployment(job: Job<DeploymentJobData>): Promise<DeploymentJobResult> {
        const { deploymentId, projectId, serviceId, sourceConfig } = job.data;
        this.logger.log(`Starting deployment job for deployment ${deploymentId}`);
        
        try {
            // Update deployment status to building
            await this.updateDeploymentStatus(deploymentId, 'building');
            await this.logDeployment(deploymentId, 'info', 'Deployment started', {
                projectId,
                serviceId
            });

            // Get service information to determine build type
            const serviceInfo = await this.databaseService.db.select({
                service: services,
                project: projects,
            })
            .from(services)
            .innerJoin(projects, eq(services.projectId, projects.id))
            .where(eq(services.id, serviceId))
            .limit(1);

            if (!serviceInfo.length) {
                throw new Error(`Service ${serviceId} not found`);
            }

            const { service } = serviceInfo[0];
            const buildType = service.builder;

            this.logger.log(`Deploying service with build type: ${buildType}`);

            // Step 1: Prepare source code
            await this.logDeployment(deploymentId, 'info', 'Preparing source code');
            const sourcePath = await this.prepareSourceCode(sourceConfig, deploymentId);

            // Step 2: Deploy using the enhanced DeploymentService based on build type
            let deploymentResult;
            
            if (buildType === 'static') {
                await this.logDeployment(deploymentId, 'info', 'Deploying as static site');
                deploymentResult = await this.deploymentService.deployStaticSite({
                    deploymentId,
                    serviceName: service.name,
                    sourcePath,
                    environmentVariables: service.environmentVariables || {},
                    healthCheckPath: service.healthCheckPath || '/health',
                    resourceLimits: service.resourceLimits || undefined,
                });
            } else if (buildType === 'dockerfile') {
                await this.logDeployment(deploymentId, 'info', 'Deploying using Dockerfile');
                deploymentResult = await this.deploymentService.deployDockerService({
                    deploymentId,
                    serviceName: service.name,
                    sourcePath,
                    dockerfilePath: service.builderConfig?.dockerfilePath || './Dockerfile',
                    buildArgs: service.builderConfig?.buildArgs || {},
                    environmentVariables: service.environmentVariables || {},
                    port: service.port || 3000,
                    healthCheckPath: service.healthCheckPath || '/health',
                    resourceLimits: service.resourceLimits || undefined,
                });
            } else if (buildType === 'nixpack' || buildType === 'buildpack') {
                await this.logDeployment(deploymentId, 'info', `Deploying using ${buildType} (Node.js)`);
                deploymentResult = await this.deploymentService.deployNodejsService({
                    deploymentId,
                    serviceName: service.name,
                    sourcePath,
                    buildCommand: service.builderConfig?.buildCommand,
                    startCommand: service.builderConfig?.startCommand || 'npm start',
                    installCommand: service.builderConfig?.installCommand || 'npm install',
                    environmentVariables: service.environmentVariables || {},
                    port: service.port || 3000,
                    healthCheckPath: service.healthCheckPath || '/health',
                    resourceLimits: service.resourceLimits || undefined,
                });
            } else {
                // Fallback to the old deployment method for unsupported build types
                await this.logDeployment(deploymentId, 'info', `Using legacy deployment for build type: ${buildType}`);
                
                // Step 2: Build container image  
                await this.logDeployment(deploymentId, 'info', 'Building container image');
                const imageTag = await this.buildContainerImage(sourcePath, deploymentId);
                
                // Step 3: Deploy container
                await this.logDeployment(deploymentId, 'info', 'Deploying container');
                const containerInfo = await this.deployContainer(imageTag, deploymentId);
                
                deploymentResult = {
                    success: true,
                    containers: [containerInfo.containerId],
                    imageTag,
                };
            }

            // Step 3: Register domain with Traefik
            await this.logDeployment(deploymentId, 'info', 'Registering domain with Traefik');
            const domainUrl = await this.registerDomain(deploymentId, deploymentResult.containers[0]);

            // Step 4: Health check
            await this.logDeployment(deploymentId, 'info', 'Performing health checks');
            await this.performHealthCheck(deploymentResult.containers[0]);

            // Success - update status
            await this.updateDeploymentStatus(deploymentId, 'success');
            await this.logDeployment(deploymentId, 'info', 'Deployment completed successfully', {
                containerId: deploymentResult.containers[0],
                imageTag: deploymentResult.imageTag,
                sourcePath,
                domainUrl,
                buildType
            });

            return {
                success: true,
                deploymentId,
                containerId: deploymentResult.containers[0],
                imageTag: deploymentResult.imageTag,
                domainUrl,
                message: 'Deployment completed successfully'
            };
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Deployment job failed for deployment ${deploymentId}:`, err);
            
            // Update status to failed
            await this.updateDeploymentStatus(deploymentId, 'failed');
            await this.logDeployment(deploymentId, 'error', `Deployment failed: ${err.message}`, {
                error: err.stack,
                step: this.getCurrentStep(err)
            });
            
            return {
                success: false,
                deploymentId,
                error: err.message,
                message: 'Deployment failed'
            };
        }
    }
    @Process('rollback')
    async handleRollback(job: Job<{
        deploymentId: string;
        targetDeploymentId: string;
    }>): Promise<DeploymentJobResult> {
        const { deploymentId, targetDeploymentId } = job.data;
        this.logger.log(`Starting rollback job from ${deploymentId} to ${targetDeploymentId}`);
        try {
            await this.logDeployment(deploymentId, 'info', 'Rollback started', { targetDeploymentId });
            // Get target deployment info
            const targetDeployment = await this.databaseService.db.select()
                .from(deployments)
                .where(eq(deployments.id, targetDeploymentId))
                .limit(1);
            if (!targetDeployment.length) {
                throw new Error(`Target deployment ${targetDeploymentId} not found`);
            }
            const target = targetDeployment[0];
            // Stop current containers and unregister domain
            await this.logDeployment(deploymentId, 'info', 'Stopping current containers and cleaning up domain');
            await this.dockerService.stopContainersByDeployment(deploymentId);
            // TODO: Implement domain cleanup method
            // await this.traefikService.unregisterDeployment(deploymentId);
            // Start target deployment containers and register domain
            await this.logDeployment(deploymentId, 'info', 'Starting target deployment containers and registering domain');
            await this.dockerService.startContainersByDeployment(targetDeploymentId);
            // Get target deployment container info for domain registration
            const containers = await this.dockerService.listContainersByDeployment?.(targetDeploymentId) || [];
            if (containers.length > 0) {
                await this.registerDomain(targetDeploymentId, containers[0].id);
            }
            // Update deployment statuses
            await this.updateDeploymentStatus(deploymentId, 'cancelled');
            await this.updateDeploymentStatus(targetDeploymentId, 'success');
            await this.logDeployment(deploymentId, 'info', 'Rollback completed successfully', {
                targetDeploymentId,
                targetVersion: target.metadata?.version
            });
            return {
                success: true,
                deploymentId: targetDeploymentId,
                message: 'Rollback completed successfully'
            };
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Rollback job failed:`, err);
            await this.logDeployment(deploymentId, 'error', `Rollback failed: ${err.message}`, {
                error: err.stack,
                targetDeploymentId
            });
            return {
                success: false,
                deploymentId,
                error: err.message,
                message: 'Rollback failed'
            };
        }
    }
    @Process('deploy-upload')
    async handleUploadDeployment(job: Job<{
        uploadId: string;
        serviceId: string;
        deploymentId: string;
        extractPath: string;
        environment?: string;
    }>): Promise<DeploymentJobResult> {
        const { uploadId, serviceId, deploymentId, extractPath, environment = 'production' } = job.data;
        this.logger.log(`Starting upload deployment job for upload ${uploadId}`);
        try {
            // Update deployment status to building
            await this.updateDeploymentStatus(deploymentId, 'building');
            await this.logDeployment(deploymentId, 'info', 'Upload deployment started', {
                uploadId,
                serviceId,
                environment
            });
            // Get upload info and service details
            const uploadInfo = await this.fileUploadService.getUploadedFileInfo(uploadId);
            if (!uploadInfo) {
                throw new Error(`Upload ${uploadId} not found or expired`);
            }
            // Get service details to determine deployment strategy
            const serviceResult = await this.databaseService.db.select()
                .from(services)
                .innerJoin(projects, eq(services.projectId, projects.id))
                .where(eq(services.id, serviceId))
                .limit(1);
            if (!serviceResult.length) {
                throw new Error(`Service ${serviceId} not found`);
            }
            const { projects: project, services: service } = serviceResult[0];
            // Determine deployment strategy based on detected file type
            let deploymentResult;
            if (uploadInfo.metadata.detectedType === 'static') {
                // Static file deployment
                deploymentResult = await this.deployStaticFiles(deploymentId, extractPath, uploadInfo, service, project);
            }
            else if (uploadInfo.metadata.detectedType === 'docker') {
                // Docker-based deployment
                deploymentResult = await this.deployDockerFiles(deploymentId, extractPath, uploadInfo, service, project);
            }
            else if (uploadInfo.metadata.detectedType === 'node') {
                // Node.js deployment
                deploymentResult = await this.deployNodeFiles(deploymentId, extractPath, uploadInfo, service, project);
            }
            else {
                // Default to static file serving
                deploymentResult = await this.deployStaticFiles(deploymentId, extractPath, uploadInfo, service, project);
            }
            // Success - update status
            await this.updateDeploymentStatus(deploymentId, 'success');
            await this.logDeployment(deploymentId, 'info', 'Upload deployment completed successfully', {
                uploadId,
                deploymentType: uploadInfo.metadata.detectedType,
                ...deploymentResult
            });
            // Clean up upload files after successful deployment
            await this.fileUploadService.cleanupUpload(uploadId);
            return {
                success: true,
                deploymentId,
                message: 'Upload deployment completed successfully',
                ...deploymentResult
            };
        }
        catch (error) {
            const err = error as Error;
            this.logger.error(`Upload deployment job failed for upload ${uploadId}:`, err);
            // Update status to failed
            await this.updateDeploymentStatus(deploymentId, 'failed');
            await this.logDeployment(deploymentId, 'error', `Upload deployment failed: ${err.message}`, {
                error: err.stack,
                uploadId,
                extractPath
            });
            return {
                success: false,
                deploymentId,
                error: err.message,
                message: 'Upload deployment failed'
            };
        }
    }
    private async prepareSourceCode(sourceConfig: any, deploymentId: string): Promise<string> {
        if (sourceConfig.type === 'github' || sourceConfig.type === 'gitlab' || sourceConfig.type === 'git') {
            return await this.gitService.cloneRepository({
                url: sourceConfig.repositoryUrl,
                branch: sourceConfig.branch || 'main',
                commit: sourceConfig.commitSha,
                deploymentId
            });
        }
        else if (sourceConfig.type === 'upload') {
            return await this.gitService.extractUploadedFile({
                filePath: sourceConfig.filePath,
                deploymentId
            });
        }
        else {
            throw new Error(`Unsupported source type: ${sourceConfig.type}`);
        }
    }
    private async buildContainerImage(sourcePath: string, deploymentId: string): Promise<string> {
        const imageTag = `deployment-${deploymentId}:latest`;
        await this.dockerService.buildImage(sourcePath, imageTag);
        return imageTag;
    }
    private async deployContainer(imageTag: string, deploymentId: string): Promise<{
        containerId: string;
    }> {
        const containerName = `deployment-${deploymentId}`;
        const containerId = await this.dockerService.createAndStartContainer({
            image: imageTag,
            name: containerName,
            deploymentId
        });
        return { containerId };
    }
    private async performHealthCheck(containerId: string): Promise<void> {
        const maxRetries = 30; // 30 * 2 seconds = 1 minute
        let retries = 0;
        while (retries < maxRetries) {
            const isHealthy = await this.dockerService.checkContainerHealth(containerId);
            if (isHealthy) {
                return;
            }
            retries++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        }
        throw new Error(`Health check failed for container ${containerId} after ${maxRetries} retries`);
    }
    private async updateDeploymentStatus(deploymentId: string, status: typeof deploymentStatusEnum.enumValues[number]): Promise<void> {
        await this.databaseService.db.update(deployments)
            .set({
            status,
            updatedAt: new Date()
        })
            .where(eq(deployments.id, deploymentId));
    }
    private async logDeployment(deploymentId: string, level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, any>): Promise<void> {
        await this.databaseService.db.insert(deploymentLogs).values({
            deploymentId,
            level,
            message,
            metadata: metadata || {},
            timestamp: new Date()
        });
    }
    private async registerDomain(deploymentId: string, _containerId: string): Promise<string> {
        // Get deployment details with project and service info
        const deploymentResult = await this.databaseService.db.select({
            deployment: deployments,
            project: projects,
            service: services
        })
            .from(deployments)
            .innerJoin(services, eq(deployments.serviceId, services.id))
            .innerJoin(projects, eq(services.projectId, projects.id))
            .where(eq(deployments.id, deploymentId))
            .limit(1);
        if (!deploymentResult.length) {
            throw new Error(`Deployment ${deploymentId} not found`);
        }
        const { deployment, project, service } = deploymentResult[0];
        // Generate subdomain based on deployment environment and details
        const subdomain = this.generateSubdomain(project.name, service.name, deployment.environment as 'preview' | 'production' | 'staging', deployment.metadata?.branch, deployment.metadata?.pr, deployment.metadata?.customName);
        // Register domain with project-based Traefik (simplified)
        const domainUrl = `https://${subdomain}.${process.env.TRAEFIK_DOMAIN || 'localhost'}`;
        // TODO: Implement proper domain registration logic with new schema
        // Update deployment with domain URL
        await this.databaseService.db.update(deployments)
            .set({
            domainUrl: domainUrl,
            updatedAt: new Date()
        })
            .where(eq(deployments.id, deployment.id));
        return domainUrl;
    }

    private getCurrentStep(error: Error): string {
        const stack = error.stack || '';
        if (stack.includes('prepareSourceCode'))
            return 'source_preparation';
        if (stack.includes('buildContainerImage'))
            return 'image_build';
        if (stack.includes('deployContainer'))
            return 'container_deployment';
        if (stack.includes('performHealthCheck'))
            return 'health_check';
        return 'unknown';
    }
    private async deployStaticFiles(deploymentId: string, extractPath: string, uploadInfo: any, service: any, project: any): Promise<{
        containerId?: string;
        domainUrl: string;
        deploymentType: 'static';
    }> {
        await this.logDeployment(deploymentId, 'info', 'Deploying static files');
        // Setup static file serving
        await this.staticFileServingService.setupStaticServing(deploymentId, extractPath);
        // Generate domain URL
        const subdomain = this.generateSubdomain(project.name, service.name, 'production');
        const domainUrl = `https://${subdomain}.${project.baseDomain || 'localhost'}`;
        // Configure Traefik for static file serving
        const traefikService = this.traefikService as any; // Type assertion for new methods
        if (traefikService.configureStaticFileServing) {
            await traefikService.configureStaticFileServing({
                serviceId: service.id,
                projectId: project.id,
                domain: domainUrl,
                staticPath: `/app/static-files/${deploymentId}`,
            });
        }
        await this.logDeployment(deploymentId, 'info', 'Static files deployed successfully', {
            domainUrl,
            fileCount: uploadInfo.fileCount
        });
        return {
            domainUrl,
            deploymentType: 'static'
        };
    }
    private async deployDockerFiles(deploymentId: string, extractPath: string, _uploadInfo: any, _service: any, _project: any): Promise<{
        containerId: string;
        domainUrl: string;
        imageTag: string;
        deploymentType: 'docker';
    }> {
        await this.logDeployment(deploymentId, 'info', 'Deploying Docker application');
        // Build container image from Dockerfile
        const imageTag = await this.buildContainerImage(extractPath, deploymentId);
        // Deploy container
        const { containerId } = await this.deployContainer(imageTag, deploymentId);
        // Register domain with Traefik
        const domainUrl = await this.registerDomain(deploymentId, containerId);
        // Perform health check
        await this.performHealthCheck(containerId);
        await this.logDeployment(deploymentId, 'info', 'Docker application deployed successfully', {
            containerId,
            imageTag,
            domainUrl
        });
        return {
            containerId,
            domainUrl,
            imageTag,
            deploymentType: 'docker'
        };
    }
    private async deployNodeFiles(deploymentId: string, extractPath: string, uploadInfo: any, _service: any, _project: any): Promise<{
        containerId: string;
        domainUrl: string;
        imageTag: string;
        deploymentType: 'node';
    }> {
        await this.logDeployment(deploymentId, 'info', 'Deploying Node.js application');
        // Create Dockerfile for Node.js app if it doesn't exist
        await this.generateNodeDockerfile(extractPath, uploadInfo);
        // Build container image
        const imageTag = await this.buildContainerImage(extractPath, deploymentId);
        // Deploy container
        const { containerId } = await this.deployContainer(imageTag, deploymentId);
        // Register domain with Traefik
        const domainUrl = await this.registerDomain(deploymentId, containerId);
        // Perform health check
        await this.performHealthCheck(containerId);
        await this.logDeployment(deploymentId, 'info', 'Node.js application deployed successfully', {
            containerId,
            imageTag,
            domainUrl,
            buildCommand: uploadInfo.metadata.buildCommand,
            startCommand: uploadInfo.metadata.startCommand
        });
        return {
            containerId,
            domainUrl,
            imageTag,
            deploymentType: 'node'
        };
    }
    private async generateNodeDockerfile(extractPath: string, uploadInfo: any): Promise<string> {
        const dockerfilePath = `${extractPath}/Dockerfile`;
        const fs = require('fs-extra');
        if (await fs.pathExists(dockerfilePath)) {
            return dockerfilePath; // Already has Dockerfile
        }
        // Generate Dockerfile for Node.js app
        const nodeVersion = '18'; // Default Node.js version
        const buildCommand = uploadInfo.metadata.buildCommand || 'npm ci';
        const startCommand = uploadInfo.metadata.startCommand || 'npm start';
        const dockerfileContent = `
FROM node:${nodeVersion}-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN ${buildCommand}

# Copy source code
COPY . .

# Build if build script exists
RUN if [ -f package.json ] && npm run build --silent 2>/dev/null; then npm run build; fi

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
        await fs.writeFile(dockerfilePath, dockerfileContent);
        return dockerfilePath;
    }
    private generateSubdomain(projectName: string, serviceName: string, environment: string, branch?: string, pr?: string | number, customName?: string): string {
        const sanitize = (str: string) => str.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        
        const projectPart = sanitize(projectName);
        const servicePart = sanitize(serviceName);
        const envPart = sanitize(environment);
        
        if (environment === 'production') {
            return `${servicePart}-${projectPart}`;
        }
        
        if (customName) {
            return `${sanitize(customName)}-${servicePart}-${projectPart}`;
        }
        
        if (pr) {
            return `pr-${pr}-${servicePart}-${projectPart}`;
        }
        
        if (branch) {
            return `${sanitize(branch)}-${servicePart}-${projectPart}`;
        }
        
        return `${servicePart}-${envPart}-${projectPart}`;
    }
}
