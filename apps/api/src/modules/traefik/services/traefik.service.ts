import { Injectable, Logger } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { DockerService } from '../../../core/services/docker.service';
import { DNSService, DNSCheckResult } from './dns.service';
import {
  traefikInstances,
  domainConfigs,
  routeConfigs,
  // traefikConfigs,
  type TraefikInstance,
  // type CreateTraefikInstance,
  type DomainConfig,
  // type CreateDomainConfig,
  type RouteConfig,
  // type CreateRouteConfig,
  // type TraefikConfig,
  // type CreateTraefikConfig
} from '../../../core/modules/db/drizzle/schema/traefik';

export interface TraefikInstanceConfig {
  name: string;
  dashboardPort?: number;
  httpPort?: number;
  httpsPort?: number;
  acmeEmail?: string;
  logLevel?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
  insecureApi?: boolean;
}

export interface DomainConfigInput {
  domain: string;
  subdomain?: string;
  sslEnabled?: boolean;
  sslProvider?: 'letsencrypt' | 'selfsigned' | 'custom';
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
  private readonly configBasePath = '/tmp/traefik-configs';
  private readonly baseDomain = process.env.TRAEFIK_BASE_DOMAIN || 'localhost';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly docker: DockerService,
    private readonly dnsService: DNSService,
  ) {}

  /**
   * Create a new Traefik instance
   */
  async createInstance(config: TraefikInstanceConfig): Promise<TraefikInstance> {
    // const id = randomUUID();
    
    // Create database record
    const instanceData = {
      id: crypto.randomUUID(),
      name: config.name,
      status: 'stopped',
      containerId: null,
      dashboardPort: config.dashboardPort || 8080,
      httpPort: config.httpPort || 80,
      httpsPort: config.httpsPort || 443,
      acmeEmail: config.acmeEmail || null,
      logLevel: config.logLevel || 'INFO',
      insecureApi: config.insecureApi ?? true,
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
      // Generate configuration
      const configPath = await this.generateTraefikConfig(instance);
      
      // Create and start container
      const container = await this.createTraefikContainer(instance, configPath);
      
      // Update instance with container ID and status
      const [updatedInstance] = await this.databaseService.db
        .update(traefikInstances)
        .set({ 
          containerId: container.id,
          status: 'running',
          config: { configPath }
        })
        .where(eq(traefikInstances.id, instanceId))
        .returning();

      this.logger.log(`Started Traefik instance ${instanceId}`);
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
   * Stop a Traefik instance
   */
  async stopInstance(instanceId: string): Promise<TraefikInstance> {
    const instance = await this.getInstance(instanceId);
    
    if (!instance.containerId) {
      this.logger.log(`Instance ${instanceId} has no container to stop`);
      return instance;
    }

    try {
      await this.docker.stopContainer(instance.containerId);
      
      const [updatedInstance] = await this.databaseService.db
        .update(traefikInstances)
        .set({ 
          status: 'stopped',
          containerId: null 
        })
        .where(eq(traefikInstances.id, instanceId))
        .returning();

      this.logger.log(`Stopped Traefik instance ${instanceId}`);
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

    // Initial domain data with pending DNS status
    const domainData = {
      id,
      traefikInstanceId: instanceId,
      domain: config.domain,
      subdomain: config.subdomain || null,
      fullDomain,
      sslEnabled: config.sslEnabled || false,
      sslProvider: config.sslProvider || null,
      certificatePath: null, // Will be set when SSL is configured
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

    this.logger.log(`Created domain config ${fullDomain} for instance ${instanceId}`);
    
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
    const routes = await this.databaseService.db
      .select()
      .from(routeConfigs)
      .innerJoin(domainConfigs, eq(routeConfigs.domainConfigId, domainConfigs.id))
      .where(eq(domainConfigs.traefikInstanceId, instanceId));

    if (routes.length > 0) {
      await this.databaseService.db
        .update(traefikInstances)
        .set({ updatedAt: new Date() })
        .where(eq(traefikInstances.id, instanceId));
    }

    this.logger.log(`Updated dynamic config for instance ${instanceId} with ${routes.length} routes`);
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
    const conditions = instanceId ? [eq(domainConfigs.traefikInstanceId, instanceId)] : [];
    
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
}