import { Injectable, Logger } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import {
  traefikConfigs,
  domainConfigs,
  routeConfigs,
  type TraefikConfig,
  type CreateTraefikConfig
} from '../../../core/modules/db/drizzle/schema/traefik';

// Forward declaration to avoid circular dependency
interface IConfigFileSyncService {
  checkForDuplicateBeforeCreate(
    instanceId: string,
    configPath: string,
    configContent: string,
    configName: string
  ): Promise<{
    shouldCreate: boolean;
    existingId?: string;
    message: string;
  }>;
  updateConfigurationContent(
    configId: string,
    newContent: string,
    configName: string
  ): Promise<void>;
}

export interface TraefikStaticConfig {
  // Global configuration
  global?: {
    sendAnonymousUsage?: boolean;
  };

  // API and Dashboard
  api?: {
    dashboard?: boolean;
    insecure?: boolean;
    debug?: boolean;
  };

  // Entry Points
  entryPoints?: {
    [key: string]: {
      address: string;
      http?: {
        redirections?: {
          entryPoint?: {
            to: string;
            scheme?: string;
            permanent?: boolean;
            priority?: number;
          };
        };
        middlewares?: string[];
        tls?: {
          options?: string;
          certResolver?: string;
          domains?: Array<{
            main: string;
            sans?: string[];
          }>;
        };
      };
      proxyProtocol?: {
        version?: number;
        insecure?: boolean;
        trustedIPs?: string[];
      };
      forwardedHeaders?: {
        trustedIPs?: string[];
        insecure?: boolean;
      };
      transport?: {
        lifeCycle?: {
          requestAcceptGraceTimeout?: string;
          graceTimeOut?: string;
        };
        respondingTimeouts?: {
          readTimeout?: string;
          writeTimeout?: string;
          idleTimeout?: string;
        };
      };
    };
  };

  // Providers
  providers?: {
    docker?: {
      endpoint?: string;
      exposedByDefault?: boolean;
      network?: string;
      defaultRule?: string;
      constraints?: string;
      watch?: boolean;
      pollInterval?: string;
      swarmMode?: boolean;
      swarmModeRefreshSeconds?: string;
      httpClientTimeout?: string;
      tls?: {
        cert?: string;
        key?: string;
        ca?: string;
        caOptional?: boolean;
        insecureSkipVerify?: boolean;
      };
    };
    file?: {
      directory?: string;
      watch?: boolean;
      filename?: string;
      debugLogGeneratedTemplate?: boolean;
    };
    consulCatalog?: {
      endpoints?: string[];
      rootKey?: string;
      username?: string;
      password?: string;
      watch?: boolean;
      prefix?: string;
      exposedByDefault?: boolean;
      defaultRule?: string;
      constraints?: string;
      stale?: boolean;
      pollInterval?: string;
    };
    kubernetes?: {
      endpoint?: string;
      token?: string;
      certAuthFilePath?: string;
      namespaces?: string[];
      labelSelector?: string;
      ingressClass?: string;
      throttleDuration?: string;
      allowCrossNamespace?: boolean;
      allowExternalNameServices?: boolean;
    };
  };

  // Logging
  log?: {
    level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
    format?: 'json' | 'common';
    filePath?: string;
    bufferingSize?: number;
    compress?: boolean;
    maxSize?: number;
    maxAge?: number;
    maxBackups?: number;
    localTime?: boolean;
  };

  // Access Logs
  accessLog?: {
    filePath?: string;
    format?: 'json' | 'common';
    bufferingSize?: number;
    compress?: boolean;
    maxSize?: number;
    maxAge?: number;
    maxBackups?: number;
    localTime?: boolean;
    filters?: {
      statusCodes?: string[];
      retryAttempts?: boolean;
      minDuration?: string;
    };
    fields?: {
      defaultMode?: 'keep' | 'drop';
      names?: Record<string, 'keep' | 'drop'>;
      headers?: {
        defaultMode?: 'keep' | 'drop';
        names?: Record<string, 'keep' | 'drop'>;
      };
    };
  };

