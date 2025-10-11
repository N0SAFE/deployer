import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { BaseBuilderService, type BuilderConfig, type BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface BuildpackBuilderConfig extends BuilderConfig {
  installCommand?: string;
  startCommand?: string;
  buildCommand?: string;
  language?: 'nodejs' | 'python' | 'ruby' | 'go' | 'auto';
  languageVersion?: string;
}

@Injectable()
export class BuildpackBuilderService extends BaseBuilderService {
  protected readonly logger = new Logger(BuildpackBuilderService.name);

  constructor(dockerService: DockerService) {
    super(dockerService);
  }

  /**
   * Deploy an application using auto-detected language buildpack
   */
  async deploy(config: BuildpackBuilderConfig): Promise<BuilderResult> {
    const {
      deploymentId,
      serviceName,
      sourcePath,
      environmentVariables = {},
      port,
      healthCheckPath = '/health',
      installCommand,
      startCommand,
      buildCommand,
      language = 'auto',
      languageVersion,
    } = config;

    try {
      // Detect language if auto
      const detectedLanguage = language === 'auto' ? await this.detectLanguage(sourcePath) : language;

      await this.updatePhase(config, DeploymentPhase.BUILDING, 15, {
        buildType: 'buildpack',
        language: detectedLanguage,
        dockerfileGeneration: 'starting',
      });

      await this.log(config, 'info', `Generating ${detectedLanguage} Dockerfile`, 'build', 'dockerfile-generation', 'buildpack-builder');

      // Generate Dockerfile based on detected language
      const dockerfile = await this.generateDockerfileForLanguage(detectedLanguage, {
        sourcePath,
        installCommand,
        startCommand,
        buildCommand,
        languageVersion,
        port,
        healthCheckPath,
      });

      // Write Dockerfile to source path
      const dockerfilePath = path.join(sourcePath, 'Dockerfile');
      await fs.writeFile(dockerfilePath, dockerfile);

      await this.updatePhase(config, DeploymentPhase.BUILDING, 25, {
        buildType: 'buildpack',
        language: detectedLanguage,
        dockerfileGeneration: 'completed',
      });

      await this.log(config, 'info', `${detectedLanguage} Dockerfile generated successfully`, 'build', 'dockerfile-ready', 'buildpack-builder');

      // Build Docker image
      await this.updatePhase(config, DeploymentPhase.BUILDING, 40, {
        buildType: 'buildpack',
        imageBuild: 'starting',
      });

      const imageTag = this.generateImageTag(serviceName, deploymentId);
      await this.dockerService.buildImage(sourcePath, imageTag);

      await this.updatePhase(config, DeploymentPhase.COPYING_FILES, 50, {
        imageTag,
        containerSetup: 'starting',
      });

      await this.log(config, 'info', `Docker image built: ${imageTag}`, 'build', 'image-ready', 'buildpack-builder');

      // Create and start container
      const containerName = this.generateContainerName(serviceName, deploymentId);
      const detectedPort = port || this.getDefaultPort(detectedLanguage);
      const containerId = await this.createAndStartContainer(
        imageTag,
        containerName,
        deploymentId,
        environmentVariables,
        detectedPort,
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
      const healthCheckUrl = this.generateHealthCheckUrl(containerName, detectedPort, healthCheckPath);
      const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

      // Final phase based on health check
      if (isHealthy) {
        await this.updatePhase(config, DeploymentPhase.ACTIVE, 100, {
          containerName,
          imageTag,
          port: detectedPort,
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
          ? `${detectedLanguage} service deployed successfully`
          : `${detectedLanguage} service deployed but health check failed`,
        metadata: {
          containerName,
          imageTag,
          port: detectedPort,
          buildType: 'buildpack',
          language: detectedLanguage,
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to deploy using Buildpack: ${err.message}`, err.stack);

      if (config.onPhaseUpdate) {
        await config.onPhaseUpdate(DeploymentPhase.FAILED, 0, {
          error: err.message,
          buildType: 'buildpack',
        });
      }

      throw error;
    }
  }

  /**
   * Detect the programming language of the project
   */
  private async detectLanguage(sourcePath: string): Promise<'nodejs' | 'python' | 'ruby' | 'go'> {
    try {
      const files = await fs.readdir(sourcePath);

      // Check for Node.js
      if (files.includes('package.json')) {
        return 'nodejs';
      }

      // Check for Python
      if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('Pipfile')) {
        return 'python';
      }

      // Check for Ruby
      if (files.includes('Gemfile') || files.includes('Rakefile')) {
        return 'ruby';
      }

      // Check for Go
      if (files.includes('go.mod') || files.includes('go.sum')) {
        return 'go';
      }

      // Default to Node.js if unable to detect
      this.logger.warn(`Unable to detect language for ${sourcePath}, defaulting to Node.js`);
      return 'nodejs';
    } catch (error) {
      this.logger.error(`Error detecting language: ${error}`);
      return 'nodejs';
    }
  }

  /**
   * Get default port for a language
   */
  private getDefaultPort(language: string): number {
    const portMap: Record<string, number> = {
      nodejs: 3000,
      python: 8000,
      ruby: 3000,
      go: 8080,
    };
    return portMap[language] || 3000;
  }

  /**
   * Generate Dockerfile based on detected language
   */
  private async generateDockerfileForLanguage(
    language: string,
    options: {
      sourcePath: string;
      installCommand?: string;
      startCommand?: string;
      buildCommand?: string;
      languageVersion?: string;
      port?: number;
      healthCheckPath: string;
    },
  ): Promise<string> {
    switch (language) {
      case 'nodejs':
        return this.generateNodejsDockerfile(options);
      case 'python':
        return this.generatePythonDockerfile(options);
      case 'ruby':
        return this.generateRubyDockerfile(options);
      case 'go':
        return this.generateGoDockerfile(options);
      default:
        return this.generateNodejsDockerfile(options);
    }
  }

  /**
   * Generate Node.js Dockerfile
   */
  private generateNodejsDockerfile(options: {
    installCommand?: string;
    startCommand?: string;
    buildCommand?: string;
    languageVersion?: string;
    port?: number;
    healthCheckPath: string;
  }): string {
    const nodeVersion = options.languageVersion || '18-alpine';
    const installCommand = options.installCommand || 'npm install';
    const startCommand = options.startCommand || 'npm start';
    const port = options.port || 3000;
    const buildStep = options.buildCommand
      ? `RUN ${options.buildCommand}`
      : `RUN if [ -f package.json ] && grep -q '"build"' package.json; then npm run build; fi`;

    return `
FROM node:${nodeVersion}
WORKDIR /app
COPY package*.json ./
RUN ${installCommand}
COPY . .
${buildStep}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${options.healthCheckPath} || exit 1
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
  }

  /**
   * Generate Python Dockerfile
   */
  private generatePythonDockerfile(options: {
    installCommand?: string;
    startCommand?: string;
    languageVersion?: string;
    port?: number;
    healthCheckPath: string;
  }): string {
    const pythonVersion = options.languageVersion || '3.11-alpine';
    const installCommand = options.installCommand || 'pip install -r requirements.txt';
    const startCommand = options.startCommand || 'python app.py';
    const port = options.port || 8000;

    return `
FROM python:${pythonVersion}
WORKDIR /app
COPY requirements.txt ./
RUN ${installCommand}
COPY . .
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${options.healthCheckPath} || exit 1
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
  }

  /**
   * Generate Ruby Dockerfile
   */
  private generateRubyDockerfile(options: {
    installCommand?: string;
    startCommand?: string;
    languageVersion?: string;
    port?: number;
    healthCheckPath: string;
  }): string {
    const rubyVersion = options.languageVersion || '3.2-alpine';
    const installCommand = options.installCommand || 'bundle install';
    const startCommand = options.startCommand || 'bundle exec rails server';
    const port = options.port || 3000;

    return `
FROM ruby:${rubyVersion}
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN ${installCommand}
COPY . .
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${options.healthCheckPath} || exit 1
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
  }

  /**
   * Generate Go Dockerfile
   */
  private generateGoDockerfile(options: {
    startCommand?: string;
    languageVersion?: string;
    port?: number;
    healthCheckPath: string;
  }): string {
    const goVersion = options.languageVersion || '1.21-alpine';
    const startCommand = options.startCommand || './main';
    const port = options.port || 8080;

    return `
FROM golang:${goVersion} AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:latest
RUN apk --no-cache add ca-certificates curl
WORKDIR /root/
COPY --from=builder /app/main .
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${options.healthCheckPath} || exit 1
CMD ["${startCommand}"]
    `.trim();
  }
}
