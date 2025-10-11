import { Injectable, Logger } from '@nestjs/common';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { BaseBuilderService, type BuilderConfig, type BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import type { IBuilder, ConfigSchema } from '@/core/interfaces/provider.interface';
import { z } from 'zod/v4';

/**
 * Interface for StaticProviderService to avoid circular dependency
 * StaticProviderService is passed as a parameter instead of being injected
 */
export interface IStaticProviderService {
  deployStaticFiles(config: {
    serviceName: string;
    deploymentId: string;
    projectId?: string;
    domain: string;
    subdomain?: string;
    sourcePath: string;
  }): Promise<{
    containerId: string;
    containerName: string;
    domain: string;
    imageUsed?: string;
  }>;
}

export interface StaticBuilderConfig extends BuilderConfig {
  projectId?: string;
  domain?: string;
  subdomain?: string;
  staticProviderService?: IStaticProviderService;  // Optional to match base class signature
}

@Injectable()
export class StaticBuilderService extends BaseBuilderService implements IBuilder {
  protected readonly logger = new Logger(StaticBuilderService.name);
  
  // IBuilder properties
  readonly id = 'static';
  readonly name = 'Static Files';
  readonly description = 'Serve static files using nginx or lightweight HTTP server';
  readonly icon = '📄';
  readonly compatibleProviders = ['static', 'github', 'gitlab', 's3'];

  constructor(
    dockerService: DockerService,
  ) {
    super(dockerService);
  }

  /**
   * Deploy static files using project-level HTTP server
   */
  async deploy(config: StaticBuilderConfig): Promise<BuilderResult> {
    const {
      deploymentId,
      serviceName,
      sourcePath,
      projectId,
      domain = process.env.TRAEFIK_DOMAIN || 'localhost',
      subdomain,
      onPhaseUpdate,
      staticProviderService,
    } = config;

    // Validate that staticProviderService is provided
    if (!staticProviderService) {
      throw new Error('StaticProviderService is required for static deployments but was not provided');
    }

    try {
      // Phase: COPYING_FILES - Static file deployment
      await this.updatePhase(config, DeploymentPhase.COPYING_FILES, 30, {
        deploymentType: 'static',
        filePreparation: 'starting',
      });

      await this.log(config, 'info', 'Deploying static site with nginx', 'deployment', 'static-setup', 'static-builder');

      // Determine final domain/subdomain
      const finalDomain = domain;
      let finalSubdomain = subdomain;

      if (!finalSubdomain) {
        // Generate subdomain from service name if not provided
        finalSubdomain = this.sanitizeForSubdomain(serviceName);
      }

      // Phase: CREATING_SYMLINKS - Project server setup
      await this.updatePhase(config, DeploymentPhase.CREATING_SYMLINKS, 60, {
        finalDomain,
        finalSubdomain,
        serverSetup: 'configuring',
      });

      // Deploy using project-level static file service
    const nginxInfo = await staticProviderService.deployStaticFiles({
      serviceName,
      deploymentId,
      projectId,
      domain,
      subdomain,
      sourcePath,
    });      // Phase: UPDATING_ROUTES - Server configured, setting up routing
      await this.updatePhase(config, DeploymentPhase.UPDATING_ROUTES, 80, {
        containerName: nginxInfo.containerName,
        domain: nginxInfo.domain,
        routeConfiguration: 'active',
      });

      const healthCheckUrl = `http://${nginxInfo.domain}/health`;

      // Phase: HEALTH_CHECK - Verify deployment
      await this.updatePhase(config, DeploymentPhase.HEALTH_CHECK, 90, {
        healthCheckUrl,
        verification: 'starting',
      });

      // Verify deployment is healthy by checking the project server container
      // Use container name instead of ID, and note that deployStaticFiles already verified health
      const isHealthy = await this.verifyContainerHealth(nginxInfo.containerName, healthCheckUrl);

      // Get the current container ID (may have changed if container was recreated during health check)
      let currentContainerId = nginxInfo.containerId;
      try {
        const containerInfo = await this.dockerService.getContainerInfo(nginxInfo.containerName);
        currentContainerId = containerInfo.Id;
      } catch (err) {
        this.logger.warn(`Could not get current container ID, using original: ${(err as Error).message}`);
      }

      // Phase: ACTIVE or FAILED based on health check
      if (isHealthy) {
        await this.updatePhase(config, DeploymentPhase.ACTIVE, 100, {
          containerName: nginxInfo.containerName,
          domain: nginxInfo.domain,
          healthCheckUrl,
          serverImage: nginxInfo.imageUsed || 'rtsp/lighttpd',
          deploymentCompletedAt: new Date().toISOString(),
        });
      } else {
        await this.updatePhase(config, DeploymentPhase.FAILED, 0, {
          error: 'Health check failed',
          healthCheckUrl,
          containerName: nginxInfo.containerName,
        });
      }

      return {
        deploymentId,
        containerIds: [currentContainerId],
        containers: [currentContainerId],
        status: isHealthy ? 'success' : 'partial',
        domain: nginxInfo.domain,
        healthCheckUrl,
        message: isHealthy ? 'Static site deployed successfully' : 'Static site deployed but health check failed',
        metadata: {
          containerName: nginxInfo.containerName,
          serverImage: nginxInfo.imageUsed || 'rtsp/lighttpd',
          buildType: 'static',
        },
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to deploy static site: ${err.message}`, err.stack);

      if (onPhaseUpdate) {
        await onPhaseUpdate(DeploymentPhase.FAILED, 0, {
          error: err.message,
          buildType: 'static',
        });
      }

      throw error;
    }
  }

  /**
   * Get configuration schema for Static builder (IBuilder interface)
   */
  getConfigSchema(): ConfigSchema {
    return {
      id: 'static-builder-config',
      version: '1.0.0',
      title: 'Static File Deployment Configuration',
      description: 'Configure static file serving with nginx',
      fields: [
        {
          key: 'indexFile',
          label: 'Index File',
          description: 'Default file to serve (e.g., index.html)',
          schema: z.string(),
          type: 'text',
          required: false,
          defaultValue: 'index.html',
          placeholder: 'index.html',
          group: 'serving',
          ui: { order: 1 },
        },
        {
          key: 'errorPage',
          label: 'Error Page',
          description: 'Custom 404 error page',
          schema: z.string().optional(),
          type: 'text',
          required: false,
          placeholder: '404.html',
          group: 'serving',
          ui: { order: 2 },
        },
        {
          key: 'serverImage',
          label: 'Server Image',
          description: 'Docker image for static file server',
          schema: z.string(),
          type: 'select',
          required: false,
          defaultValue: 'nginx:alpine',
          options: [
            { label: 'Nginx (Alpine)', value: 'nginx:alpine' },
            { label: 'Nginx (Latest)', value: 'nginx:latest' },
            { label: 'Lighttpd', value: 'rtsp/lighttpd' },
            { label: 'Apache', value: 'httpd:alpine' },
          ],
          group: 'server',
          ui: { order: 3 },
        },
        {
          key: 'port',
          label: 'Server Port',
          description: 'Internal port for the static file server',
          schema: z.number().int().min(1).max(65535),
          type: 'number',
          required: false,
          defaultValue: 80,
          placeholder: '80',
          group: 'server',
          ui: { order: 4 },
        },
        {
          key: 'enableGzip',
          label: 'Enable Gzip',
          description: 'Enable gzip compression for static assets',
          schema: z.boolean(),
          type: 'boolean',
          required: false,
          defaultValue: true,
          group: 'optimization',
          ui: { order: 5 },
        },
        {
          key: 'cacheControl',
          label: 'Cache Control Header',
          description: 'Cache-Control header value',
          schema: z.string().optional(),
          type: 'text',
          required: false,
          placeholder: 'public, max-age=31536000',
          group: 'optimization',
          ui: { order: 6, fullWidth: true },
        },
      ],
      validate: async (config: any) => {
        const errors: string[] = [];
        
        if (config.port && (config.port < 1 || config.port > 65535)) {
          errors.push('Port must be between 1 and 65535');
        }
        
        return { valid: errors.length === 0, errors };
      },
      transform: (config: any) => {
        return {
          indexFile: config.indexFile || 'index.html',
          errorPage: config.errorPage,
          serverImage: config.serverImage || 'nginx:alpine',
          port: config.port || 80,
          enableGzip: config.enableGzip ?? true,
          cacheControl: config.cacheControl,
        };
      },
    };
  }

  /**
   * Get default configuration (IBuilder interface)
   */
  getDefaultConfig(): Record<string, any> {
    return {
      indexFile: 'index.html',
      errorPage: '',
      serverImage: 'nginx:alpine',
      port: 80,
      enableGzip: true,
      cacheControl: 'public, max-age=3600',
    };
  }

  /**
   * Validate builder configuration (IBuilder interface)
   */
  async validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    if (config.port && (config.port < 1 || config.port > 65535)) {
      errors.push('Port must be between 1 and 65535');
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Sanitize a string to be used as a subdomain
   */
  private sanitizeForSubdomain(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