  // Metrics
  metrics?: {
    prometheus?: {
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
      buckets?: number[];
      entryPoint?: string;
      manualRouting?: boolean;
      headerLabels?: Record<string, string>;
    };
    datadog?: {
      address?: string;
      pushInterval?: string;
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
      prefix?: string;
    };
    statsD?: {
      address?: string;
      pushInterval?: string;
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
      prefix?: string;
    };
    influxDB?: {
      address?: string;
      protocol?: string;
      pushInterval?: string;
      database?: string;
      retentionPolicy?: string;
      username?: string;
      password?: string;
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
    };
    influxDB2?: {
      address?: string;
      token?: string;
      pushInterval?: string;
      org?: string;
      bucket?: string;
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
    };
    otlp?: {
      http?: {
        endpoint?: string;
        headers?: Record<string, string>;
        tls?: {
          cert?: string;
          key?: string;
          ca?: string;
          insecureSkipVerify?: boolean;
        };
      };
      grpc?: {
        endpoint?: string;
        headers?: Record<string, string>;
        tls?: {
          cert?: string;
          key?: string;
          ca?: string;
          insecureSkipVerify?: boolean;
        };
      };
      pushInterval?: string;
      addEntryPointsLabels?: boolean;
      addServicesLabels?: boolean;
    };
  };

  // Tracing
  tracing?: {
    serviceName?: string;
    spanNameLimit?: number;
    jaeger?: {
      samplingServerURL?: string;
      samplingType?: string;
      samplingParam?: number;
      localAgentHostPort?: string;
      gen128Bit?: boolean;
      propagation?: string;
      traceContextHeaderName?: string;
      disableAttemptReconnecting?: boolean;
      collector?: {
        endpoint?: string;
        user?: string;
        password?: string;
      };
    };
    zipkin?: {
      httpEndpoint?: string;
      sameSpan?: boolean;
      id128Bit?: boolean;
      sampleRate?: number;
    };
    datadog?: {
      localAgentHostPort?: string;
      debug?: boolean;
      globalTag?: string;
      prioritySampling?: boolean;
    };
    instana?: {
      localAgentHost?: string;
      localAgentPort?: number;
      logLevel?: string;
    };
    haystack?: {
      localAgentHost?: string;
      localAgentPort?: number;
      globalTag?: string;
      traceIDHeaderName?: string;
      parentIDHeaderName?: string;
      spanIDHeaderName?: string;
      baggagePrefixHeaderName?: string;
    };
    elastic?: {
      serverURL?: string;
      secretToken?: string;
      serviceEnvironment?: string;
    };
    otlp?: {
      http?: {
        endpoint?: string;
        headers?: Record<string, string>;
        tls?: {
          cert?: string;
          key?: string;
          ca?: string;
          insecureSkipVerify?: boolean;
        };
      };
      grpc?: {
        endpoint?: string;
        headers?: Record<string, string>;
        tls?: {
          cert?: string;
          key?: string;
          ca?: string;
          insecureSkipVerify?: boolean;
        };
      };
    };
  };

  // TLS
  tls?: {
    stores?: {
      [key: string]: {
        defaultCertificate?: {
          certFile?: string;
          keyFile?: string;
        };
      };
    };
    options?: {
      [key: string]: {
        minVersion?: string;
        maxVersion?: string;
        cipherSuites?: string[];
        curvePreferences?: string[];
        clientAuth?: {
          caFiles?: string[];
          clientAuthType?: string;
        };
        sniStrict?: boolean;
        alpnProtocols?: string[];
      };
    };
  };

  // Certificate Resolvers
  certificatesResolvers?: {
    [key: string]: {
      acme?: {
        tlsChallenge?: Record<string, unknown>;
        httpChallenge?: {
          entryPoint?: string;
        };
        dnsChallenge?: {
          provider?: string;
          delayBeforeCheck?: string;
          resolvers?: string[];
          disablePropagationCheck?: boolean;
        };
        email?: string;
        storage?: string;
        keyType?: 'EC256' | 'EC384' | 'RSA2048' | 'RSA4096' | 'RSA8192';
        caServer?: string;
        preferredChain?: string;
        certificatesDuration?: number;
        eab?: {
          kid?: string;
          hmacEncoded?: string;
        };
      };
    };
  };

