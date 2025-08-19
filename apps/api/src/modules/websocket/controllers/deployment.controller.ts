import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { deploymentContract } from '@repo/api-contracts';
import { DeploymentQueueService } from '../../jobs/services/deployment-queue.service';
import { WebSocketEventService } from '../services/websocket-event.service';
import { db } from '../../../core/modules/db/drizzle/index';
import { deployments, services, projects, deploymentLogs } from '../../../core/modules/db/drizzle/schema/deployment';
import { eq, desc, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';

@Controller()
export class DeploymentController {
  private readonly logger = new Logger(DeploymentController.name);

  constructor(
    private readonly queueService: DeploymentQueueService,
    private readonly websocketService: WebSocketEventService,
  ) {}

  @Implement(deploymentContract.getStatus)
  getDeploymentStatus() {
    return implement(deploymentContract.getStatus).handler(async ({ input }) => {
      const { deploymentId } = input;

      this.logger.log(`Getting status for deployment ${deploymentId}`);

      const deployment = await db.select()
        .from(deployments)
        .where(eq(deployments.id, deploymentId))
        .limit(1);

      if (!deployment.length) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      const deploymentData = deployment[0];

      return {
        deploymentId: deploymentData.id,
        status: deploymentData.status,
        stage: deploymentData.metadata?.stage || undefined,
        progress: deploymentData.metadata?.progress || undefined,
        startedAt: deploymentData.createdAt,
        completedAt: deploymentData.updatedAt,
      };
    });
  }

  @Implement(deploymentContract.trigger)
  triggerDeployment() {
    return implement(deploymentContract.trigger).handler(async ({ input }) => {
      const { serviceId, environment, sourceType, sourceConfig } = input;

      this.logger.log(`Triggering deployment for service ${serviceId}`);

      // Get service and project information
      const service = await db.select({
        service: services,
        project: projects,
      })
        .from(services)
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(eq(services.id, serviceId))
        .limit(1);

      if (!service.length) {
        throw new Error(`Service ${serviceId} not found`);
      }

      const { project: projectData } = service[0];

      // Create deployment record
      const deploymentId = randomUUID();
      await db.insert(deployments).values({
        id: deploymentId,
        serviceId,
        triggeredBy: null, // Will be set to authenticated user ID in production
        status: 'pending',
        environment,
        sourceType,
        sourceConfig,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Map sourceType for job queue (filter out unsupported types)
      const jobSourceType = sourceType === 'custom' ? 'upload' : sourceType as 'github' | 'gitlab' | 'git' | 'upload';

      // Queue the deployment job
      const jobId = await this.queueService.addDeploymentJob({
        deploymentId,
        projectId: projectData.id,
        serviceId,
        sourceConfig: {
          type: jobSourceType,
          repositoryUrl: sourceConfig.repositoryUrl,
          branch: sourceConfig.branch,
          commitSha: sourceConfig.commitSha,
          filePath: sourceConfig.fileName,
        },
      });

      // Emit WebSocket event
      this.websocketService.emitDeploymentStarted(
        deploymentId,
        projectData.id,
        serviceId
      );

      return {
        deploymentId,
        jobId,
        status: 'queued',
        message: 'Deployment has been queued and will start shortly',
      };
    });
  }

  @Implement(deploymentContract.cancel)
  cancelDeployment() {
    return implement(deploymentContract.cancel).handler(async ({ input }) => {
      const { deploymentId, reason } = input;

      this.logger.log(`Cancelling deployment ${deploymentId}`);

      // Update deployment status
      await db.update(deployments)
        .set({
          status: 'cancelled',
          metadata: {
            cancelReason: reason,
            cancelledAt: new Date(),
          },
          updatedAt: new Date(),
        })
        .where(eq(deployments.id, deploymentId));

      // Get deployment info for WebSocket event
      const deployment = await db.select({
        deployment: deployments,
        service: services,
        project: projects,
      })
        .from(deployments)
        .innerJoin(services, eq(deployments.serviceId, services.id))
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(eq(deployments.id, deploymentId))
        .limit(1);

      if (deployment.length) {
        const { project, service: serviceData } = deployment[0];
        this.websocketService.emitDeploymentCancelled(
          deploymentId,
          project.id,
          serviceData.id,
          reason
        );
      }

      return {
        success: true,
        message: 'Deployment cancelled successfully',
      };
    });
  }

  @Implement(deploymentContract.rollback)
  rollbackDeployment() {
    return implement(deploymentContract.rollback).handler(async ({ input }) => {
      const { deploymentId, targetDeploymentId } = input;

      this.logger.log(`Rolling back deployment ${deploymentId} to ${targetDeploymentId}`);

      // Validate both deployments exist and are for the same service
      const deploymentsQuery = await db.select()
        .from(deployments)
        .where(
          eq(deployments.id, deploymentId)
        );

      const targetDeploymentQuery = await db.select()
        .from(deployments)
        .where(
          eq(deployments.id, targetDeploymentId)
        );

      if (!deploymentsQuery.length) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      if (!targetDeploymentQuery.length) {
        throw new Error(`Target deployment ${targetDeploymentId} not found`);
      }

      const currentDeployment = deploymentsQuery[0];
      const targetDeployment = targetDeploymentQuery[0];

      if (currentDeployment.serviceId !== targetDeployment.serviceId) {
        throw new Error('Cannot rollback to deployment from different service');
      }

      if (targetDeployment.status !== 'success') {
        throw new Error('Target deployment must have successful status');
      }

      // Queue rollback job
      const rollbackJobId = await this.queueService.addRollbackJob({
        deploymentId,
        targetDeploymentId,
      });

      return {
        rollbackJobId,
        message: 'Rollback has been queued and will start shortly',
      };
    });
  }

  @Implement(deploymentContract.getLogs)
  getDeploymentLogs() {
    return implement(deploymentContract.getLogs).handler(async ({ input }) => {
      const { deploymentId, limit, offset } = input;

      this.logger.log(`Getting logs for deployment ${deploymentId}`);

      // Get logs from deploymentLogs table
      const logs = await db.select()
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId))
        .orderBy(desc(deploymentLogs.timestamp))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db.select({ count: count() })
        .from(deploymentLogs)
        .where(eq(deploymentLogs.deploymentId, deploymentId));

      const total = totalResult[0]?.count || 0;
      const hasMore = offset + limit < total;

      return {
        logs: logs.map(log => ({
          id: log.id,
          timestamp: log.timestamp,
          level: log.level,
          message: log.message,
          service: log.service ?? undefined,
          stage: log.stage ?? undefined,
        })),
        total,
        hasMore,
      };
    });
  }

  @Implement(deploymentContract.list)
  listDeployments() {
    return implement(deploymentContract.list).handler(async ({ input }) => {
      const { serviceId, limit, offset, status } = input;

      this.logger.log(`Listing deployments for service ${serviceId}`);

      // Build query conditions
      const conditions = [eq(deployments.serviceId, serviceId)];
      if (status) {
        conditions.push(eq(deployments.status, status));
      }

      // Get deployments
      const deploymentList = await db.select()
        .from(deployments)
        .where(eq(deployments.serviceId, serviceId))
        .orderBy(desc(deployments.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResult = await db.select({ count: count() })
        .from(deployments)
        .where(eq(deployments.serviceId, serviceId));

      const total = totalResult[0]?.count || 0;
      const hasMore = offset + limit < total;

      return {
        deployments: deploymentList.map(deployment => ({
          id: deployment.id,
          serviceId: deployment.serviceId,
          status: deployment.status,
          environment: deployment.environment,
          triggeredBy: deployment.triggeredBy,
          createdAt: deployment.createdAt,
          updatedAt: deployment.updatedAt,
          metadata: deployment.metadata ?? undefined,
        })),
        total,
        hasMore,
      };
    });
  }
}