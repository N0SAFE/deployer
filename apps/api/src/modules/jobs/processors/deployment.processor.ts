import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { deployments, deploymentLogs, deploymentStatusEnum, projects, services } from '../../../core/modules/db/drizzle/schema/deployment';
import { TraefikService } from '../../traefik/services/traefik.service';
import { DockerService } from '../../../core/services/docker.service';
import { GitService } from '../../../core/services/git.service';
import { DeploymentJobData, DeploymentJobResult } from '../types/deployment-job.types';

@Processor('deployment')
export class DeploymentProcessor {
  private readonly logger = new Logger(DeploymentProcessor.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly dockerService: DockerService,
    private readonly gitService: GitService,
    private readonly traefikService: TraefikService,
  ) {}

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

      // Step 1: Clone/prepare source code
      await this.logDeployment(deploymentId, 'info', 'Preparing source code');
      const sourcePath = await this.prepareSourceCode(sourceConfig, deploymentId);

      // Step 2: Build container image
      await this.logDeployment(deploymentId, 'info', 'Building container image');
      const imageTag = await this.buildContainerImage(sourcePath, deploymentId);

      // Step 3: Deploy container
      await this.logDeployment(deploymentId, 'info', 'Deploying container');
      const containerInfo = await this.deployContainer(imageTag, deploymentId);

      // Step 4: Register domain with Traefik
      await this.logDeployment(deploymentId, 'info', 'Registering domain with Traefik');
      const domainUrl = await this.registerDomain(deploymentId, containerInfo.containerId);

      // Step 5: Health check
      await this.logDeployment(deploymentId, 'info', 'Performing health checks');
      await this.performHealthCheck(containerInfo.containerId);

      // Success - update status
      await this.updateDeploymentStatus(deploymentId, 'success');
      await this.logDeployment(deploymentId, 'info', 'Deployment completed successfully', {
        containerId: containerInfo.containerId,
        imageTag,
        sourcePath,
        domainUrl
      });

      return {
        success: true,
        deploymentId,
        containerId: containerInfo.containerId,
        imageTag,
        domainUrl,
        message: 'Deployment completed successfully'
      };

    } catch (error) {
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
  async handleRollback(job: Job<{ deploymentId: string; targetDeploymentId: string }>): Promise<DeploymentJobResult> {
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

    } catch (error) {
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

  private async prepareSourceCode(sourceConfig: any, deploymentId: string): Promise<string> {
    if (sourceConfig.type === 'github' || sourceConfig.type === 'gitlab' || sourceConfig.type === 'git') {
      return await this.gitService.cloneRepository({
        url: sourceConfig.repositoryUrl,
        branch: sourceConfig.branch || 'main',
        commit: sourceConfig.commitSha,
        deploymentId
      });
    } else if (sourceConfig.type === 'upload') {
      return await this.gitService.extractUploadedFile({
        filePath: sourceConfig.filePath,
        deploymentId
      });
    } else {
      throw new Error(`Unsupported source type: ${sourceConfig.type}`);
    }
  }

  private async buildContainerImage(sourcePath: string, deploymentId: string): Promise<string> {
    const imageTag = `deployment-${deploymentId}:latest`;
    await this.dockerService.buildImage(sourcePath, imageTag);
    return imageTag;
  }

  private async deployContainer(imageTag: string, deploymentId: string): Promise<{ containerId: string }> {
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

  private async logDeployment(
    deploymentId: string, 
    level: 'info' | 'warn' | 'error', 
    message: string, 
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.databaseService.db.insert(deploymentLogs).values({
      deploymentId,
      level,
      message,
      metadata: metadata || {},
      timestamp: new Date()
    });
  }

  private async registerDomain(deploymentId: string, containerId: string): Promise<string> {
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
    const subdomain = this.traefikService.generateSubdomain(
      project.name,
      service.name,
      deployment.environment as 'preview' | 'production' | 'staging',
      deployment.metadata?.branch,
      deployment.metadata?.pr,
      deployment.metadata?.customName
    );

    // Register domain with Traefik
    // TODO: Get the correct Traefik instance ID from configuration
    const traefikInstanceId = 'default'; // This should come from environment or config
    const registrationResult = await this.traefikService.registerDeployment(
      traefikInstanceId,
      deployment.id,
      subdomain,
      containerId,
      service.port || 3000
    );

    // Update deployment with domain URL
    await this.databaseService.db.update(deployments)
      .set({ 
        domainUrl: registrationResult.url,
        updatedAt: new Date()
      })
      .where(eq(deployments.id, deployment.id));

    return registrationResult.url;
  }

  private getCurrentStep(error: Error): string {
    const stack = error.stack || '';
    
    if (stack.includes('prepareSourceCode')) return 'source_preparation';
    if (stack.includes('buildContainerImage')) return 'image_build';
    if (stack.includes('deployContainer')) return 'container_deployment';
    if (stack.includes('performHealthCheck')) return 'health_check';
    
    return 'unknown';
  }
}