  // Experimental features and plugins
  experimental?: {
    plugins?: {
      [pluginName: string]: {
        moduleName?: string;
        version?: string;
        settings?: Record<string, unknown>;
      };
    };
    localPlugins?: {
      [pluginName: string]: {
        moduleName?: string;
        settings?: Record<string, unknown>;
      };
    };
    http3?: boolean;
    kubernetesGateway?: boolean;
  };

  // Pilot (deprecated but might be used)
  pilot?: {
    token?: string;
    dashboard?: boolean;
  };

  // Server Transport
  serversTransport?: {
    insecureSkipVerify?: boolean;
    rootCAs?: string[];
    maxIdleConnsPerHost?: number;
    forwardingTimeouts?: {
      dialTimeout?: string;
      responseHeaderTimeout?: string;
      idleConnTimeout?: string;
    };
  };

  // Cluster configuration
  cluster?: {
    store?: string;
    prefix?: string;
  };

  // Host resolver
  hostResolver?: {
    cnameFlattening?: boolean;
    resolvConfig?: string;
    resolvDepth?: number;
  };
}

export interface TraefikDynamicConfig {
  http?: {
    routers?: {
      [key: string]: {
        rule: string;
        service: string;
        priority?: number;
        entryPoints?: string[];
        tls?: {
          certResolver?: string;
        };
        middlewares?: string[];
      };
    };
    services?: {
      [key: string]: {
        loadBalancer: {
          servers: Array<{
            url: string;
          }>;
        };
      };
    };
    middlewares?: {
      [key: string]: {
        addPrefix?: { prefix: string };
        stripPrefix?: { prefixes: string[] };
        replacePath?: { path: string };
        redirectRegex?: { regex: string; replacement: string };
        rateLimit?: { burst?: number; average?: number };
        headers?: {
          customRequestHeaders?: Record<string, string>;
          customResponseHeaders?: Record<string, string>;
        };
        basicAuth?: { users: string[] };
        compress?: Record<string, unknown>;
        [key: string]: unknown;
      };
    };
  };
}

