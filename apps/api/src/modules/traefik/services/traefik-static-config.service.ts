import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import {
  traefikStaticConfigs,
  traefikInstances,
  type TraefikStaticConfig as DbTraefikStaticConfig,
  type CreateTraefikStaticConfig
} from '../../../core/modules/db/drizzle/schema/traefik';

// Comprehensive Traefik static configuration interface
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

@Injectable()
export class TraefikStaticConfigService {
  private readonly logger = new Logger(TraefikStaticConfigService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Get static configuration for a Traefik instance
   */
  async getStaticConfig(instanceId: string): Promise<DbTraefikStaticConfig | null> {
    const [config] = await this.databaseService.db
      .select()
      .from(traefikStaticConfigs)
      .where(eq(traefikStaticConfigs.traefikInstanceId, instanceId))
      .limit(1);

    return config || null;
  }

  /**
   * Create or update static configuration for a Traefik instance
   */
  async saveStaticConfig(
    instanceId: string,
    configSections: Partial<{
      globalConfig: any;
      apiConfig: any;
      entryPointsConfig: any;
      providersConfig: any;
      logConfig: any;
      accessLogConfig: any;
      metricsConfig: any;
      tracingConfig: any;
      tlsConfig: any;
      certificateResolversConfig: any;
      experimentalConfig: any;
      serversTransportConfig: any;
      hostResolverConfig: any;
      clusterConfig: any;
    }>
  ): Promise<DbTraefikStaticConfig> {
    // Check if instance exists
    const [instance] = await this.databaseService.db
      .select()
      .from(traefikInstances)
      .where(eq(traefikInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      throw new NotFoundException(`Traefik instance ${instanceId} not found`);
    }

    // Check if config already exists
    const existing = await this.getStaticConfig(instanceId);

    // Generate full configuration from sections
    const fullConfig = this.mergeConfigSections(configSections);

    // Validate configuration
    const validation = this.validateConfiguration(fullConfig);

    const configData: CreateTraefikStaticConfig = {
      id: existing?.id || randomUUID(),
      traefikInstanceId: instanceId,
      globalConfig: configSections.globalConfig || null,
      apiConfig: configSections.apiConfig || null,
      entryPointsConfig: configSections.entryPointsConfig || null,
      providersConfig: configSections.providersConfig || null,
      logConfig: configSections.logConfig || null,
      accessLogConfig: configSections.accessLogConfig || null,
      metricsConfig: configSections.metricsConfig || null,
      tracingConfig: configSections.tracingConfig || null,
      tlsConfig: configSections.tlsConfig || null,
      certificateResolversConfig: configSections.certificateResolversConfig || null,
      experimentalConfig: configSections.experimentalConfig || null,
      serversTransportConfig: configSections.serversTransportConfig || null,
      hostResolverConfig: configSections.hostResolverConfig || null,
      clusterConfig: configSections.clusterConfig || null,
      fullConfig,
      configVersion: (existing?.configVersion || 0) + 1,
      syncStatus: 'pending',
      lastSyncedAt: null,
      syncErrorMessage: null,
      isValid: validation.isValid,
      validationErrors: validation.errors.length > 0 ? validation.errors : null,
    };

    if (existing) {
      // Update existing configuration
      const [updated] = await this.databaseService.db
        .update(traefikStaticConfigs)
        .set({
          ...configSections,
          fullConfig,
          configVersion: configData.configVersion,
          syncStatus: 'pending',
          isValid: validation.isValid,
          validationErrors: validation.errors.length > 0 ? validation.errors : null,
          updatedAt: new Date(),
        })
        .where(eq(traefikStaticConfigs.id, existing.id))
        .returning();

      this.logger.log(`Updated static configuration for instance ${instanceId}`);
      return updated;
    } else {
      // Create new configuration
      const [created] = await this.databaseService.db
        .insert(traefikStaticConfigs)
        .values(configData as any)
        .returning();

      this.logger.log(`Created static configuration for instance ${instanceId}`);
      return created;
    }
  }

  /**
   * Get compiled YAML configuration for a Traefik instance
   */
  async getCompiledYamlConfig(instanceId: string): Promise<string> {
    const config = await this.getStaticConfig(instanceId);
    if (!config || !config.fullConfig) {
      throw new NotFoundException(`No static configuration found for instance ${instanceId}`);
    }

    return yaml.dump(config.fullConfig, { 
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: true
    });
  }

  /**
   * Generate default configuration for a new Traefik instance
   */
  async createDefaultConfig(instanceId: string): Promise<DbTraefikStaticConfig> {
    // Get instance details
    const [instance] = await this.databaseService.db
      .select()
      .from(traefikInstances)
      .where(eq(traefikInstances.id, instanceId))
      .limit(1);

    if (!instance) {
      throw new NotFoundException(`Traefik instance ${instanceId} not found`);
    }

    const defaultConfig = {
      globalConfig: {
        sendAnonymousUsage: false
      },
      apiConfig: {
        dashboard: true,
        insecure: instance.insecureApi || true,
        debug: false
      },
      entryPointsConfig: {
        web: {
          address: `:${instance.httpPort || 80}`
        },
        websecure: {
          address: `:${instance.httpsPort || 443}`,
          http: {
            tls: {
              certResolver: 'letsencrypt'
            }
          }
        },
        traefik: {
          address: `:${instance.dashboardPort || 8080}`
        }
      },
      providersConfig: {
        docker: {
          endpoint: 'unix:///var/run/docker.sock',
          exposedByDefault: false,
          watch: true,
          network: 'traefik'
        },
        file: {
          directory: '/etc/traefik/dynamic',
          watch: true
        }
      },
      logConfig: {
        level: instance.logLevel as any || 'INFO',
        format: 'common'
      },
      certificateResolversConfig: instance.acmeEmail ? {
        letsencrypt: {
          acme: {
            email: instance.acmeEmail,
            storage: '/certificates/acme.json',
            httpChallenge: {
              entryPoint: 'web'
            }
          }
        }
      } : undefined
    };

    return this.saveStaticConfig(instanceId, defaultConfig);
  }

  /**
   * Update a specific configuration section
   */
  async updateConfigSection(
    instanceId: string,
    section: keyof DbTraefikStaticConfig,
    config: any
  ): Promise<DbTraefikStaticConfig> {
    const existing = await this.getStaticConfig(instanceId);
    if (!existing) {
      throw new NotFoundException(`No static configuration found for instance ${instanceId}`);
    }

    const updates = { [section]: config };
    return this.saveStaticConfig(instanceId, updates);
  }

  /**
   * Mark configuration as synced
   */
  async markAsSynced(instanceId: string): Promise<void> {
    await this.databaseService.db
      .update(traefikStaticConfigs)
      .set({
        syncStatus: 'synced',
        lastSyncedAt: new Date(),
        syncErrorMessage: null,
      })
      .where(eq(traefikStaticConfigs.traefikInstanceId, instanceId));

    this.logger.log(`Marked static configuration as synced for instance ${instanceId}`);
  }

  /**
   * Mark configuration sync as failed
   */
  async markSyncFailed(instanceId: string, error: string): Promise<void> {
    await this.databaseService.db
      .update(traefikStaticConfigs)
      .set({
        syncStatus: 'failed',
        syncErrorMessage: error,
      })
      .where(eq(traefikStaticConfigs.traefikInstanceId, instanceId));

    this.logger.error(`Static configuration sync failed for instance ${instanceId}: ${error}`);
  }

  /**
   * Delete static configuration for an instance
   */
  async deleteStaticConfig(instanceId: string): Promise<void> {
    await this.databaseService.db
      .delete(traefikStaticConfigs)
      .where(eq(traefikStaticConfigs.traefikInstanceId, instanceId));

    this.logger.log(`Deleted static configuration for instance ${instanceId}`);
  }

  /**
   * Merge configuration sections into a complete Traefik config
   */
  private mergeConfigSections(sections: any): TraefikStaticConfig {
    const config: TraefikStaticConfig = {};

    if (sections.globalConfig) config.global = sections.globalConfig;
    if (sections.apiConfig) config.api = sections.apiConfig;
    if (sections.entryPointsConfig) config.entryPoints = sections.entryPointsConfig;
    if (sections.providersConfig) config.providers = sections.providersConfig;
    if (sections.logConfig) config.log = sections.logConfig;
    if (sections.accessLogConfig) config.accessLog = sections.accessLogConfig;
    if (sections.metricsConfig) config.metrics = sections.metricsConfig;
    if (sections.tracingConfig) config.tracing = sections.tracingConfig;
    if (sections.tlsConfig) config.tls = sections.tlsConfig;
    if (sections.certificateResolversConfig) config.certificatesResolvers = sections.certificateResolversConfig;
    if (sections.experimentalConfig) config.experimental = sections.experimentalConfig;
    if (sections.serversTransportConfig) config.serversTransport = sections.serversTransportConfig;
    if (sections.hostResolverConfig) config.hostResolver = sections.hostResolverConfig;
    if (sections.clusterConfig) config.cluster = sections.clusterConfig;

    return config;
  }

  /**
   * Validate Traefik configuration
   */
  private validateConfiguration(config: TraefikStaticConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate entry points
    if (config.entryPoints) {
      for (const [name, entryPoint] of Object.entries(config.entryPoints)) {
        if (!entryPoint.address) {
          errors.push(`Entry point ${name} must have an address`);
        }
      }
    }

    // Validate certificate resolvers
    if (config.certificatesResolvers) {
      for (const [name, resolver] of Object.entries(config.certificatesResolvers)) {
        if (resolver.acme) {
          if (!resolver.acme.email) {
            errors.push(`Certificate resolver ${name} must have an email`);
          }
          if (!resolver.acme.storage) {
            errors.push(`Certificate resolver ${name} must have a storage path`);
          }
        }
      }
    }

    // Validate plugins
    if (config.experimental?.plugins) {
      for (const [name, plugin] of Object.entries(config.experimental.plugins)) {
        if (!plugin.moduleName) {
          errors.push(`Plugin ${name} must have a moduleName`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}