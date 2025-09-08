import { Injectable, Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { DockerService } from '../../../core/services/docker.service';
import { DNSService, DNSCheckResult } from './dns.service';
import { DatabaseConfigService } from './database-config.service';
import { ConfigFileSyncService } from './config-file-sync.service';
import { TemplateService, TraefikTemplate } from './template.service';
import {
  traefikInstances,
  domainConfigs,
  routeConfigs,
  type TraefikInstance,
  type DomainConfig,
  type RouteConfig,
  type TraefikConfig,
} from '../../../core/modules/db/drizzle/schema/traefik';

export interface TraefikInstanceConfig {
  name: string;
  dashboardPort?: number;
  httpPort?: number;
  httpsPort?: number;
  acmeEmail?: string;
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  insecureApi?: boolean;
  // Template support
  template?: 'basic' | 'ssl' | 'advanced' | 'microservices' | 'custom';
  autoConfigureFor?: 'web' | 'api' | 'database' | 'cache' | 'queue' | 'custom';
}

export interface DomainConfigInput {
  domain: string;
  subdomain?: string;
  sslEnabled?: boolean;
  sslProvider?: 'letsencrypt' | 'selfsigned' | 'custom';
  // certificatePath is auto-generated - removed from input
  middleware?: Record<string, any>;
}

export interface RouteConfigInput {
  deploymentId?: string;
  routeName: string;
  serviceName: string;
  containerName?: string;
  targetPort: number;
  pathPrefix?: string;
  priority?: number;
  middleware?: string[] | Record<string, any>;
  healthCheck?: Record<string, any>;
}

export interface DeploymentRegistrationInput {
  subdomain: string;
  baseDomain: string;
  projectId: string;
  serviceId: string;
  deploymentId: string;
  port: number;
  containerId: string;
}

@Injectable()
export class TraefikService {
  private readonly logger = new Logger(TraefikService.name);
  private readonly traefikImage = 'traefik:v3.2';
  private readonly configBasePath = './traefik-configs';
  private readonly baseDomain = process.env.TRAEFIK_BASE_DOMAIN || 'localhost';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly docker: DockerService,
    private readonly dnsService: DNSService,
    private readonly databaseConfigService: DatabaseConfigService,
    private readonly configFileSyncService: ConfigFileSyncService,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Create a new Traefik instance
   */
  async createInstance(config: TraefikInstanceConfig): Promise<TraefikInstance> {
    let finalConfig = { ...config };

    // Apply template or auto-configuration if specified
    if (config.template || config.autoConfigureFor) {
      let template: TraefikTemplate;
      
      if (config.autoConfigureFor) {
        // Auto-configure based on service type
        const autoConfig = this.templateService.autoConfigureForService(config.autoConfigureFor, {
          acmeEmail: config.acmeEmail,
          logLevel: config.logLevel,
          dashboardPort: config.dashboardPort,
          httpPort: config.httpPort,
          httpsPort: config.httpsPort,
        });
        
        template = autoConfig.template;
        finalConfig = {
          ...finalConfig,
          ...autoConfig.instanceConfig,
          logLevel: (autoConfig.instanceConfig.logLevel as 'ERROR' | 'WARN' | 'INFO' | 'DEBUG') || 'INFO',
        };
        
        this.logger.log(`Auto-configured instance ${config.name} for ${config.autoConfigureFor} service type using template ${template.id}`);
      } else if (config.template) {
        // Use specified template
        template = this.templateService.getTemplate(config.template) || this.templateService.getDefaultTemplate();
        
        // Apply template defaults if not specified
        finalConfig = {
          ...finalConfig,
          dashboardPort: finalConfig.dashboardPort || template.config.ports.dashboard || 8080,
          httpPort: finalConfig.httpPort || template.config.ports.http || 80,
          httpsPort: template.config.ssl.enabled ? (finalConfig.httpsPort || template.config.ports.https || 443) : undefined,
          acmeEmail: template.config.ssl.enabled ? (finalConfig.acmeEmail || template.config.ssl.acmeEmail) : undefined,
        };
        
        this.logger.log(`Created instance ${config.name} using template ${template.id}`);
      }
    }
    
    // Create database record
    const instanceData = {
      id: crypto.randomUUID(),
      name: finalConfig.name,
      status: 'stopped',
      containerId: null,
      dashboardPort: finalConfig.dashboardPort || 8080,
      httpPort: finalConfig.httpPort || 80,
      httpsPort: finalConfig.httpsPort || 443,
      acmeEmail: finalConfig.acmeEmail || null,
      logLevel: finalConfig.logLevel || 'INFO',
      insecureApi: finalConfig.insecureApi ?? true,
      config: null, // Will be set when configuration is generated
    };

    const [instance] = await this.databaseService.db
      .insert(traefikInstances)
      .values(instanceData)
      .returning();

    this.logger.log(`Created Traefik instance ${instance.name} with ID ${instance.id}`);
    return instance;
  }

  /**
   * Start a Traefik instance
   */
  async startInstance(instanceId: string): Promise<TraefikInstance> {
    const instance = await this.getInstance(instanceId);
    
    if (instance.status === 'running') {
      this.logger.log(`Instance ${instanceId} is already running`);
      return instance;
    }

    try {
      // First update the instance status to 'running'
      await this.databaseService.db
        .update(traefikInstances)
        .set({ status: 'running' })
        .where(eq(traefikInstances.id, instanceId));

      // Generate static configuration if needed
      await this.databaseConfigService.generateStaticConfigForInstance(instanceId, {
        dashboardPort: instance.dashboardPort || 8080,
        httpPort: instance.httpPort || 80,
        httpsPort: instance.httpsPort || 443,
        acmeEmail: instance.acmeEmail || undefined,
        logLevel: instance.logLevel || 'INFO',
        insecureApi: instance.insecureApi || false,
      });

      // Only generate dynamic configurations if none exist
      // This prevents creating duplicate configurations
      const existingConfigs = await this.databaseConfigService.getConfigurationsByType(instanceId, 'dynamic');
      if (existingConfigs.length === 0) {
        await this.databaseConfigService.generateDynamicConfigFromDatabase(instanceId);
      }

      // Perform full sync with cleanup - database is source of truth
      const syncResults = await this.configFileSyncService.fullSyncWithCleanup(instanceId);

      // Log sync results
      this.logger.log(`Full sync with cleanup completed: ${syncResults.successful} synced, ${syncResults.failed} failed, ${syncResults.removedOrphans.length} orphans removed`);

      if (syncResults.failed > 0) {
        this.logger.warn(`Some configurations failed to sync, but proceeding with container start`);
      }

      // Test Docker connection before attempting to work with containers
      const dockerConnected = await this.docker.testConnection();
      if (!dockerConnected) {
        throw new Error('Cannot start Traefik instance: Docker connection failed');
      }
      
      // Find the existing Traefik container
      const traefikContainer = await this.findTraefikContainer();
      if (!traefikContainer) {
        throw new Error('Traefik container not found. Please ensure Traefik is running via docker-compose.');
      }
      
      // Update instance with container ID and final status
      const [updatedInstance] = await this.databaseService.db
        .update(traefikInstances)
        .set({ 
          containerId: traefikContainer.Id,
          status: 'running',
          config: { 
            configPath: this.configBasePath,
            configCount: syncResults.total,
            lastConfigSync: new Date().toISOString()
          }
        })
        .where(eq(traefikInstances.id, instanceId))
        .returning();

      this.logger.log(`Started Traefik instance ${instanceId} with ${syncResults.total} configurations`);
      return updatedInstance;
      
    } catch (error) {
      this.logger.error(`Failed to start instance ${instanceId}:`, error);
      
      // Update status to error
      await this.databaseService.db
        .update(traefikInstances)
        .set({ status: 'error' })
        .where(eq(traefikInstances.id, instanceId));
        
      throw error;
    }
  }

  /**
   * Stop a Traefik instance (deactivate configurations and remove files)
   */
  async stopInstance(instanceId: string): Promise<TraefikInstance> {
    const instance = await this.getInstance(instanceId);
    
    try {
      // First, update the instance status to 'stopped'
      const [updatedInstance] = await this.databaseService.db
        .update(traefikInstances)
        .set({ 
          status: 'stopped',
          config: { 
            ...instance.config,
            lastConfigUpdate: new Date().toISOString()
          }
        })
        .where(eq(traefikInstances.id, instanceId))
        .returning();

      // Now trigger sync - since instance is stopped, all config files will be removed
      const syncResults = await this.configFileSyncService.fullSyncWithCleanup(instanceId);
      
      this.logger.log(
        `Stopped Traefik instance ${instanceId}: ${syncResults.total} configurations processed, ` +
        `${syncResults.removedOrphans.length} files removed`
      );

      return updatedInstance;
      
    } catch (error) {
      this.logger.error(`Failed to stop instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Register a domain configuration
   */
  async createDomainConfig(instanceId: string, config: DomainConfigInput): Promise<DomainConfig> {
    const id = randomUUID();
    const fullDomain = config.subdomain ? `${config.subdomain}.${config.domain}` : config.domain;

    // Auto-generate certificate path based on SSL configuration
    const certificatePath = config.sslEnabled ? this.generateCertificatePath(fullDomain, config.sslProvider) : null;

    // Initial domain data with pending DNS status
    const domainData = {
      id,
      traefikInstanceId: instanceId,
      domain: config.domain,
      subdomain: config.subdomain || null,
      fullDomain,
      sslEnabled: config.sslEnabled || false,
      sslProvider: config.sslProvider || null,
      certificatePath, // Auto-generated based on SSL configuration
      middleware: config.middleware || null,
      dnsStatus: 'pending' as const,
      dnsRecords: null,
      dnsLastChecked: null,
      dnsErrorMessage: null,
      isActive: true,
    };

    const [domainConfig] = await this.databaseService.db
      .insert(domainConfigs)
      .values(domainData)
      .returning();

    this.logger.log(`Created domain config ${fullDomain} for instance ${instanceId}${certificatePath ? ` with certificate path ${certificatePath}` : ''}`);
    
    // Trigger DNS validation in background (don't await to avoid blocking)
    this.validateDomainDNS(domainConfig.id).catch(error => {
      this.logger.error(`Background DNS validation failed for ${fullDomain}:`, error);
    });

    return domainConfig;
  }

  /**
   * Register a route configuration
   */
  async createRouteConfig(domainConfigId: string, config: RouteConfigInput): Promise<RouteConfig> {
    const id = randomUUID();
    // Use provided names or generate them
    const routeName = config.routeName || `route-${config.containerName || 'service'}-${Date.now()}`;
    const serviceName = config.serviceName || `service-${config.containerName || 'service'}-${Date.now()}`;

    const routeData = {
      id,
      domainConfigId,
      deploymentId: config.deploymentId || null,
      routeName,
      serviceName,
      containerName: config.containerName || null,
      targetPort: config.targetPort,
      pathPrefix: config.pathPrefix || null,
      priority: config.priority || 1,
      middleware: Array.isArray(config.middleware) ? { middlewares: config.middleware } : config.middleware || null,
      healthCheck: config.healthCheck || null,
      isActive: true,
    };

    const [routeConfig] = await this.databaseService.db
      .insert(routeConfigs)
      .values(routeData)
      .returning();

    this.logger.log(`Created route config ${routeName} for domain ${domainConfigId}`);
    return routeConfig;
  }

  /**
   * Register a complete deployment (domain + route)
   */
  async registerDeployment(
    traefikInstanceId: string,
    deploymentId: string,
    subdomain: string,
    containerName: string,
    targetPort: number,
    baseDomain?: string
  ): Promise<{ domainConfig: DomainConfig; routeConfig: RouteConfig; url: string }> {
    const domain = baseDomain || this.baseDomain;
    
    // Create domain config
    const domainConfig = await this.createDomainConfig(traefikInstanceId, {
      domain,
      subdomain,
      sslEnabled: false, // Default to false, can be enabled later
    });

    // Create route config
    const routeConfig = await this.createRouteConfig(domainConfig.id, {
      routeName: `route-${containerName}-${Date.now()}`,
      serviceName: `service-${containerName}-${Date.now()}`,
      containerName,
      targetPort,
      deploymentId,
    });

    const url = `http://${domainConfig.fullDomain}`;

    // Update dynamic configuration
    await this.updateDynamicConfig(traefikInstanceId);

    this.logger.log(`Registered deployment ${deploymentId} at ${url}`);
    
    return { domainConfig, routeConfig, url };
  }

  /**
   * Update dynamic configuration for a Traefik instance
   */
  async updateDynamicConfig(instanceId: string): Promise<void> {
    try {
      // Regenerate all dynamic configurations from database state
      const result = await this.databaseConfigService.regenerateInstanceConfigurations(instanceId);
      
      // Perform full sync with cleanup - database is source of truth
      const syncResults = await this.configFileSyncService.fullSyncWithCleanup(instanceId);

      if (syncResults.failed > 0) {
        this.logger.warn(`Some configuration files failed to sync: ${syncResults.failed} failed, ${syncResults.successful} successful`);
      }

      if (syncResults.removedOrphans.length > 0) {
        this.logger.log(`Cleaned up ${syncResults.removedOrphans.length} orphaned configuration files`);
      }

      // Update instance timestamp to indicate configuration change
      await this.databaseService.db
        .update(traefikInstances)
        .set({ 
          updatedAt: new Date(),
          config: {
            ...(typeof this.getInstance(instanceId).then(i => i.config) === 'object' ? await this.getInstance(instanceId).then(i => i.config) : {}),
            lastConfigUpdate: new Date().toISOString(),
            configCount: result.generated,
            syncStatus: syncResults.failed === 0 ? 'synced' : 'partial'
          }
        })
        .where(eq(traefikInstances.id, instanceId));

      this.logger.log(
        `Updated dynamic config for instance ${instanceId}: ` +
        `${result.deactivated} deactivated, ${result.generated} generated, ${syncResults.successful} synced`
      );
    } catch (error) {
      this.logger.error(`Failed to update dynamic config for instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific instance
   */
  async getInstance(instanceId: string): Promise<TraefikInstance> {
    const [instance] = await this.databaseService.db
      .select()
      .from(traefikInstances)
      .where(eq(traefikInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      throw new Error(`Traefik instance ${instanceId} not found`);
    }

    return instance;
  }

  /**
   * List all instances
   */
  async listInstances(): Promise<TraefikInstance[]> {
    return await this.databaseService.db.select().from(traefikInstances);
  }

  /**
   * List domain configurations for an instance
   */
  async listDomainConfigs(instanceId: string): Promise<DomainConfig[]> {
    return await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(eq(domainConfigs.traefikInstanceId, instanceId));
  }

  /**
   * List route configurations for a domain
   */
  async listRouteConfigs(domainConfigId: string): Promise<RouteConfig[]> {
    return await this.databaseService.db
      .select()
      .from(routeConfigs)
      .where(eq(routeConfigs.domainConfigId, domainConfigId));
  }

  /**
   * Delete a route configuration
   */
  async deleteRouteConfig(routeConfigId: string): Promise<void> {
    await this.databaseService.db
      .delete(routeConfigs)
      .where(eq(routeConfigs.id, routeConfigId));

    this.logger.log(`Deleted route config ${routeConfigId}`);
  }

  /**
   * Register a deployment (combining domain + route creation)
   */
  async registerDeploymentAdvanced(instanceId: string, registrationData: {
    deploymentId: string;
    serviceName: string;
    containerName: string;
    targetPort: number;
    domain: string;
    subdomain?: string;
    pathPrefix?: string;
    sslEnabled?: boolean;
    middleware?: string[];
  }): Promise<{
    domainConfigId: string;
    routeConfigId: string;
    fullDomain: string;
    deploymentUrl: string;
    message: string;
  }> {
    const { deploymentId, serviceName, containerName, targetPort, domain, subdomain, pathPrefix, sslEnabled, middleware } = registrationData;

    // Create or find domain config
    let domainConfig = await this.findDomainConfig(domain, subdomain);
    if (!domainConfig) {
      domainConfig = await this.createDomainConfig(instanceId, {
        domain,
        subdomain,
        sslEnabled: sslEnabled || false,
        middleware: middleware ? middleware.reduce((acc, mid) => ({ ...acc, [mid]: {} }), {}) : undefined,
      });
    }

    // Create route config
    const routeConfig = await this.createRouteConfig(domainConfig.id, {
      routeName: `route-${serviceName}-${Date.now()}`,
      serviceName: `service-${serviceName}-${Date.now()}`,
      containerName,
      targetPort,
      pathPrefix: pathPrefix || '/',
      deploymentId,
      middleware: middleware ? middleware.reduce((acc, mid) => ({ ...acc, [mid]: {} }), {}) : undefined,
    });

    const protocol = sslEnabled ? 'https' : 'http';
    const deploymentUrl = `${protocol}://${domainConfig.fullDomain}${pathPrefix || ''}`;

    // Update dynamic configuration
    await this.updateDynamicConfig(instanceId);

    return {
      domainConfigId: domainConfig.id,
      routeConfigId: routeConfig.id,
      fullDomain: domainConfig.fullDomain,
      deploymentUrl,
      message: `Successfully registered deployment ${deploymentId}`,
    };
  }

  /**
   * Find domain config
   */
  async findDomainConfig(domain: string, subdomain?: string): Promise<DomainConfig | null> {
    const conditions = [eq(domainConfigs.domain, domain)];
    
    if (subdomain) {
      conditions.push(eq(domainConfigs.subdomain, subdomain));
    } else {
      conditions.push(isNull(domainConfigs.subdomain));
    }

    const [config] = await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(and(...conditions))
      .limit(1);

    return config || null;
  }

  /**
   * Health check for a Traefik instance
   */
  async healthCheck(instanceId: string): Promise<boolean> {
    const instance = await this.getInstance(instanceId);
    
    if (!instance.containerId) {
      return false;
    }

    try {
      const containerInfo = await this.docker.getContainerInfo(instance.containerId);
      return containerInfo.State.Status === 'running';
    } catch (error) {
      this.logger.error(`Health check failed for instance ${instanceId}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Delete domain configuration
   */
  async deleteDomainConfig(domainConfigId: string): Promise<void> {
    await this.databaseService.db
      .delete(domainConfigs)
      .where(eq(domainConfigs.id, domainConfigId));

    this.logger.log(`Deleted domain config ${domainConfigId}`);
  }

  /**
   * Find the existing Traefik container from docker-compose
   */
  private async findTraefikContainer(): Promise<any> {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          name: ['traefik-dev', 'traefik']
        }
      });
      
      // Look for a running Traefik container
      const traefikContainer = containers.find(container => 
        container.Names.some(name => name.includes('traefik')) &&
        container.State === 'running'
      );
      
      if (traefikContainer) {
        this.logger.log(`Found running Traefik container: ${traefikContainer.Names[0]}`);
        return traefikContainer;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Failed to find Traefik container:', error);
      return null;
    }
  }

  /**
   * Generate subdomain based on deployment details
   */
  generateSubdomain(projectName: string, serviceName: string, environment: string, branch?: string, pr?: number, customName?: string): string {
    if (customName) {
      return customName;
    }

    let subdomain = `${projectName}-${serviceName}`;
    
    if (environment === 'preview' && pr) {
      subdomain += `-pr-${pr}`;
    } else if (environment === 'preview' && branch) {
      subdomain += `-${branch}`;
    } else if (environment !== 'production') {
      subdomain += `-${environment}`;
    }

    // Sanitize subdomain (remove invalid characters)
    return subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  }

  /**
   * Get base domain
   */
  getBaseDomain(): string {
    return this.baseDomain;
  }

  /**
   * Generate Traefik configuration file
   */
  private async generateTraefikConfig(instance: TraefikInstance): Promise<string> {
    const configDir = path.join(this.configBasePath, instance.id);
    const configFile = path.join(configDir, 'traefik.yml');

    // Ensure directory exists
    await fs.mkdir(configDir, { recursive: true });

    const config = {
      global: {
        sendAnonymousUsage: false,
      },
      api: {
        dashboard: true,
        insecure: instance.insecureApi || false,
      },
      entryPoints: {
        web: {
          address: `:${instance.httpPort}`,
        },
        websecure: {
          address: `:${instance.httpsPort}`,
        },
        dashboard: {
          address: `:${instance.dashboardPort}`,
        },
      },
      providers: {
        docker: {
          endpoint: 'unix:///var/run/docker.sock',
          exposedByDefault: false,
        },
        file: {
          directory: '/etc/traefik/dynamic',
          watch: true,
        },
      },
      log: {
        level: instance.logLevel,
      },
    };

    // Write configuration file
    await fs.writeFile(configFile, yaml.dump(config));
    
    return configFile;
  }

  /**
   * Create Traefik container
   */
  private async createTraefikContainer(instance: TraefikInstance, configPath: string): Promise<any> {
    const containerConfig = {
      Image: this.traefikImage,
      name: `traefik-${instance.name}`,
      ExposedPorts: {
        [`${instance.httpPort}/tcp`]: {},
        [`${instance.httpsPort}/tcp`]: {},
        [`${instance.dashboardPort}/tcp`]: {},
      },
      HostConfig: {
        PortBindings: {
          [`${instance.httpPort}/tcp`]: [{ HostPort: instance.httpPort?.toString() }],
          [`${instance.httpsPort}/tcp`]: [{ HostPort: instance.httpsPort?.toString() }],
          [`${instance.dashboardPort}/tcp`]: [{ HostPort: instance.dashboardPort?.toString() }],
        },
        Binds: [
          '/var/run/docker.sock:/var/run/docker.sock',
          `${path.dirname(configPath)}:/etc/traefik:ro`,
        ],
        RestartPolicy: {
          Name: 'unless-stopped',
        },
      },
      Labels: {
        'traefik.enable': 'false', // Don't proxy Traefik itself
      },
    };

    return await this.docker.createContainer(containerConfig);
  }

  /**
   * Generate dynamic configuration for routes
   */
  private async generateDynamicConfig(instanceId: string): Promise<void> {
    const domains = await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(eq(domainConfigs.traefikInstanceId, instanceId));

    for (const domain of domains) {
      const routes = await this.databaseService.db
        .select()
        .from(routeConfigs)
        .where(eq(routeConfigs.domainConfigId, domain.id));

      if (routes.length > 0) {
        const dynamicConfig = {
          http: {
            routers: {},
            services: {},
          },
        };

        for (const route of routes) {
          // Router configuration
          (dynamicConfig.http.routers as any)[route.routeName] = {
            rule: `Host(\`${domain.fullDomain}\`)`,
            service: route.serviceName,
            priority: route.priority,
          };

          // Service configuration
          (dynamicConfig.http.services as any)[route.serviceName] = {
            loadBalancer: {
              servers: [
                {
                  url: `http://${route.containerName}:${route.targetPort}`,
                },
              ],
            },
          };
        }

        // Write dynamic config file
        const configDir = path.join(this.configBasePath, instanceId, 'dynamic');
        const configFile = path.join(configDir, `${domain.id}.yml`);

        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(configFile, yaml.dump(dynamicConfig));
      }
    }
  }

  /**
   * Unregister a deployment from Traefik routing
   */
  async unregisterDeployment(deploymentId: string): Promise<void> {
    this.logger.log(`Unregistering deployment ${deploymentId} from Traefik`);
    
    try {
      // Deactivate all routes for this deployment
      await this.databaseService.db
        .update(routeConfigs)
        .set({ 
          isActive: false,
          updatedAt: new Date()
        })
        .where(eq(routeConfigs.deploymentId, deploymentId));
      
      this.logger.log(`Successfully unregistered deployment ${deploymentId}`);
    } catch (error) {
      this.logger.error(`Failed to unregister deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Check DNS records for a domain
   */
  async checkDNS(domain: string, recordType: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' = 'A'): Promise<DNSCheckResult> {
    return await this.dnsService.checkDNS(domain, recordType);
  }

  /**
   * Validate DNS records for a specific domain configuration
   */
  async validateDomainDNS(domainConfigId: string): Promise<DomainConfig> {
    const [domainConfig] = await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(eq(domainConfigs.id, domainConfigId))
      .limit(1);

    if (!domainConfig) {
      throw new Error(`Domain configuration not found: ${domainConfigId}`);
    }

    this.logger.log(`Validating DNS for domain: ${domainConfig.fullDomain}`);

    try {
      // Check A records for the full domain
      const dnsResult = await this.dnsService.checkDNS(domainConfig.fullDomain, 'A');
      
      // Update domain config with DNS validation results
      const [updatedDomainConfig] = await this.databaseService.db
        .update(domainConfigs)
        .set({
          dnsStatus: dnsResult.status,
          dnsRecords: dnsResult.records,
          dnsLastChecked: dnsResult.checkedAt,
          dnsErrorMessage: dnsResult.errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(domainConfigs.id, domainConfigId))
        .returning();

      this.logger.log(`DNS validation completed for ${domainConfig.fullDomain}: ${dnsResult.status}`);
      return updatedDomainConfig;

    } catch (error) {
      this.logger.error(`DNS validation failed for ${domainConfig.fullDomain}:`, error);
      
      // Update domain config with error status
      const [updatedDomainConfig] = await this.databaseService.db
        .update(domainConfigs)
        .set({
          dnsStatus: 'error',
          dnsErrorMessage: error instanceof Error ? error.message : 'Unknown DNS validation error',
          dnsLastChecked: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(domainConfigs.id, domainConfigId))
        .returning();

      return updatedDomainConfig;
    }
  }

  /**
   * Bulk validate DNS for all domain configurations
   */
  async validateAllDomainDNS(instanceId?: string): Promise<DomainConfig[]> {
    const domains = await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(instanceId ? eq(domainConfigs.traefikInstanceId, instanceId) : undefined);

    const results: DomainConfig[] = [];

    for (const domain of domains) {
      try {
        const result = await this.validateDomainDNS(domain.id);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to validate DNS for domain ${domain.fullDomain}:`, error);
        results.push(domain); // Return original domain if validation fails
      }
    }

    return results;
  }

  /**
   * Get all configurations for an instance
   */
  async getInstanceConfigurations(instanceId: string): Promise<TraefikConfig[]> {
    return await this.databaseConfigService.getInstanceConfigurations(instanceId);
  }

  /**
   * Get configuration sync status for an instance
   */
  async getConfigurationSyncStatus(instanceId: string): Promise<{
    total: number;
    synced: number;
    pending: number;
    failed: number;
    outdated: number;
    configurations: Array<{
      id: string;
      name: string;
      type: string;
      syncStatus: string;
      lastSyncedAt?: Date;
      errorMessage?: string;
    }>;
  }> {
    const configs = await this.getInstanceConfigurations(instanceId);
    
    let synced = 0;
    let pending = 0;
    let failed = 0;
    let outdated = 0;

    const configurationDetails = configs.map(config => {
      switch (config.syncStatus) {
        case 'synced':
          synced++;
          break;
        case 'pending':
          pending++;
          break;
        case 'failed':
          failed++;
          break;
        case 'outdated':
          outdated++;
          break;
      }

      return {
        id: config.id,
        name: config.configName,
        type: config.configType,
        syncStatus: config.syncStatus || 'unknown',
        lastSyncedAt: config.lastSyncedAt || undefined,
        errorMessage: config.syncErrorMessage || undefined
      };
    });

    return {
      total: configs.length,
      synced,
      pending,
      failed,
      outdated,
      configurations: configurationDetails
    };
  }

  /**
   * Force sync all configurations for an instance
   * Uses fullSyncWithCleanup to ensure database is source of truth
   */
  async forceSyncInstanceConfigurations(instanceId: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    removedOrphans: string[];
    results: Array<{
      configId: string;
      configName: string;
      success: boolean;
      action: string;
      message?: string;
    }>;
  }> {
    // Use fullSyncWithCleanup to ensure database is source of truth
    const syncResults = await this.configFileSyncService.fullSyncWithCleanup(instanceId);
    
    // Get config details for detailed results
    const configs = await this.getInstanceConfigurations(instanceId);
    const configMap = new Map(configs.map(c => [c.configPath, c]));
    
    const results = syncResults.syncResults.map(result => {
      const relativePath = result.filePath ? path.relative(this.configFileSyncService['basePath'] || '', result.filePath) : '';
      const config = configMap.get(relativePath);
      
      return {
        configId: config?.id || 'unknown',
        configName: config?.configName || path.basename(result.filePath || 'unknown', '.yml'),
        success: result.success,
        action: result.action,
        message: result.message
      };
    });

    return {
      total: syncResults.total,
      successful: syncResults.successful,
      failed: syncResults.failed,
      removedOrphans: syncResults.removedOrphans,
      results
    };
  }

  /**
   * Clean up orphaned configuration files for an instance
   */
  async cleanupOrphanedConfigFiles(instanceId: string): Promise<string[]> {
    return await this.configFileSyncService.cleanupOrphanedFiles(instanceId);
  }

  /**
   * Validate all configuration files for an instance
   */
  async validateInstanceConfigFiles(instanceId: string): Promise<{
    valid: number;
    invalid: number;
    configurations: Array<{
      configId: string;
      configName: string;
      isValid: boolean;
      issues: string[];
    }>;
  }> {
    const configs = await this.getInstanceConfigurations(instanceId);
    const configurations: Array<{
      configId: string;
      configName: string;
      isValid: boolean;
      issues: string[];
    }> = [];

    let valid = 0;
    let invalid = 0;

    for (const config of configs) {
      const validation = await this.configFileSyncService.validateSyncStatus(config.id);
      
      configurations.push({
        configId: config.id,
        configName: config.configName,
        isValid: validation.isValid,
        issues: validation.issues
      });

      if (validation.isValid) {
        valid++;
      } else {
        invalid++;
      }
    }

    return {
      valid,
      invalid,
      configurations
    };
  }

  /**
   * Get real-time configuration status for dashboard
   */
  async getInstanceConfigurationStatus(instanceId: string): Promise<{
    instance: TraefikInstance;
    configurations: {
      total: number;
      static: number;
      dynamic: number;
      synced: number;
      pending: number;
      failed: number;
    };
    files: {
      total: number;
      exists: number;
      writable: number;
      orphaned: number;
    };
    lastUpdate: Date;
  }> {
    const instance = await this.getInstance(instanceId);
    const configs = await this.getInstanceConfigurations(instanceId);
    
    const staticCount = configs.filter(c => c.configType === 'static').length;
    const dynamicCount = configs.filter(c => c.configType === 'dynamic').length;
    const syncedCount = configs.filter(c => c.syncStatus === 'synced').length;
    const pendingCount = configs.filter(c => c.syncStatus === 'pending').length;
    const failedCount = configs.filter(c => c.syncStatus === 'failed').length;

    // Get file information (simplified for now)
    const fileStats = {
      total: configs.filter(c => c.requiresFile).length,
      exists: syncedCount, // Approximation
      writable: syncedCount, // Approximation
      orphaned: 0 // Would need separate query
    };

    return {
      instance,
      configurations: {
        total: configs.length,
        static: staticCount,
        dynamic: dynamicCount,
        synced: syncedCount,
        pending: pendingCount,
        failed: failedCount
      },
      files: fileStats,
      lastUpdate: instance.updatedAt
    };
  }

  // ================================
  // Template Management Methods
  // ================================

  /**
   * Get all available Traefik templates
   */
  async getTemplates(category?: 'basic' | 'ssl' | 'advanced' | 'microservices'): Promise<TraefikTemplate[]> {
    return this.templateService.getTemplates(category);
  }

  /**
   * Get a specific template by ID
   */
  async getTemplate(templateId: string): Promise<TraefikTemplate | null> {
    return this.templateService.getTemplate(templateId);
  }

  /**
   * Create instance from template
   */
  async createInstanceFromTemplate(templateId: string, instanceName: string, customConfig?: {
    dashboardPort?: number;
    httpPort?: number;
    httpsPort?: number;
    acmeEmail?: string;
    logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  }): Promise<TraefikInstance> {
    const template = this.templateService.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Create configuration based on template
    const config: TraefikInstanceConfig = {
      name: instanceName,
      dashboardPort: customConfig?.dashboardPort || template.config.ports.dashboard || 8080,
      httpPort: customConfig?.httpPort || template.config.ports.http || 80,
      httpsPort: template.config.ssl.enabled ? (customConfig?.httpsPort || template.config.ports.https || 443) : undefined,
      acmeEmail: template.config.ssl.enabled ? (customConfig?.acmeEmail || template.config.ssl.acmeEmail) : undefined,
      logLevel: customConfig?.logLevel || 'INFO',
      insecureApi: true,
      template: templateId as 'basic' | 'ssl' | 'advanced' | 'microservices' | 'custom',
    };

    return this.createInstance(config);
  }

  /**
   * Auto-generate certificate path for domain
   */
  private generateCertificatePath(domain: string, sslProvider?: string): string | null {
    if (!sslProvider || sslProvider === 'letsencrypt') {
      // Let's Encrypt certificates are managed automatically by Traefik
      return null;
    }
    
    if (sslProvider === 'custom') {
      // Generate a standard path for custom certificates
      return `/etc/traefik/certs/${domain}.crt`;
    }
    
    if (sslProvider === 'selfsigned') {
      // Generate a standard path for self-signed certificates
      return `/etc/traefik/certs/selfsigned/${domain}.crt`;
    }
    
    return null;
  }
}