@Injectable()
export class DatabaseConfigService {
  private readonly logger = new Logger(DatabaseConfigService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Store static configuration in database with deduplication
   */
  async storeStaticConfiguration(
    instanceId: string,
    config: TraefikStaticConfig,
    configName: string = 'traefik-static',
    configFileSyncService?: IConfigFileSyncService
  ): Promise<TraefikConfig> {
    const configContent = yaml.dump(config);
    const expectedPath = `${instanceId}/static/${configName}.yml`;

    // Check for duplicates if sync service is available
    if (configFileSyncService) {
      const duplicateCheck = await configFileSyncService.checkForDuplicateBeforeCreate(
        instanceId,
        expectedPath,
        configContent,
        configName
      );

      if (!duplicateCheck.shouldCreate && duplicateCheck.existingId) {
        this.logger.log(`Using existing static configuration ${duplicateCheck.existingId}: ${duplicateCheck.message}`);
        
        // Return the existing configuration
        const [existing] = await this.databaseService.db
          .select()
          .from(traefikConfigs)
          .where(eq(traefikConfigs.id, duplicateCheck.existingId))
          .limit(1);

        if (existing) {
          // Update content if it's different (path conflict case)
          if (existing.configContent !== configContent) {
            await configFileSyncService.updateConfigurationContent(
              duplicateCheck.existingId,
              configContent,
              configName
            );
            this.logger.log(`Updated existing static configuration ${duplicateCheck.existingId} with new content`);
          }
          return existing;
        }
      }
    }
    
    const configData: CreateTraefikConfig = {
      id: randomUUID(),
      traefikInstanceId: instanceId,
      configName,
      configPath: null, // Static configs don't need files initially
      configContent,
      configType: 'static',
      requiresFile: true, // Traefik needs static config as file
      syncStatus: 'pending',
      configVersion: 1,
      isActive: true,
      lastSyncedAt: null,
      syncErrorMessage: null,
      fileChecksum: null,
      metadata: {
        generatedAt: new Date().toISOString(),
        configType: 'static',
        entryPoints: Object.keys(config.entryPoints || {}),
        hasSSL: !!(config.certificatesResolvers && Object.keys(config.certificatesResolvers).length > 0)
      }
    };

    const [storedConfig] = await this.databaseService.db
      .insert(traefikConfigs)
      .values(configData as typeof traefikConfigs.$inferInsert)
      .returning();

    this.logger.log(`Stored static configuration for instance ${instanceId}: ${configName}`);
    return storedConfig;
  }

  /**
   * Store dynamic configuration in database with deduplication
   */
  async storeDynamicConfiguration(
    instanceId: string,
    config: TraefikDynamicConfig,
    configName: string,
    metadata?: Record<string, any>,
    configFileSyncService?: IConfigFileSyncService
  ): Promise<TraefikConfig> {
    const configContent = yaml.dump(config);
    const expectedPath = `${instanceId}/dynamic/${configName}.yml`;

    // Check for duplicates if sync service is available
    if (configFileSyncService) {
      const duplicateCheck = await configFileSyncService.checkForDuplicateBeforeCreate(
        instanceId,
        expectedPath,
        configContent,
        configName
      );

      if (!duplicateCheck.shouldCreate && duplicateCheck.existingId) {
        this.logger.log(`Using existing dynamic configuration ${duplicateCheck.existingId}: ${duplicateCheck.message}`);
        
        // Return the existing configuration
        const [existing] = await this.databaseService.db
          .select()
          .from(traefikConfigs)
          .where(eq(traefikConfigs.id, duplicateCheck.existingId))
          .limit(1);

        if (existing) {
          // Update content if it's different (path conflict case)
          if (existing.configContent !== configContent) {
            await configFileSyncService.updateConfigurationContent(
              duplicateCheck.existingId,
              configContent,
              configName
            );
            this.logger.log(`Updated existing dynamic configuration ${duplicateCheck.existingId} with new content`);
          }
          return existing;
        }
      }
    }
    
    const configData: CreateTraefikConfig = {
      id: randomUUID(),
      traefikInstanceId: instanceId,
      configName,
      configPath: null, // Will be set by file sync service if needed
      configContent,
      configType: 'dynamic',
      requiresFile: true, // Most dynamic configs need files
      syncStatus: 'pending',
      configVersion: 1,
      isActive: true,
      lastSyncedAt: null,
      syncErrorMessage: null,
      fileChecksum: null,
      metadata: {
        generatedAt: new Date().toISOString(),
        configType: 'dynamic',
        routerCount: Object.keys(config.http?.routers || {}).length,
        serviceCount: Object.keys(config.http?.services || {}).length,
        middlewareCount: Object.keys(config.http?.middlewares || {}).length,
        ...metadata
      }
    };

    const [storedConfig] = await this.databaseService.db
      .insert(traefikConfigs)
      .values(configData as typeof traefikConfigs.$inferInsert)
      .returning();

    this.logger.log(`Stored dynamic configuration for instance ${instanceId}: ${configName}`);
    return storedConfig;
  }

  /**
   * Generate and store dynamic configuration from database entities
   */
  async generateDynamicConfigFromDatabase(instanceId: string): Promise<TraefikConfig[]> {
    // Get all domain configs for this instance
    const domains = await this.databaseService.db
      .select()
      .from(domainConfigs)
      .where(and(
        eq(domainConfigs.traefikInstanceId, instanceId),
        eq(domainConfigs.isActive, true)
      ));

    const generatedConfigs: TraefikConfig[] = [];

    for (const domain of domains) {
      // Get routes for this domain
      const routes = await this.databaseService.db
        .select()
        .from(routeConfigs)
        .where(and(
          eq(routeConfigs.domainConfigId, domain.id),
          eq(routeConfigs.isActive, true)
        ));

      if (routes.length === 0) {
        continue; // Skip domains without routes
      }

      // Generate dynamic config for this domain
      const dynamicConfig: TraefikDynamicConfig = {
        http: {
          routers: {},
          services: {},
          middlewares: {}
        }
      };

      // Add routers and services for each route
      for (const route of routes) {
        const routerName = route.routeName;
        const serviceName = route.serviceName;

        // Router configuration
        (dynamicConfig.http!.routers as Record<string, any>)[routerName] = {
          rule: `Host(\`${domain.fullDomain}\`)${route.pathPrefix && route.pathPrefix !== '/' ? ` && PathPrefix(\`${route.pathPrefix}\`)` : ''}`,
          service: serviceName,
          priority: route.priority || 1,
          entryPoints: domain.sslEnabled ? ['websecure'] : ['web']
        };

        // Add TLS if SSL is enabled
        if (domain.sslEnabled) {
          (dynamicConfig.http!.routers as Record<string, any>)[routerName].tls = {
            certResolver: domain.sslProvider || 'letsencrypt'
          };
        }

        // Add middlewares if specified
        const middlewares: string[] = [];
        if (route.middleware && typeof route.middleware === 'object') {
          if (Array.isArray(route.middleware)) {
            middlewares.push(...route.middleware);
          } else if ('middlewares' in route.middleware && Array.isArray(route.middleware.middlewares)) {
            middlewares.push(...route.middleware.middlewares);
          }
        }
        
        // Add domain-level middlewares
        if (domain.middleware && typeof domain.middleware === 'object') {
          const domainMiddlewares = Object.keys(domain.middleware);
          middlewares.push(...domainMiddlewares);
        }

        if (middlewares.length > 0) {
          (dynamicConfig.http!.routers as Record<string, any>)[routerName].middlewares = middlewares;
        }

        // Service configuration
        const targetUrl = route.containerName 
          ? `http://${route.containerName}:${route.targetPort}`
          : `http://localhost:${route.targetPort}`;

        (dynamicConfig.http!.services as Record<string, any>)[serviceName] = {
          loadBalancer: {
            servers: [{ url: targetUrl }]
          }
        };

        // Add health check if specified
        if (route.healthCheck && typeof route.healthCheck === 'object') {
          (dynamicConfig.http!.services as Record<string, any>)[serviceName].loadBalancer.healthCheck = route.healthCheck;
        }
      }

      // Store the generated configuration
      const configName = `domain-${domain.id}`;
      const config = await this.storeDynamicConfiguration(
        instanceId,
        dynamicConfig,
        configName,
        {
          domainId: domain.id,
          fullDomain: domain.fullDomain,
          routeCount: routes.length,
          generatedFromDatabase: true
        }
      );

      generatedConfigs.push(config);
    }

    this.logger.log(`Generated ${generatedConfigs.length} dynamic configurations for instance ${instanceId}`);
    return generatedConfigs;
  }

  /**
   * Get all configurations for an instance
   */
  async getInstanceConfigurations(instanceId: string): Promise<TraefikConfig[]> {
    return await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(and(
        eq(traefikConfigs.traefikInstanceId, instanceId),
        eq(traefikConfigs.isActive, true)
      ))
      .orderBy(desc(traefikConfigs.createdAt));
  }

  /**
   * Get configurations by type
   */
  async getConfigurationsByType(instanceId: string, configType: string): Promise<TraefikConfig[]> {
    return await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(and(
        eq(traefikConfigs.traefikInstanceId, instanceId),
        eq(traefikConfigs.configType, configType),
        eq(traefikConfigs.isActive, true)
      ))
      .orderBy(desc(traefikConfigs.createdAt));
  }

  /**
   * Update configuration content and bump version
   */
  async updateConfiguration(
    configId: string,
    newContent: string,
    metadata?: Record<string, any>
  ): Promise<TraefikConfig> {
    const [existingConfig] = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.id, configId))
      .limit(1);

    if (!existingConfig) {
      throw new Error(`Configuration not found: ${configId}`);
    }

    const newVersion = (existingConfig.configVersion || 1) + 1;
    const updatedMetadata = {
      ...(existingConfig.metadata && typeof existingConfig.metadata === 'object' ? existingConfig.metadata : {}),
      ...metadata,
      updatedAt: new Date().toISOString(),
      previousVersion: existingConfig.configVersion
    };

    const [updatedConfig] = await this.databaseService.db
      .update(traefikConfigs)
      .set({
        configContent: newContent,
        configVersion: newVersion,
        metadata: updatedMetadata,
        syncStatus: 'pending', // Mark for re-sync
        updatedAt: new Date()
      })
      .where(eq(traefikConfigs.id, configId))
      .returning();

    this.logger.log(`Updated configuration ${configId} to version ${newVersion}`);
    return updatedConfig;
  }

