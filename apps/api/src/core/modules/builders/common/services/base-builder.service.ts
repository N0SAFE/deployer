import type { DockerService } from '@/core/modules/docker/services/docker.service';
import type { DeploymentPhase } from '@/core/common/types/deployment-phase';
import type { Logger } from '@nestjs/common';

export interface BuilderConfig {
  deploymentId: string;
  serviceName: string;
  sourcePath: string;
  environmentVariables?: Record<string, string>;
  port?: number;
  healthCheckPath?: string;
  resourceLimits?: {
    memory?: string;
    cpu?: string;
    storage?: string;
  };
  onPhaseUpdate?: (phase: DeploymentPhase, progress: number, metadata?: Record<string, unknown>) => Promise<void>;
  onLog?: (log: {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    phase: string;
    step: string;
    service: string;
    timestamp: Date;
  }) => Promise<void>;
}

export interface BuilderResult {
  deploymentId: string;
  containerIds: string[];
  containers: string[];
  status: 'success' | 'partial' | 'failed';
  healthCheckUrl?: string;
  domain?: string;
  message: string;
  metadata: Record<string, unknown>;
}

/**
 * Base builder service with shared functionality for all builder types
 */
export abstract class BaseBuilderService {
  protected abstract readonly logger: Logger

  constructor(
    protected readonly dockerService: DockerService,
  ) {}

  /**
   * Generate a container name for the deployment
   */
  protected generateContainerName(serviceName: string, deploymentId: string): string {
    return `${serviceName}-${deploymentId.substring(0, 8)}`;
  }

  /**
   * Generate an image tag for the deployment
   */
  protected generateImageTag(serviceName: string, deploymentId: string): string {
    return `${serviceName}:${deploymentId.substring(0, 8)}`;
  }

  /**
   * Verify container health by checking if it's running
   */
  protected async verifyContainerHealth(
    containerId: string,
    _healthCheckUrl: string,
  ): Promise<boolean> {
    try {
      // Check if container is running
      const isHealthy = await this.dockerService.checkContainerHealth(containerId);
      return isHealthy;
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Health check failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Update deployment phase if callback is provided
   */
  protected async updatePhase(
    config: BuilderConfig,
    phase: DeploymentPhase,
    progress: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (config.onPhaseUpdate) {
      await config.onPhaseUpdate(phase, progress, metadata);
    }
  }

  /**
   * Log a message if callback is provided
   */
  protected async log(
    config: BuilderConfig,
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    phase: string,
    step: string,
    service: string,
  ): Promise<void> {
    if (config.onLog) {
      await config.onLog({
        level,
        message,
        phase,
        step,
        service,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Generate health check URL for a container
   */
  protected generateHealthCheckUrl(
    containerName: string,
    port: number | undefined,
    healthCheckPath: string,
  ): string {
    if (port) {
      return `http://localhost:${port}${healthCheckPath}`;
    }
    return `http://${containerName}${healthCheckPath}`;
  }

  /**
   * Create and start a container with the given configuration
   */
  protected async createAndStartContainer(
    imageTag: string,
    containerName: string,
    deploymentId: string,
    environmentVariables: Record<string, string> = {},
    port?: number,
  ): Promise<string> {
    const ports = port ? { [port]: port.toString() } : {};

    const containerId = await this.dockerService.createAndStartContainer({
      image: imageTag,
      name: containerName,
      deploymentId,
      envVars: environmentVariables,
      ports,
    });

    return containerId;
  }

  /**
   * Abstract method that each builder must implement
   */
  abstract deploy(config: BuilderConfig & Record<string, unknown>): Promise<BuilderResult>;
}
