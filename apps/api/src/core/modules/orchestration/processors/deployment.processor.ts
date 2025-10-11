import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger, Injectable } from '@nestjs/common';
import type { DeploymentJobData } from '@/core/modules/orchestration/types/deployment-job.types';
import { DeploymentOrchestrator } from '@/core/modules/deployment/services/deployment-orchestrator.service';
import { DeploymentService } from '@/core/modules/deployment/services/deployment.service';
import { ServiceService } from '@/core/modules/service/services/service.service';
import { DatabaseService } from '@/core/modules/database/services/database.service';

/**
 * Bull processor for deployment jobs
 * - Handles 'deploy' jobs by translating job payload into DeploymentOrchestrator config
 * - Updates deployment DB record status via DeploymentService
 */
@Processor('deployment')
@Injectable()
export class DeploymentProcessor {
  private readonly logger = new Logger(DeploymentProcessor.name);

  constructor(
    private readonly orchestrator: DeploymentOrchestrator,
    private readonly deploymentService: DeploymentService,
    private readonly serviceService: ServiceService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Process('deploy')
  async handleDeploy(job: Job<DeploymentJobData>) {
    const data = job.data;
    this.logger.log(`Processing deploy job for deployment ${data.deploymentId}`);

    // Fetch service config
    const service = await this.serviceService.getServiceById(data.serviceId);
    if (!service) {
      this.logger.error(`Service ${data.serviceId} not found for deployment ${data.deploymentId}`);
      await this.deploymentService.updateDeploymentStatus(data.deploymentId, 'failed');
      return { success: false, message: 'Service not found' };
    }

    // Build DeploymentConfig for orchestrator
    const deploymentConfig = {
      projectId: data.projectId,
      serviceId: data.serviceId,
      environment: (service.project && (service.project as any).environment) || 'production',
      provider: {
        type: (data.sourceConfig?.type as any) || 'upload',
        config: {},
        repository: {
          url: data.sourceConfig?.repositoryUrl,
          branch: data.sourceConfig?.branch,
          accessToken: undefined,
        },
        monorepo: undefined,
        cache: { enabled: false, strategy: 'strict' },
      },
      builder: {
        type: (service.builderId as any) || 'dockerfile',
        config: {},
      },
      healthCheck: service.healthCheckConfig || undefined,
      rollback: service.deploymentRetention || undefined,
      resources: (service as any).resources || undefined,
    } as any;

    // Mark deployment as deploying
    try {
      await this.deploymentService.updateDeploymentStatus(data.deploymentId, 'deploying');
    } catch (err) {
      this.logger.warn(`Failed to set deployment ${data.deploymentId} status to deploying: ${err}`);
    }

    // Prepare trigger
    const trigger = {
      trigger: 'job',
      data: data.sourceConfig,
    } as any;

    try {
      const result = await this.orchestrator.deploy(deploymentConfig, trigger);
      if (result.status === 'success') {
        await this.deploymentService.updateDeploymentStatus(data.deploymentId, 'success');
        await this.deploymentService.updateDeploymentMetadata(data.deploymentId, {
          containerName: result.containerName,
          containerImage: result.containerImage,
          url: result.url,
        });
        this.logger.log(`Deployment ${data.deploymentId} completed successfully`);
        return { success: true, message: 'Deployment completed', result };
      } else {
        await this.deploymentService.updateDeploymentStatus(data.deploymentId, 'failed');
        this.logger.error(`Deployment ${data.deploymentId} failed: ${result.error}`);
        return { success: false, message: result.error || 'Deployment failed', result };
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during deployment ${data.deploymentId}: ${errMsg}`);
      try {
        await this.deploymentService.updateDeploymentStatus(data.deploymentId, 'failed');
      } catch {
        /* ignore */
      }
      throw error;
    }
  }
}