  /**
   * Deactivate configuration (soft delete)
   */
  async deactivateConfiguration(configId: string): Promise<void> {
    await this.databaseService.db
      .update(traefikConfigs)
      .set({
        isActive: false,
        syncStatus: 'outdated',
        updatedAt: new Date()
      })
      .where(eq(traefikConfigs.id, configId));

    this.logger.log(`Deactivated configuration ${configId}`);
  }

  /**
   * Generate static configuration based on instance settings
   */
  async generateStaticConfigForInstance(
    instanceId: string,
    instance: {
      dashboardPort?: number;
      httpPort?: number;
      httpsPort?: number;
      acmeEmail?: string;
      logLevel?: string;
      insecureApi?: boolean;
    }
  ): Promise<TraefikConfig> {
    const staticConfig: TraefikStaticConfig = {
      global: {
        sendAnonymousUsage: false
      },
      api: {
        dashboard: true,
        insecure: instance.insecureApi || false
      },
      entryPoints: {
        web: {
          address: `:${instance.httpPort || 80}`
        },
        websecure: {
          address: `:${instance.httpsPort || 443}`
        },
        dashboard: {
          address: `:${instance.dashboardPort || 8080}`
        }
      },
      providers: {
        docker: {
          endpoint: 'unix:///var/run/docker.sock',
          exposedByDefault: false
        },
        file: {
          directory: '/etc/traefik/dynamic',
          watch: true
        }
      },
      log: {
        level: instance.logLevel as 'INFO' || 'INFO'
      }
    };

    // Add certificate resolvers if email is provided
    if (instance.acmeEmail) {
      staticConfig.certificatesResolvers = {
        letsencrypt: {
          acme: {
            tlsChallenge: {},
            email: instance.acmeEmail,
            storage: '/certificates/acme.json'
          }
        }
      };
    }

    return await this.storeStaticConfiguration(instanceId, staticConfig);
  }

