import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { BaseBuilderService, type BuilderConfig, type BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface NixpackBuilderConfig extends BuilderConfig {
  installCommand?: string;
  startCommand?: string;
  buildCommand?: string;
  nodeVersion?: string;
}

@Injectable()
export class NixpackBuilderService extends BaseBuilderService {
  protected readonly logger = new Logger(NixpackBuilderService.name);

  constructor(dockerService: DockerService) {
    super(dockerService);
  }

  /**
   * Deploy a Node.js service using auto-generated Dockerfile
   */
  async deploy(config: NixpackBuilderConfig): Promise<BuilderResult> {
    const {
      deploymentId,
      serviceName,
      sourcePath,
      environmentVariables = {},
      port = 3000,
      healthCheckPath = '/health',
      installCommand = 'npm install',
      startCommand = 'npm start',
      buildCommand,
      nodeVersion = '18-alpine',
      onPhaseUpdate,
    } = config;

    try {
      // Phase: BUILDING - Dockerfile generation
      await this.updatePhase(config, DeploymentPhase.BUILDING, 15, {
        buildType: 'nixpack',
        dockerfileGeneration: 'starting',
      });

      await this.log(config, 'info', 'Generating Node.js Dockerfile', 'build', 'dockerfile-generation', 'nixpack-builder');

      // Generate optimized Dockerfile for Node.js
      const dockerfile = this.generateNodejsDockerfile({
        nodeVersion,
        installCommand,
        startCommand,
        buildCommand,
        port,
        healthCheckPath,
      });

      // Write Dockerfile to source path
      const dockerfilePath = path.join(sourcePath, 'Dockerfile');
      await fs.writeFile(dockerfilePath, dockerfile);

      await this.updatePhase(config, DeploymentPhase.BUILDING, 25, {
        buildType: 'nixpack',
        dockerfileGeneration: 'completed',
      });

      await this.log(config, 'info', 'Node.js Dockerfile generated successfully', 'build', 'dockerfile-ready', 'nixpack-builder');

      // Build Docker image
      await this.updatePhase(config, DeploymentPhase.BUILDING, 40, {
        buildType: 'nixpack',
        imageBuild: 'starting',
      });

      const imageTag = this.generateImageTag(serviceName, deploymentId);
      await this.dockerService.buildImage(sourcePath, imageTag);

      await this.updatePhase(config, DeploymentPhase.COPYING_FILES, 50, {
        imageTag,
        containerSetup: 'starting',
      });

      await this.log(config, 'info', `Docker image built: ${imageTag}`, 'build', 'image-ready', 'nixpack-builder');

      // Create and start container
      const containerName = this.generateContainerName(serviceName, deploymentId);
      const containerId = await this.createAndStartContainer(
        imageTag,
        containerName,
        deploymentId,
        environmentVariables,
        port,
      );

      await this.updatePhase(config, DeploymentPhase.UPDATING_ROUTES, 75, {
        containerId,
        containerName,
        routeSetup: 'configuring',
      });

      // Phase: HEALTH_CHECK
      await this.updatePhase(config, DeploymentPhase.HEALTH_CHECK, 90, {
        healthCheckStarted: true,
      });

      // Verify container health
      const healthCheckUrl = this.generateHealthCheckUrl(containerName, port, healthCheckPath);
      const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

      // Final phase based on health check
      if (isHealthy) {
        await this.updatePhase(config, DeploymentPhase.ACTIVE, 100, {
          containerName,
          imageTag,
          port,
          healthCheckUrl,
          deploymentCompletedAt: new Date().toISOString(),
        });
      } else {
        await this.updatePhase(config, DeploymentPhase.FAILED, 0, {
          error: 'Health check failed',
          containerName,
          imageTag,
          healthCheckUrl,
        });
      }

      return {
        deploymentId,
        containerIds: [containerId],
        containers: [containerId],
        status: isHealthy ? 'success' : 'partial',
        healthCheckUrl,
        message: isHealthy
          ? 'Node.js service deployed successfully'
          : 'Node.js service deployed but health check failed',
        metadata: {
          containerName,
          imageTag,
          port,
          buildType: 'nixpack',
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to deploy using Nixpack: ${err.message}`, err.stack);

      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.FAILED, 0, {
          error: err.message,
          buildType: 'nixpack',
        });
      }

      throw error;
    }
  }

  /**
   * Generate optimized Dockerfile for Node.js applications
   */
  private generateNodejsDockerfile(options: {
    nodeVersion: string;
    installCommand: string;
    startCommand: string;
    buildCommand?: string;
    port: number;
    healthCheckPath: string;
  }): string {
    const { nodeVersion, installCommand, startCommand, buildCommand, port, healthCheckPath } = options;

    const buildStep = buildCommand
      ? `# Build if needed\nRUN ${buildCommand}\n`
      : `# Build if needed (check for build script)\nRUN if [ -f package.json ] && grep -q '"build"' package.json; then npm run build; fi\n`;

    return `
FROM node:${nodeVersion}

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN ${installCommand}

# Copy source code
COPY . .

${buildStep}
# Expose port
EXPOSE ${port}

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${healthCheckPath} || exit 1

# Start application
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
  }
}
