import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { BaseBuilderService, type BuilderConfig, type BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DockerComposeBuilderConfig extends BuilderConfig {
  composeFile?: string;
  projectName?: string;
  services?: string[]; // Specific services to deploy from compose file
}

@Injectable()
export class DockerComposeBuilderService extends BaseBuilderService {
  protected readonly logger = new Logger(DockerComposeBuilderService.name);

  constructor(dockerService: DockerService) {
    super(dockerService);
  }

  /**
   * Deploy a multi-container application using Docker Compose
   */
  async deploy(config: DockerComposeBuilderConfig): Promise<BuilderResult> {
    const {
      deploymentId,
      serviceName,
      sourcePath,
      environmentVariables = {},
      port,
      healthCheckPath = '/health',
      composeFile = 'docker-compose.yml',
      projectName,
      services,
      onPhaseUpdate,
    } = config;

    try {
      // Verify compose file exists
      const composePath = path.join(sourcePath, composeFile);
      const composeExists = await fs.access(composePath).then(() => true).catch(() => false);

      if (!composeExists) {
        throw new Error(`Docker Compose file not found: ${composePath}`);
      }

      // Phase: BUILDING - Parse and prepare compose configuration
      await this.updatePhase(config, DeploymentPhase.BUILDING, 20, {
        buildType: 'docker_compose',
        composeFile,
        parsing: 'starting',
      });

      await this.log(config, 'info', 'Parsing Docker Compose configuration', 'build', 'compose-parse', 'docker-compose-builder');

      // Set up environment variables for compose
      const composeEnv = {
        ...process.env,
        ...environmentVariables,
        COMPOSE_PROJECT_NAME: projectName || serviceName,
        DEPLOYMENT_ID: deploymentId,
      };

      // Phase: COPYING_FILES - Build and start services
      await this.updatePhase(config, DeploymentPhase.COPYING_FILES, 40, {
        buildType: 'docker_compose',
        serviceStart: 'starting',
      });

      await this.log(config, 'info', 'Building and starting Docker Compose services', 'build', 'compose-up', 'docker-compose-builder');

      // Build docker-compose command
      const serviceArgs = services && services.length > 0 ? services.join(' ') : '';
      const composeCmd = `docker-compose -f ${composeFile} -p ${projectName || serviceName} up -d --build ${serviceArgs}`;

      // Execute docker-compose up
      const { stderr } = await execAsync(composeCmd, {
        cwd: sourcePath,
        env: composeEnv,
      });

      if (stderr && !stderr.includes('Creating') && !stderr.includes('Starting')) {
        this.logger.warn(`Docker Compose stderr: ${stderr}`);
      }

      await this.log(config, 'info', 'Docker Compose services started', 'build', 'compose-started', 'docker-compose-builder');

      // Get list of containers created by compose
      const containerListCmd = `docker-compose -f ${composeFile} -p ${projectName || serviceName} ps -q`;
      const { stdout: containerIds } = await execAsync(containerListCmd, {
        cwd: sourcePath,
        env: composeEnv,
      });

      const containers = containerIds.trim().split('\n').filter(id => id.length > 0);

      if (containers.length === 0) {
        throw new Error('No containers were created by Docker Compose');
      }

      // Phase: UPDATING_ROUTES - Services are running
      await this.updatePhase(config, DeploymentPhase.UPDATING_ROUTES, 75, {
        containersCreated: containers.length,
        routeSetup: 'configuring',
      });

      // Phase: HEALTH_CHECK
      await this.updatePhase(config, DeploymentPhase.HEALTH_CHECK, 90, {
        healthCheckStarted: true,
      });

      // Verify health of main container (first one or specified service)
      const mainContainerId = containers[0];
      let healthCheckUrl: string | undefined;

      if (port) {
        healthCheckUrl = `http://localhost:${port}${healthCheckPath}`;
        await this.log(config, 'info', `Checking health at: ${healthCheckUrl}`, 'health-check', 'verify', 'docker-compose-builder');
      }

      const isHealthy = await this.verifyContainerHealth(mainContainerId, healthCheckUrl || '');

      // Final phase based on health check
      if (isHealthy) {
        await this.updatePhase(config, DeploymentPhase.ACTIVE, 100, {
          containersCount: containers.length,
          containerIds: containers,
          healthCheckUrl,
          deploymentCompletedAt: new Date().toISOString(),
        });
      } else {
        await this.updatePhase(config, DeploymentPhase.FAILED, 0, {
          error: 'Health check failed',
          containersCount: containers.length,
          containerIds: containers,
        });
      }

      return {
        deploymentId,
        containerIds: containers,
        containers,
        status: isHealthy ? 'success' : 'partial',
        healthCheckUrl,
        message: isHealthy
          ? `Docker Compose deployment successful with ${containers.length} containers`
          : `Docker Compose deployment created ${containers.length} containers but health check failed`,
        metadata: {
          composeFile,
          projectName: projectName || serviceName,
          containersCount: containers.length,
          buildType: 'docker_compose',
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to deploy using Docker Compose: ${err.message}`, err.stack);

      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.FAILED, 0, {
          error: err.message,
          buildType: 'docker_compose',
        });
      }

      throw error;
    }
  }

  /**
   * Stop and remove Docker Compose deployment
   */
  async teardown(config: {
    sourcePath: string;
    composeFile?: string;
    projectName?: string;
  }): Promise<void> {
    const { sourcePath, composeFile = 'docker-compose.yml', projectName } = config;

    try {
      const composeCmd = `docker-compose -f ${composeFile} -p ${projectName} down -v`;
      await execAsync(composeCmd, { cwd: sourcePath });
      this.logger.log(`Docker Compose deployment ${projectName} torn down successfully`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to tear down Docker Compose deployment: ${err.message}`);
      throw error;
    }
  }
}