  /**
   * Regenerate all dynamic configurations for an instance
   */
  async regenerateInstanceConfigurations(instanceId: string): Promise<{
    deactivated: number;
    generated: number;
    configurations: TraefikConfig[];
  }> {
    // Deactivate all existing dynamic configurations
    const existingConfigs = await this.getConfigurationsByType(instanceId, 'dynamic');
    
    for (const config of existingConfigs) {
      await this.deactivateConfiguration(config.id);
    }

    // Generate new configurations from current database state
    const newConfigs = await this.generateDynamicConfigFromDatabase(instanceId);

    this.logger.log(
      `Regenerated configurations for instance ${instanceId}: ` +
      `deactivated ${existingConfigs.length}, generated ${newConfigs.length}`
    );

    return {
      deactivated: existingConfigs.length,
      generated: newConfigs.length,
      configurations: newConfigs
    };
  }

  /**
   * Get configuration content as parsed object
   */
  async getConfigurationAsObject(configId: string): Promise<TraefikStaticConfig | TraefikDynamicConfig> {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikConfigs)
      .where(eq(traefikConfigs.id, configId))
      .limit(1);

    if (!config) {
      throw new Error(`Configuration not found: ${configId}`);
    }

    try {
      const parsed = yaml.load(config.configContent);
      return parsed as TraefikStaticConfig | TraefikDynamicConfig;
    } catch (error) {
      this.logger.error(`Failed to parse configuration ${configId}:`, error);
      throw new Error(`Invalid YAML configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate configuration content
   */
  async validateConfiguration(configContent: string): Promise<{
    isValid: boolean;
    errors: string[];
    parsedConfig?: TraefikStaticConfig | TraefikDynamicConfig;
  }> {
    const errors: string[] = [];

    try {
      const parsedConfig = yaml.load(configContent);
      
      // Basic validation for Traefik configuration structure
      if (typeof parsedConfig !== 'object' || parsedConfig === null) {
        errors.push('Configuration must be a valid YAML object');
      }

      return {
        isValid: errors.length === 0,
        errors,
        parsedConfig: parsedConfig as TraefikStaticConfig | TraefikDynamicConfig
      };
    } catch (error) {
      errors.push(`YAML parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        isValid: false,
        errors
      };
    }
  }
}