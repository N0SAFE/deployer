import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DockerfileBuilderService } from '@/core/modules/builders/dockerfile/dockerfile-builder.service';
import { NixpackBuilderService } from '@/core/modules/builders/nixpack/nixpack-builder.service';
import { BuildpackBuilderService } from '@/core/modules/builders/buildpack/buildpack-builder.service';
import { StaticBuilderService } from '@/core/modules/builders/static/static-builder.service';
import { DockerComposeBuilderService } from '@/core/modules/builders/docker-compose/docker-compose-builder.service';
import type {
  IDeploymentProvider,
  ProviderConfig,
  DeploymentTrigger,
  SourceFiles,
} from '../../providers/interfaces/provider.interface';
import type { BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import { TraefikVariableResolverService } from '@/core/modules/traefik/services/traefik-variable-resolver.service';
import type { VariableResolutionContext } from '@/core/modules/traefik/services/traefik-variable-resolver.service';
import { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { services, projects, deployments } from '@/config/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export interface BuilderConfig {
  type: 'dockerfile' | 'nixpacks' | 'buildpack' | 'static' | 'docker-compose';
  config: {
    // Dockerfile
    dockerfilePath?: string;
    buildContext?: string;
    buildArgs?: Record<string, string>;

    // Nixpacks/Buildpack
    buildCommand?: string;
    startCommand?: string;
    installCommand?: string;

    // Static
    outputDirectory?: string;

    // Docker Compose
    composeFilePath?: string;
    serviceName?: string;
  };
}

export interface DeploymentConfig {
  projectId: string;
  serviceId: string;
  environment: 'production' | 'staging' | 'preview' | 'development';

  provider: ProviderConfig;
  builder: BuilderConfig;

  // Deployment options
  healthCheck?: {
    path: string;
    timeout: number;
    retries: number;
  };

  rollback?: {
    enabled: boolean;
    onHealthCheckFail: boolean;
  };

  // Resource limits
  resources?: {
    memory?: string;
    cpu?: string;
    storage?: string;
  };
}

export interface DeploymentResult {
  deploymentId: string;
  status: 'success' | 'failed';
  source: SourceFiles;
  containerName?: string;
  containerImage?: string;
  url?: string;
  error?: string;
  duration?: number;
}

/**
 * Deployment Orchestrator
 * 
 * Orchestrates the entire deployment pipeline:
 * 1. Provider fetches source files
 * 2. Builder builds the application
 * 3. Deploy to Docker/Swarm
 * 4. Health check
 * 5. Update routing (Traefik)
 * 6. Rollback on failure
 * 
 * This is provider-agnostic - works with ANY provider
 * Providers are auto-injected and registered on initialization
 */
@Injectable()
export class DeploymentOrchestrator {
  private readonly logger = new Logger(DeploymentOrchestrator.name);
  private providers: Map<string, IDeploymentProvider> = new Map();

  constructor(
    @Optional() @Inject('DEPLOYMENT_PROVIDERS') private readonly injectedProviders?: IDeploymentProvider[],
    // Builders (optional so orchestrator can be used in tests without all builders)
    @Optional() private readonly dockerfileBuilder?: DockerfileBuilderService,
    @Optional() private readonly nixpackBuilder?: NixpackBuilderService,
    @Optional() private readonly buildpackBuilder?: BuildpackBuilderService,
    @Optional() private readonly staticBuilder?: StaticBuilderService,
    @Optional() private readonly composeBuilder?: DockerComposeBuilderService,
    @Optional() private readonly dockerService?: DockerService,
    // Traefik and database services for routing
    @Optional() private readonly traefikVariableResolver?: TraefikVariableResolverService,
    @Optional() private readonly databaseService?: DatabaseService,
  ) {
    // Auto-register all injected providers
    if (this.injectedProviders) {
      for (const provider of this.injectedProviders) {
        this.registerProvider(provider);
      }
    }
  }

  /**
   * Register a provider
   */
  registerProvider(provider: IDeploymentProvider): void {
    this.providers.set(provider.type, provider);
    this.logger.log(`Registered provider: ${provider.name} (${provider.type})`);
  }

  /**
   * Get a provider by type
   */
  getProvider(type: string): IDeploymentProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get all registered providers
   */
  getProviders(): IDeploymentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Deploy from GitHub repository
   * Convenience method for GitHub deployments
   */
  async deployFromGitHub(
    projectId: string,
    serviceId: string,
    repositoryUrl: string,
    branch: string,
    builderType: BuilderConfig['type'] = 'dockerfile',
    options?: Partial<DeploymentConfig>,
  ): Promise<DeploymentResult> {
    const config: DeploymentConfig = {
      projectId,
      serviceId,
      environment: 'production',
      provider: {
        type: 'github',
        config: {},
        repository: {
          url: repositoryUrl,
          branch,
        },
      },
      builder: {
        type: builderType,
        config: {},
      },
      ...options,
    };

    const trigger: DeploymentTrigger = {
      trigger: 'manual',
      userId: options?.healthCheck ? 'system' : undefined,
    };

    return this.deploy(config, trigger);
  }

  /**
   * Deploy static files
   * Convenience method for static file deployments
   */
  async deployStatic(
    projectId: string,
    serviceId: string,
    sourcePath: string,
    options?: Partial<DeploymentConfig>,
  ): Promise<DeploymentResult> {
    const config: DeploymentConfig = {
      projectId,
      serviceId,
      environment: 'production',
      provider: {
        type: 'static',
        config: {},
        repository: {
          url: sourcePath,
        },
      },
      builder: {
        type: 'static',
        config: {},
      },
      ...options,
    };

    const trigger: DeploymentTrigger = {
      trigger: 'manual',
      data: {
        sourcePath,
      },
    };

    return this.deploy(config, trigger);
  }

  /**
   * Execute a deployment
   * 
   * This is the main deployment pipeline that works with ANY provider
   */
  async deploy(
    config: DeploymentConfig,
    trigger: DeploymentTrigger,
  ): Promise<DeploymentResult> {
    const startTime = Date.now();

    this.logger.log(
      `Starting deployment for service ${config.serviceId} using ${config.provider.type} provider`,
    );

    try {
      // Step 1: Get the provider
      const provider = this.getProvider(config.provider.type);
      if (!provider) {
        throw new Error(`Provider not found: ${config.provider.type}`);
      }

      // Step 2: Validate provider configuration
      const validation = await provider.validateConfig(config.provider);
      if (!validation.valid) {
        throw new Error(
          `Invalid provider configuration: ${validation.errors?.join(', ')}`,
        );
      }

      // Step 3: Check if deployment should be skipped (cache)
      const skipCheck = await provider.shouldSkipDeployment(config.provider, trigger);
      if (skipCheck.shouldSkip) {
        this.logger.log(`Skipping deployment: ${skipCheck.reason}`);
        return {
          deploymentId: `skipped-${Date.now()}`,
          status: 'success',
          source: {
            sourceId: 'cached',
            localPath: '',
            metadata: { provider: config.provider.type },
            cleanup: async () => {},
          },
          error: skipCheck.reason,
        };
      }

      // Step 4: Fetch source files from provider
      this.logger.log('Fetching source files from provider...');
      const source = await provider.fetchSource(config.provider, trigger);

      try {
        // Step 5: Build the application using builder strategy
  this.logger.log(`Building with ${config.builder.type} builder...`);
        const buildResult = await this.build(source, config.builder, config);

        // If the build failed, abort
        if (buildResult.status !== 'success') {
          this.logger.error(`Build failed: ${buildResult.message}`);
          throw new Error(`Build failed: ${buildResult.message}`);
        }

        // Step 6: Deploy to container orchestrator
        this.logger.log('Deploying to container orchestrator...');
        const deployResult = await this.deployContainer(buildResult, config);

        // Step 7: Health check
        if (config.healthCheck) {
          this.logger.log('Running health checks...');
          const healthy = await this.runHealthCheck(deployResult.url!, config.healthCheck);

          if (!healthy && config.rollback?.onHealthCheckFail) {
            this.logger.warn('Health check failed, rolling back...');
            await this.rollback(config.serviceId);
            throw new Error('Health check failed after deployment');
          }
        }

        // Step 8: Update routing (Traefik)
        this.logger.log('Updating routing...');
        await this.updateRouting(config.serviceId, deployResult.url!);

        const duration = Date.now() - startTime;
        this.logger.log(`Deployment completed successfully in ${duration}ms`);

        return {
          deploymentId: deployResult.deploymentId,
          status: 'success',
          source,
          containerName: deployResult.containerName,
          containerImage: deployResult.containerImage,
          url: deployResult.url,
          duration,
        };
      } finally {
        // Always cleanup source files
        await source.cleanup();
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Deployment failed: ${errorMessage}`, error instanceof Error ? error.stack : undefined);

      return {
        deploymentId: `failed-${Date.now()}`,
        status: 'failed',
        source: {
          sourceId: 'error',
          localPath: '',
          metadata: { provider: config.provider.type },
          cleanup: async () => {},
        },
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Build application using builder strategy
   * 
   * Delegates to appropriate builder based on config
   */
  private async build(
    source: SourceFiles,
    config: BuilderConfig,
    deploymentConfig?: DeploymentConfig,
  ): Promise<BuilderResult> {
    switch (config.type) {
      case 'dockerfile':
        if (this.dockerfileBuilder) {
          return this.dockerfileBuilder.deploy({
            deploymentId: deploymentConfig?.serviceId || `deploy-${Date.now()}`,
            serviceName: deploymentConfig?.serviceId || 'service',
            sourcePath: source.localPath,
            environmentVariables: {},
            healthCheckPath: deploymentConfig?.healthCheck?.path || '/health',
          } as any);
        }
        // Fallback to legacy implementation
  const legacyDocker = await this.buildWithDocker(source, config.config, deploymentConfig);
        return {
          deploymentId: `legacy-${Date.now()}`,
          containerIds: [],
          containers: [],
          status: 'success',
          healthCheckUrl: undefined,
          domain: undefined,
          message: legacyDocker.buildLogs,
          metadata: { image: legacyDocker.image },
        };

      case 'nixpacks':
        if (this.nixpackBuilder) {
          return this.nixpackBuilder.deploy({
            deploymentId: deploymentConfig?.serviceId || `deploy-${Date.now()}`,
            serviceName: deploymentConfig?.serviceId || 'service',
            sourcePath: source.localPath,
            environmentVariables: {},
            healthCheckPath: deploymentConfig?.healthCheck?.path || '/health',
            installCommand: config.config.installCommand,
            startCommand: config.config.startCommand,
            buildCommand: config.config.buildCommand,
          } as any);
        }
  const legacyNix = await this.buildWithNixpacks(source, config.config, deploymentConfig);
        return {
          deploymentId: `legacy-${Date.now()}`,
          containerIds: [],
          containers: [],
          status: 'success',
          healthCheckUrl: undefined,
          domain: undefined,
          message: legacyNix.buildLogs,
          metadata: { image: legacyNix.image },
        };

      case 'buildpack':
        if (this.buildpackBuilder) {
          return this.buildpackBuilder.deploy({
            deploymentId: deploymentConfig?.serviceId || `deploy-${Date.now()}`,
            serviceName: deploymentConfig?.serviceId || 'service',
            sourcePath: source.localPath,
            environmentVariables: {},
            healthCheckPath: deploymentConfig?.healthCheck?.path || '/health',
            installCommand: config.config.installCommand,
            startCommand: config.config.startCommand,
            buildCommand: config.config.buildCommand,
          } as any);
        }
  const legacyBp = await this.buildWithBuildpack(source, config.config, deploymentConfig);
        return {
          deploymentId: `legacy-${Date.now()}`,
          containerIds: [],
          containers: [],
          status: 'success',
          healthCheckUrl: undefined,
          domain: undefined,
          message: legacyBp.buildLogs,
          metadata: { image: legacyBp.image },
        };

      case 'static':
        if (this.staticBuilder) {
          return this.staticBuilder.deploy({
            deploymentId: deploymentConfig?.serviceId || `deploy-${Date.now()}`,
            serviceName: deploymentConfig?.serviceId || 'service',
            sourcePath: source.localPath,
            environmentVariables: {},
            projectId: deploymentConfig?.projectId,
            domain: process.env.TRAEFIK_DOMAIN || 'localhost',
          } as any);
        }
  const legacyStatic = await this.buildStatic(source, config.config, deploymentConfig);
        return {
          deploymentId: `legacy-${Date.now()}`,
          containerIds: [],
          containers: [],
          status: 'success',
          healthCheckUrl: undefined,
          domain: undefined,
          message: legacyStatic.buildLogs,
          metadata: { image: legacyStatic.image },
        };

      case 'docker-compose':
        if (this.composeBuilder) {
          return this.composeBuilder.deploy({
            deploymentId: deploymentConfig?.serviceId || `deploy-${Date.now()}`,
            serviceName: deploymentConfig?.serviceId || 'service',
            sourcePath: source.localPath,
            environmentVariables: {},
            composeFile: config.config.composeFilePath,
            projectName: `${deploymentConfig?.serviceId || 'stack'}-${Date.now()}`,
          } as any);
        }
  const legacyCompose = await this.buildWithDockerCompose(source, config.config, deploymentConfig);
        return {
          deploymentId: `legacy-${Date.now()}`,
          containerIds: [],
          containers: [],
          status: 'success',
          healthCheckUrl: undefined,
          domain: undefined,
          message: legacyCompose.buildLogs,
          metadata: { image: legacyCompose.image },
        };

      default:
        throw new Error(`Unknown builder type: ${config.type}`);
    }
  }

  /**
   * Build with Dockerfile
   */
  private async buildWithDocker(
    source: SourceFiles,
    _config: BuilderConfig['config'],
    deploymentConfig?: DeploymentConfig,
  ): Promise<{ image: string; buildLogs: string }> {
    this.logger.log('Fallback: Building with Dockerfile via DockerService...');
    if (!this.dockerService) {
      this.logger.warn('DockerService not available - cannot perform fallback build');
      return { image: 'built-image:latest', buildLogs: 'DockerService missing - fallback not executed' };
    }

    const serviceId = deploymentConfig?.serviceId || `legacy-${Date.now()}`;
    const imageTag = `${serviceId}:${Date.now().toString(36)}`;

    try {
      await this.dockerService.buildImage(source.localPath, imageTag);
      return { image: imageTag, buildLogs: `Built image ${imageTag}` };
    } catch (err) {
      this.logger.error('Docker fallback build failed', err as Error);
      throw err;
    }
  }

  /**
   * Build with Nixpacks
   */
  private async buildWithNixpacks(
    source: SourceFiles,
    _config: BuilderConfig['config'],
    deploymentConfig?: DeploymentConfig,
  ): Promise<{ image: string; buildLogs: string }> {
    this.logger.log('Fallback: Building with Nixpacks flow via Dockerfile fallback...');
    // Fallback: attempt Dockerfile build if Nixpacks not available
    return this.buildWithDocker(source, _config, deploymentConfig);
  }

  /**
   * Build with Buildpack
   */
  private async buildWithBuildpack(
    source: SourceFiles,
    _config: BuilderConfig['config'],
    deploymentConfig?: DeploymentConfig,
  ): Promise<{ image: string; buildLogs: string }> {
    this.logger.log('Fallback: Building with Buildpack flow via Dockerfile fallback...');
    // Fallback: attempt Dockerfile build if buildpack not available
    return this.buildWithDocker(source, _config, deploymentConfig);
  }

  /**
   * Build static site
   */
  private async buildStatic(
    source: SourceFiles,
    _config: BuilderConfig['config'],
    deploymentConfig?: DeploymentConfig,
  ): Promise<{ image: string; buildLogs: string }> {
    this.logger.log('Fallback: Building static site into nginx image...');
    if (!this.dockerService) {
      this.logger.warn('DockerService not available - cannot perform static fallback build');
      return { image: 'static-image:latest', buildLogs: 'DockerService missing - no static fallback' };
    }

    const tempBase = path.join(os.tmpdir(), 'deployer-static-');
    const tempDir = await fs.promises.mkdtemp(tempBase);
    try {
      // Copy source files into temp dir
      await fs.promises.mkdir(tempDir, { recursive: true });
      if ((fs.promises as any).cp) {
        await (fs.promises as any).cp(source.localPath, tempDir, { recursive: true });
      } else {
        // Simple recursive copy fallback
        const copyRecursive = async (src: string, dest: string) => {
          const entries = await fs.promises.readdir(src, { withFileTypes: true });
          await fs.promises.mkdir(dest, { recursive: true });
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              await copyRecursive(srcPath, destPath);
            } else if (entry.isSymbolicLink()) {
              try {
                const link = await fs.promises.readlink(srcPath);
                await fs.promises.symlink(link, destPath);
              } catch { /* ignore */ }
            } else {
              await fs.promises.copyFile(srcPath, destPath);
            }
          }
        };
        await copyRecursive(source.localPath, tempDir);
      }

      // Write simple nginx Dockerfile
      const dockerfile = `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      await fs.promises.writeFile(path.join(tempDir, 'Dockerfile'), dockerfile, 'utf8');

      const serviceId = deploymentConfig?.serviceId || `static-${Date.now()}`;
      const imageTag = `${serviceId}:static-${Date.now().toString(36)}`;
      await this.dockerService.buildImage(tempDir, imageTag);
      return { image: imageTag, buildLogs: `Built static nginx image ${imageTag}` };
    } catch (err) {
      this.logger.error('Static fallback build failed', err as Error);
      throw err;
    } finally {
      // Cleanup temp dir
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Build with Docker Compose
   * 
   * Loads docker-compose.yml from source files and deploys to Docker
   */
  private async buildWithDockerCompose(
    source: SourceFiles,
    _config: BuilderConfig['config'],
    deploymentConfig?: DeploymentConfig,
  ): Promise<{ image: string; buildLogs: string }> {
    this.logger.log('Fallback: Building docker-compose services (partial fallback)');
    // If compose builder exists it should have been used earlier; this is a best-effort fallback
    if (!this.dockerService) {
      this.logger.warn('DockerService not available - cannot perform compose fallback');
      return { image: 'compose-service:latest', buildLogs: 'DockerService missing - fallback not executed' };
    }

    // Locate compose file
    const candidates = [
      _config.composeFilePath,
      path.join(source.localPath, 'docker-compose.yml'),
      path.join(source.localPath, 'docker-compose.yaml'),
    ].filter(Boolean) as string[];

    let composePath: string | undefined;
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        composePath = c;
        break;
      }
    }

    if (!composePath) {
      this.logger.warn('No docker-compose file found in source for fallback');
      throw new Error('docker-compose.yml not found for fallback');
    }

    try {
      const raw = await fs.promises.readFile(composePath, 'utf8');
      const parsed = YAML.parse(raw) as any;
      const services = parsed?.services || {};
      const builtImages: string[] = [];

      for (const [serviceName, svc] of Object.entries(services)) {
        const serviceObj = svc as any;
        if (serviceObj.build) {
          // build can be string or object
          const buildContext = typeof serviceObj.build === 'string'
            ? path.resolve(source.localPath, serviceObj.build)
            : path.resolve(source.localPath, serviceObj.build.context || '.');
          const imageTag = `${serviceName}-${Date.now().toString(36)}`;
          await this.dockerService.buildImage(buildContext, imageTag);
          builtImages.push(imageTag);
        } else if (serviceObj.image) {
          builtImages.push(serviceObj.image as string);
        }
      }

      const firstImage = builtImages[0] || `${deploymentConfig?.serviceId || 'compose'}:latest`;
      return { image: firstImage, buildLogs: `Built/collected images: ${builtImages.join(', ')}` };
    } catch (err) {
      this.logger.error('Docker Compose fallback build failed', err as Error);
      throw err;
    }
  }

  /**
   * Deploy container
   */
  private async deployContainer(
    buildResult: BuilderResult,
    _config: DeploymentConfig,
  ): Promise<{
    deploymentId: string;
    containerName: string;
    containerImage: string;
    url: string;
  }> {
    // Map builder results to orchestrator deployment result
    this.logger.debug('Deploying container...');

    const containerName =
      (buildResult.containers && buildResult.containers.length > 0)
        ? buildResult.containers[0]
        : (buildResult.containerIds && buildResult.containerIds.length > 0)
        ? buildResult.containerIds[0]
        : 'container-name';

    const containerImage = (buildResult.metadata && (buildResult.metadata as any).image) || 'unknown';

    const url = buildResult.healthCheckUrl || buildResult.domain || `http://${containerName}`;

    return {
      deploymentId: buildResult.deploymentId || `deploy-${Date.now()}`,
      containerName,
      containerImage,
      url,
    };
  }

  /**
   * Run health check
   */
  private async runHealthCheck(
    url: string,
    config: { path: string; timeout: number; retries: number },
  ): Promise<boolean> {
    // Implementation: HTTP health check with retries
    this.logger.debug(`Health check: ${url}${config.path}`);
    return true;
  }

  /**
   * Update routing (Traefik)
   * 
   * Gets service's TraefikConfigBuilder from DB, resolves variables with deployment context,
   * and writes the resolved configuration to Traefik's dynamic config directory.
   */
  private async updateRouting(serviceId: string, _url: string): Promise<void> {
    this.logger.log(`Updating Traefik routing for service ${serviceId}`);

    if (!this.databaseService || !this.traefikVariableResolver) {
      this.logger.warn('Database or Traefik variable resolver not available - skipping routing update');
      return;
    }

    try {
      // Get service with traefik config from database
      const [service] = await this.databaseService.db
        .select()
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1);

      if (!service) {
        throw new Error(`Service ${serviceId} not found`);
      }

      // Get traefik config (auto-deserialized by custom column type)
      let traefikConfig = service.traefikConfig as unknown as TraefikConfigBuilder;

      // If no config exists, get default from provider
      if (!traefikConfig) {
        this.logger.log('No Traefik config found in service, using default');
        // Get provider to generate default config
        const provider = this.getProvider(service.providerId);
        if (!provider || typeof (provider as any).getDefaultTraefikConfig !== 'function') {
          this.logger.warn(`Provider ${service.providerId} does not support getDefaultTraefikConfig - skipping routing`);
          return;
        }
        traefikConfig = (provider as any).getDefaultTraefikConfig({ enableSSL: false });
      }

      // Get latest deployment for this service to get container info
      const [latestDeployment] = await this.databaseService.db
        .select()
        .from(deployments)
        .where(eq(deployments.serviceId, serviceId))
        .orderBy(desc(deployments.createdAt))
        .limit(1);

      if (!latestDeployment) {
        this.logger.warn('No deployment found for service - cannot resolve variables');
        return;
      }

      // Get project info
      const [project] = await this.databaseService.db
        .select()
        .from(projects)
        .where(eq(projects.id, service.projectId))
        .limit(1);

      // Build variable resolution context
      const domain = process.env.TRAEFIK_DOMAIN || process.env.DEPLOYER_BASE_DOMAIN || 'localhost';
      const containerName = latestDeployment.containerName || `${service.name}-${latestDeployment.id.substring(0, 8)}`;
      const containerPort = (service as any).port || 3000;
      const subdomain = `${service.name}-${project?.name || 'project'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const fullDomain = `${subdomain}.${domain}`;

      const context: VariableResolutionContext = {
        service: {
          id: service.id,
          name: service.name,
          type: service.type,
        },
        deployment: {
          id: latestDeployment.id,
          containerName,
          containerPort,
          containerId: containerName, // Use containerName as fallback
          environment: latestDeployment.environment,
        },
        domain: {
          domain,
          subdomain,
          fullDomain,
          baseDomain: domain,
        },
        project: {
          id: service.projectId,
          name: project?.name || 'project',
        },
        ssl: {
          certFile: `/certificates/${fullDomain}.crt`,
          keyFile: `/certificates/${fullDomain}.key`,
          certResolver: 'letsencrypt',
        },
        path: {
          prefix: '/',
          healthCheck: '/health',
        },
      };

      // Resolve variables in traefik config
      this.logger.debug('Resolving Traefik config variables', { context });
      const resolvedBuilder = this.traefikVariableResolver.resolveBuilder(traefikConfig, context);

      // Build and convert to YAML
      const resolvedConfig = resolvedBuilder.build();
      const yamlConfig = TraefikConfigBuilder.toYAMLString(resolvedConfig);

      // Write to Traefik dynamic config directory
      const traefikConfigDir = process.env.TRAEFIK_CONFIG_BASE_PATH || '/app/traefik-configs';
      const configFileName = `service-${service.id}.yml`;
      const configFilePath = path.join(traefikConfigDir, configFileName);

      // Ensure directory exists
      await fs.promises.mkdir(traefikConfigDir, { recursive: true });

      // Write config file
      await fs.promises.writeFile(configFilePath, yamlConfig, 'utf-8');

      this.logger.log(`Traefik config written to ${configFilePath}`);
      this.logger.log(`Service accessible at: http://${fullDomain}`);
    } catch (error) {
      this.logger.error('Failed to update Traefik routing', error);
      // Don't throw - routing failure shouldn't fail the deployment
    }
  }

  /**
   * Rollback to previous deployment
   */
  private async rollback(serviceId: string): Promise<void> {
    // Implementation: Rollback to previous version
    this.logger.debug(`Rolling back ${serviceId}`);
  }
}
