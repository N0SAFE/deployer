import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { deploymentContract } from '@repo/api-contracts';
import { DeploymentQueueService } from '../../jobs/services/deployment-queue.service';
import { DockerService } from '../../../core/services/docker.service';
import { ServiceRepository } from '../../service/repositories/service.repository';
import { ServiceService } from '../../service/services/service.service';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { deployments, deploymentLogs } from '../../../core/modules/db/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';

@Controller()
export class DeploymentController {
  private readonly logger = new Logger(DeploymentController.name);

  constructor(
    private readonly deploymentQueueService: DeploymentQueueService,
    private readonly dockerService: DockerService,
    private readonly serviceRepository: ServiceRepository,
    private readonly serviceService: ServiceService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Implement(deploymentContract.jobStatus)
  jobStatus() {
    return implement(deploymentContract.jobStatus).handler(async ({ input }) => {
      this.logger.log(`Getting job status for job: ${input.jobId}`);
      try {
        const job = await this.deploymentQueueService.getJobStatus(input.jobId);
        // Map Bull job state to contract status
        const statusMap: Record<string, 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'> = {
          waiting: 'waiting',
          active: 'active',
          completed: 'completed',
          failed: 'failed',
          delayed: 'delayed',
        };
        const mappedStatus = statusMap[job.status] || 'waiting';
        return {
          id: job.id,
          status: mappedStatus,
          progress: typeof job.progress === 'number' ? job.progress : 0,
          data: job.data ?? {},
          result: job.result ?? {},
          failedReason: typeof job.error === 'string' ? job.error : undefined,
          processedOn: job.data?.processedOn ?? undefined,
          finishedOn: job.data?.finishedOn ?? undefined,
          delay: job.data?.delay ?? undefined,
          timestamp: job.data?.timestamp ?? new Date().toISOString(),
        };
      } catch (error) {
        this.logger.error(`Job status error: ${error}`);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.getStatus)
  getStatus() {
    return implement(deploymentContract.getStatus).handler(async ({ input }) => {
      this.logger.log(`Getting status for deployment: ${input.deploymentId}`);

      try {
        // Get deployment from database
        const [deployment] = await this.databaseService.db
          .select()
          .from(deployments)
          .where(eq(deployments.id, input.deploymentId))
          .limit(1);

        if (!deployment) {
          throw new Error(`Deployment ${input.deploymentId} not found`);
        }

        // Get container health status if deployment has containers
        let containerHealthy = false;
        if (deployment.status === 'success' && deployment.containerName) {
          const containers = await this.dockerService.listContainersByDeployment(deployment.id);
          if (containers.length > 0) {
            containerHealthy = await this.dockerService.checkContainerHealth(containers[0].id);
          }
        }

        return {
          deploymentId: input.deploymentId,
          status: deployment.status as 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
          stage: this.mapStatusToStage(deployment.status),
          progress: this.calculateProgress(deployment.status, containerHealthy),
          startedAt: deployment.buildStartedAt || deployment.createdAt,
          completedAt: deployment.deployCompletedAt || undefined,
        };
      } catch (error) {
        this.logger.error(`Error getting deployment status: ${error}`);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.trigger)
  trigger() {
    return implement(deploymentContract.trigger).handler(async ({ input }) => {
      this.logger.log(`Triggering deployment for service: ${input.serviceId}`);

      try {
        // Verify Docker connection first
        const dockerConnected = await this.dockerService.testConnection();
        if (!dockerConnected) {
          throw new Error('Docker service is not available. Cannot trigger deployment.');
        }

        // Get service details
        const service = await this.serviceRepository.findById(input.serviceId);
        if (!service) {
          throw new Error(`Service ${input.serviceId} not found`);
        }

        if (!service.isActive) {
          throw new Error(`Service ${input.serviceId} is not active`);
        }

        // Create deployment record
        const deploymentId = nanoid();
        const [deployment] = await this.databaseService.db
          .insert(deployments)
          .values({
            serviceId: input.serviceId,
            triggeredBy: 'user', // TODO: Get from auth context
            status: 'queued',
            environment: 'production',
            sourceType: this.mapServiceProviderToSourceType(service.provider),
            sourceConfig: service.providerConfig,
            metadata: {
              stage: 'queued',
              progress: 0,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        this.logger.log(`Created deployment record: ${deployment.id}`);

        // Add deployment log
        await this.serviceRepository.createDeploymentLog({
          deploymentId: deployment.id,
          level: 'info',
          message: `Deployment triggered for service ${service.name}`,
          phase: 'initialization',
          step: 'trigger',
          service: service.name,
          stage: 'queued',
          metadata: {
            serviceId: input.serviceId,
            triggeredBy: 'user',
            provider: service.provider,
            builder: service.builder,
          },
        });

        // Queue deployment job
        const jobId = await this.deploymentQueueService.addDeploymentJob({
          deploymentId: deployment.id,
          serviceId: input.serviceId,
          projectId: service.projectId,
          sourceConfig: {
            type: this.mapServiceProviderToSourceType(service.provider),
            ...service.providerConfig,
            envVars: service.environmentVariables || {},
          },
        });

        this.logger.log(`Queued deployment job: ${jobId} for deployment: ${deployment.id}`);

        return {
          deploymentId: deployment.id,
          jobId,
          status: 'queued',
          message: 'Deployment has been queued successfully',
        };
      } catch (error) {
        this.logger.error(`Failed to trigger deployment for service ${input.serviceId}:`, error);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.cancel)
  cancel() {
    return implement(deploymentContract.cancel).handler(async ({ input }) => {
      this.logger.log(`Cancelling deployment: ${input.deploymentId}`);

      try {
        // Get deployment details
        const [deployment] = await this.databaseService.db
          .select()
          .from(deployments)
          .where(eq(deployments.id, input.deploymentId))
          .limit(1);

        if (!deployment) {
          throw new Error(`Deployment ${input.deploymentId} not found`);
        }

        if (deployment.status === 'cancelled') {
          return {
            success: true,
            message: 'Deployment was already cancelled',
            deploymentId: input.deploymentId,
          };
        }

        if (deployment.status === 'success' || deployment.status === 'failed') {
          throw new Error(`Cannot cancel deployment with status: ${deployment.status}`);
        }

        // Stop any running containers for this deployment
        await this.dockerService.stopContainersByDeployment(input.deploymentId);
        this.logger.log(`Stopped containers for deployment: ${input.deploymentId}`);

        // Try to cancel the job if it's still queued/running
        try {
          const jobs = await this.deploymentQueueService.getDeploymentJobs(input.deploymentId);
          for (const job of jobs) {
            if (job.data && ['waiting', 'active', 'delayed'].includes(job.opts?.jobId ? await job.getState() : 'completed')) {
              await this.deploymentQueueService.cancelJob(job.id.toString());
              this.logger.log(`Cancelled job: ${job.id}`);
            }
          }
        } catch (jobError) {
          this.logger.warn(`Failed to cancel job for deployment ${input.deploymentId}: ${jobError}`);
          // Continue with deployment cancellation even if job cancellation fails
        }

        // Update deployment status to cancelled
        await this.databaseService.db
          .update(deployments)
          .set({
            status: 'cancelled',
            metadata: {
              ...deployment.metadata as any,
              cancelReason: 'user_requested',
              cancelledAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(deployments.id, input.deploymentId));

        // Add cancellation log
        await this.serviceRepository.createDeploymentLog({
          deploymentId: input.deploymentId,
          level: 'info',
          message: 'Deployment cancelled by user request',
          phase: 'cancellation',
          step: 'cancel',
          stage: 'cancelled',
          metadata: {
            cancelReason: 'user_requested',
            cancelledAt: new Date().toISOString(),
          },
        });

        return {
          success: true,
          message: 'Deployment cancelled successfully',
          deploymentId: input.deploymentId,
        };
      } catch (error) {
        this.logger.error(`Failed to cancel deployment ${input.deploymentId}:`, error);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.rollback)
  rollback() {
    return implement(deploymentContract.rollback).handler(async ({ input }) => {
      this.logger.log(`Rolling back deployment: ${input.deploymentId} to target: ${input.targetDeploymentId}`);

      try {
        // Verify both deployments exist
        const [currentDeployment] = await this.databaseService.db
          .select()
          .from(deployments)
          .where(eq(deployments.id, input.deploymentId))
          .limit(1);

        const [targetDeployment] = await this.databaseService.db
          .select()
          .from(deployments)
          .where(eq(deployments.id, input.targetDeploymentId))
          .limit(1);

        if (!currentDeployment) {
          throw new Error(`Current deployment ${input.deploymentId} not found`);
        }

        if (!targetDeployment) {
          throw new Error(`Target deployment ${input.targetDeploymentId} not found`);
        }

        if (currentDeployment.serviceId !== targetDeployment.serviceId) {
          throw new Error('Deployments must belong to the same service');
        }

        if (targetDeployment.status !== 'success') {
          throw new Error(`Target deployment status is ${targetDeployment.status}, must be 'success'`);
        }

        // Queue rollback job
        const rollbackJobId = await this.deploymentQueueService.addRollbackJob({
          deploymentId: input.deploymentId,
          targetDeploymentId: input.targetDeploymentId,
        });

        // Add rollback initiation log
        await this.serviceRepository.createDeploymentLog({
          deploymentId: input.deploymentId,
          level: 'info',
          message: `Rollback initiated to deployment ${input.targetDeploymentId}`,
          phase: 'rollback',
          step: 'initiate',
          stage: 'rollback_queued',
          metadata: {
            targetDeploymentId: input.targetDeploymentId,
            targetVersion: targetDeployment.metadata?.version || 'unknown',
            rollbackJobId,
          },
        });

        this.logger.log(`Rollback job queued: ${rollbackJobId}`);

        return {
          rollbackJobId,
          message: 'Rollback has been initiated successfully',
        };
      } catch (error) {
        this.logger.error(`Failed to initiate rollback:`, error);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.getLogs)
  getLogs() {
    return implement(deploymentContract.getLogs).handler(async ({ input }) => {
      this.logger.log(`Getting logs for deployment: ${input.deploymentId}`);

      try {
        // Get deployment to verify it exists
        const [deployment] = await this.databaseService.db
          .select()
          .from(deployments)
          .where(eq(deployments.id, input.deploymentId))
          .limit(1);

        if (!deployment) {
          throw new Error(`Deployment ${input.deploymentId} not found`);
        }

        // Get logs from database
        const logs = await this.serviceRepository.findDeploymentLogs(
          input.deploymentId,
          {}, // No filters for now, could be extended
          input.limit || 100,
          input.offset || 0
        );

        // Count total logs for pagination
        const totalLogsQuery = await this.databaseService.db
          .select()
          .from(deploymentLogs)
          .where(eq(deploymentLogs.deploymentId, input.deploymentId));
        
        const total = totalLogsQuery.length;

        const formattedLogs = logs.map(log => ({
          id: log.id,
          timestamp: log.timestamp,
          level: log.level as 'info' | 'warn' | 'error' | 'debug',
          message: log.message,
          service: log.service || 'deployment-service',
          stage: log.stage || 'unknown',
        }));

        return {
          logs: formattedLogs,
          total,
          hasMore: (input.offset || 0) + (input.limit || 100) < total,
        };
      } catch (error) {
        this.logger.error(`Error getting logs for deployment ${input.deploymentId}:`, error);
        throw error;
      }
    });
  }

  @Implement(deploymentContract.list)
  list() {
    return implement(deploymentContract.list).handler(async ({ input }) => {
      this.logger.log('Listing deployments');

      try {
        // Get deployments from database
        let allDeployments;
        
        if (input.serviceId) {
          allDeployments = await this.databaseService.db
            .select()
            .from(deployments)
            .where(eq(deployments.serviceId, input.serviceId))
            .orderBy(desc(deployments.createdAt));
        } else {
          allDeployments = await this.databaseService.db
            .select()
            .from(deployments)
            .orderBy(desc(deployments.createdAt));
        }

        // Apply status filter
        let filteredDeployments = allDeployments;
        if (input.status) {
          filteredDeployments = filteredDeployments.filter(d => d.status === input.status);
        }

        // Apply pagination
        const limit = input.limit || 20;
        const offset = input.offset || 0;
        const total = filteredDeployments.length;
        const paginatedDeployments = filteredDeployments.slice(offset, offset + limit);

        // Format deployments for response
        const formattedDeployments = paginatedDeployments.map(deployment => ({
          id: deployment.id,
          serviceId: deployment.serviceId,
          status: deployment.status as 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
          environment: deployment.environment as 'production' | 'staging' | 'preview' | 'development',
          triggeredBy: deployment.triggeredBy || 'system',
          createdAt: deployment.createdAt,
          updatedAt: deployment.updatedAt,
          metadata: deployment.metadata as any || {
            version: 'unknown',
            commitSha: 'unknown',
            branch: 'main',
          },
        }));

        return {
          deployments: formattedDeployments,
          total,
          hasMore: offset + limit < total,
        };
      } catch (error) {
        this.logger.error('Error listing deployments:', error);
        throw error;
      }
    });
  }

  /**
   * Helper method to map deployment status to stage
   */
  private mapStatusToStage(status: string): string {
    switch (status) {
      case 'queued': return 'queued';
      case 'building': return 'building';
      case 'deploying': return 'deploying';
      case 'success': return 'completed';
      case 'failed': return 'failed';
      case 'cancelled': return 'cancelled';
      default: return 'unknown';
    }
  }

  /**
   * Helper method to calculate deployment progress
   */
  private calculateProgress(status: string, containerHealthy: boolean): number {
    switch (status) {
      case 'queued': return 0;
      case 'building': return 25;
      case 'deploying': return 75;
      case 'success': return containerHealthy ? 100 : 90;
      case 'failed': return 0;
      case 'cancelled': return 0;
      default: return 0;
    }
  }

  /**
   * Helper method to map service provider to source type for deployments
   */
  private mapServiceProviderToSourceType(provider: string): 'github' | 'gitlab' | 'git' | 'upload' {
    switch (provider) {
      case 'github': return 'github';
      case 'gitlab': return 'gitlab';
      case 'bitbucket':
      case 'gitea': 
        return 'git'; // Treat these as generic git
      case 'manual':
      case 's3_bucket':
      case 'docker_registry':
        return 'upload';
      default: return 'git';
    }
  }
}