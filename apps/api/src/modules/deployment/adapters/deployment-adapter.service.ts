import { Injectable } from '@nestjs/common';
import type { 
  DeploymentStatusContract,
  DeploymentLogsContract,
} from '../interfaces/deployment.types';
import type { deployments, deploymentLogs } from '@/config/drizzle/schema';

type Deployment = typeof deployments.$inferSelect;
type DeploymentLog = typeof deploymentLogs.$inferSelect;

/**
 * DeploymentAdapter
 * 
 * PURPOSE: Transform deployment entities to contract formats
 * LOCATION: Feature module adapters folder
 * 
 * PATTERN: Service-Adapter Pattern (#9)
 * - Fixed contract return types
 * - Pure transformation functions
 * - No business logic
 * - No service dependencies
 */
@Injectable()
export class DeploymentAdapter {
  /**
   * Transform deployment entity to status contract format
   */
  adaptDeploymentToStatusContract(
    deployment: Deployment,
    healthStatus: 'healthy' | 'unhealthy' | 'starting',
    deployedBy: string,
    sourceType: 'github' | 'gitlab' | 'git' | 'upload' | 'docker-image' | 'custom'
  ): DeploymentStatusContract {
    return {
      deploymentId: deployment.id,
      serviceId: deployment.serviceId,
      status: deployment.status as 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
      stage: this.mapStatusToStage(deployment.status),
      progress: this.calculateProgress(deployment.status, healthStatus === 'healthy'),
      startedAt: deployment.buildStartedAt || deployment.createdAt,
      completedAt: deployment.deployCompletedAt || undefined,
      containerId: deployment.containerName || undefined,
      healthStatus,
      deployedBy,
      environment: deployment.environment || 'production',
      sourceType,
    };
  }

  /**
   * Transform deployment logs to contract format
   */
  adaptDeploymentLogsToContract(
    logs: DeploymentLog[],
    total: number
  ): DeploymentLogsContract {
    return {
      logs: logs.map(log => ({
        id: log.id,
        level: log.level as 'debug' | 'info' | 'warn' | 'error',
        message: log.message,
        timestamp: log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp),
        service: log.service || undefined,
        stage: log.phase || undefined,
      })),
      total,
      hasMore: logs.length < total,
    };
  }

  /**
   * Helper: Map deployment status to stage
   */
  private mapStatusToStage(status: string): 'preparation' | 'building' | 'deploying' | 'completed' | 'failed' {
    const stageMap: Record<string, 'preparation' | 'building' | 'deploying' | 'completed' | 'failed'> = {
      queued: 'preparation',
      building: 'building',
      deploying: 'deploying',
      success: 'completed',
      failed: 'failed',
      cancelled: 'failed',
    };
    return stageMap[status] || 'preparation';
  }

  /**
   * Helper: Calculate deployment progress percentage
   */
  private calculateProgress(status: string, containerHealthy: boolean): number {
    const progressMap: Record<string, number> = {
      queued: 0,
      building: 30,
      deploying: 70,
      success: containerHealthy ? 100 : 95,
      failed: 0,
      cancelled: 0,
    };
    return progressMap[status] || 0;
  }
}
