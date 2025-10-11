import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { BaseBuilderService, type BuilderConfig, type BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import type { IBuilder, ConfigSchema } from '@/core/interfaces/provider.interface';
import { z } from 'zod';

export interface DockerfileBuilderConfig extends BuilderConfig {
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
}

@Injectable()
export class DockerfileBuilderService extends BaseBuilderService implements IBuilder {
  protected readonly logger = new Logger(DockerfileBuilderService.name);
  
  // IBuilder properties
  readonly id = 'dockerfile';
  readonly name = 'Dockerfile';
  readonly description = 'Build Docker images using a custom Dockerfile';
  readonly icon = '🐳';
  readonly compatibleProviders = ['github', 'gitlab', 'bitbucket', 'gitea', 'static', 'docker-registry', 's3'];

  constructor(dockerService: DockerService) {
    super(dockerService);
  }

  /**
   * Deploy a service using a Dockerfile
   */
  async deploy(config: DockerfileBuilderConfig): Promise<BuilderResult> {
    const {
      deploymentId,
      serviceName,
      sourcePath,
      environmentVariables = {},
      port,
      healthCheckPath = '/health',
      onPhaseUpdate,
      onLog,
    } = config;

    try {
      // Phase: BUILDING - Docker image build
      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.BUILDING, 20, {
          buildType: 'dockerfile',
          sourcePath,
        });
      }

      if (onLog) {
        await onLog({
          level: 'info',
          message: 'Building Docker image from Dockerfile',
          phase: 'build',
          step: 'docker-build',
          service: 'dockerfile-builder',
          timestamp: new Date(),
        });
      }

      // Build Docker image from the provided Dockerfile
      const imageTag = this.generateImageTag(serviceName, deploymentId);
      await this.dockerService.buildImage(sourcePath, imageTag);

      // Phase: COPYING_FILES - Container creation
      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.COPYING_FILES, 50, {
          imageTag,
          containerSetup: 'starting',
        });
      }

      if (onLog) {
        await onLog({
          level: 'info',
          message: `Docker image built: ${imageTag}`,
          phase: 'build',
          step: 'image-ready',
          service: 'dockerfile-builder',
          timestamp: new Date(),
        });
      }

      // Create and start container
      const containerName = this.generateContainerName(serviceName, deploymentId);
      const containerId = await this.createAndStartContainer(
        imageTag,
        containerName,
        deploymentId,
        environmentVariables,
        port,
      );

      // Phase: UPDATING_ROUTES - Container started
      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.UPDATING_ROUTES, 75, {
          containerId,
          containerName,
          routeSetup: 'configuring',
        });
      }

      // Phase: HEALTH_CHECK - Verify container health
      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.HEALTH_CHECK, 90, {
          healthCheckStarted: true,
        });
      }

      // Verify container health
      const healthCheckUrl = this.generateHealthCheckUrl(containerName, port, healthCheckPath);
      const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

      // Phase: ACTIVE or FAILED based on health check
      if (isHealthy) {
        if (onPhaseUpdate) {
          await onPhaseUpdate(DeploymentPhase.ACTIVE, 100, {
            containerName,
            imageTag,
            port,
            healthCheckUrl,
            deploymentCompletedAt: new Date().toISOString(),
          });
        }
      } else {
        if (onPhaseUpdate) {
          await onPhaseUpdate(DeploymentPhase.FAILED, 0, {
            error: 'Health check failed',
            containerName,
            imageTag,
            healthCheckUrl,
          });
        }
      }

      return {
        deploymentId,
        containerIds: [containerId],
        containers: [containerId],
        status: isHealthy ? 'success' : 'partial',
        healthCheckUrl,
        message: isHealthy
          ? 'Dockerfile service deployed successfully'
          : 'Dockerfile service deployed but health check failed',
        metadata: {
          containerName,
          imageTag,
          port,
          buildType: 'dockerfile',
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to deploy using Dockerfile: ${err.message}`, err.stack);
      
      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.FAILED, 0, {
          error: err.message,
          buildType: 'dockerfile',
        });
      }

      throw error;
    }
  }

  /**
   * Get configuration schema for Dockerfile builder (IBuilder interface)
   */
  getConfigSchema(): ConfigSchema {
    return {
      id: 'dockerfile-builder-config',
      version: '1.0.0',
      title: 'Dockerfile Build Configuration',
      description: 'Configure Docker image build using a Dockerfile',
      fields: [
        {
          key: 'dockerfilePath',
          label: 'Dockerfile Path',
          description: 'Path to Dockerfile relative to project root',
          schema: z.string(),
          type: 'text',
          required: false,
          defaultValue: 'Dockerfile',
          placeholder: 'Dockerfile',
          group: 'build',
          ui: { order: 1 },
        },
        {
          key: 'buildContext',
          label: 'Build Context',
          description: 'Docker build context path',
          schema: z.string(),
          type: 'text',
          required: false,
          defaultValue: '.',
          placeholder: '.',
          group: 'build',
          ui: { order: 2 },
        },
        {
          key: 'buildArgs',
          label: 'Build Arguments',
          description: 'Build-time variables (JSON format: {"KEY": "value"})',
          schema: z.string().optional(),
          type: 'json',
          required: false,
          placeholder: '{"NODE_ENV": "production"}',
          group: 'build',
          ui: { order: 3, fullWidth: true },
        },
        {
          key: 'target',
          label: 'Build Target',
          description: 'Target stage for multi-stage builds',
          schema: z.string().optional(),
          type: 'text',
          required: false,
          placeholder: 'production',
          group: 'advanced',
          ui: { order: 4 },
        },
        {
          key: 'cacheFrom',
          label: 'Cache From',
          description: 'Images to consider as cache sources (comma-separated)',
          schema: z.string().optional(),
          type: 'text',
          required: false,
          placeholder: 'myapp:latest,myapp:cache',
          group: 'optimization',
          ui: { order: 5 },
        },
        {
          key: 'platform',
          label: 'Platform',
          description: 'Target platform (e.g., linux/amd64, linux/arm64)',
          schema: z.string().optional(),
          type: 'select',
          required: false,
          options: [
            { label: 'Linux AMD64', value: 'linux/amd64' },
            { label: 'Linux ARM64', value: 'linux/arm64' },
            { label: 'Linux ARM/v7', value: 'linux/arm/v7' },
          ],
          group: 'advanced',
          ui: { order: 6 },
        },
      ],
      validate: async (config: any) => {
        const errors: string[] = [];
        
        if (config.buildArgs) {
          try {
            JSON.parse(config.buildArgs);
          } catch {
            errors.push('Build arguments must be valid JSON');
          }
        }
        
        if (config.dockerfilePath && (config.dockerfilePath.includes('..') || config.dockerfilePath.startsWith('/'))) {
          errors.push('Dockerfile path must be relative and cannot contain ..');
        }
        
        return { valid: errors.length === 0, errors };
      },
      transform: (config: any) => {
        const transformed: any = {
          dockerfilePath: config.dockerfilePath || 'Dockerfile',
          buildContext: config.buildContext || '.',
        };
        
        if (config.buildArgs) {
          transformed.buildArgs = JSON.parse(config.buildArgs);
        }
        
        if (config.target) {
          transformed.target = config.target;
        }
        
        if (config.cacheFrom) {
          transformed.cacheFrom = config.cacheFrom.split(',').map((img: string) => img.trim());
        }
        
        if (config.platform) {
          transformed.platform = config.platform;
        }
        
        return transformed;
      },
    };
  }

  /**
   * Get default configuration (IBuilder interface)
   */
  getDefaultConfig(): Record<string, any> {
    return {
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
      buildArgs: '',
      target: '',
      cacheFrom: '',
      platform: '',
    };
  }

  /**
   * Validate builder configuration (IBuilder interface)
   */
  async validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    if (config.dockerfilePath && (config.dockerfilePath.includes('..') || config.dockerfilePath.startsWith('/'))) {
      errors.push('Dockerfile path must be relative and cannot contain ..');
    }
    
    if (config.buildArgs) {
      if (typeof config.buildArgs === 'string') {
        try {
          JSON.parse(config.buildArgs);
        } catch {
          errors.push('Build arguments must be valid JSON');
        }
      } else if (typeof config.buildArgs !== 'object') {
        errors.push('Build arguments must be a JSON object or string');
      }
    }
    
    return { valid: errors.length === 0, errors };
  }

}
