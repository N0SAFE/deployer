import { Injectable } from '@nestjs/common';

export interface TraefikTemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'ssl' | 'advanced' | 'microservices';
  config: {
    ports: {
      dashboard?: number;
      http?: number;
      https?: number;
    };
    ssl: {
      enabled: boolean;
      provider?: 'letsencrypt' | 'selfsigned' | 'custom';
      acmeEmail?: string;
    };
    middleware: string[];
    entrypoints?: Record<string, any>;
  };
  isDefault: boolean;
}

export interface ServiceTypeConfig {
  type: 'web' | 'api' | 'database' | 'cache' | 'queue' | 'custom';
  recommendedTemplate: string;
  defaultPorts: number[];
  commonMiddleware: string[];
  pathPrefixes: string[];
}

@Injectable()
export class TemplateService {
  private templates: TraefikTemplate[] = [
    {
      id: 'basic',
      name: 'Basic HTTP',
      description: 'Simple HTTP routing without SSL',
      category: 'basic',
      config: {
        ports: {
          dashboard: 8080,
          http: 80,
        },
        ssl: {
          enabled: false,
        },
        middleware: [],
      },
      isDefault: true,
    },
    {
      id: 'ssl-letsencrypt',
      name: 'SSL with Let\'s Encrypt',
      description: 'HTTPS routing with automatic Let\'s Encrypt certificates',
      category: 'ssl',
      config: {
        ports: {
          dashboard: 8080,
          http: 80,
          https: 443,
        },
        ssl: {
          enabled: true,
          provider: 'letsencrypt',
        },
        middleware: ['redirect-to-https'],
      },
      isDefault: false,
    },
    {
      id: 'ssl-custom',
      name: 'SSL with Custom Certificates',
      description: 'HTTPS routing with custom SSL certificates',
      category: 'ssl',
      config: {
        ports: {
          dashboard: 8080,
          http: 80,
          https: 443,
        },
        ssl: {
          enabled: true,
          provider: 'custom',
        },
        middleware: ['redirect-to-https'],
      },
      isDefault: false,
    },
    {
      id: 'microservices',
      name: 'Microservices Gateway',
      description: 'Advanced configuration for microservices with load balancing and middleware',
      category: 'microservices',
      config: {
        ports: {
          dashboard: 8080,
          http: 80,
          https: 443,
        },
        ssl: {
          enabled: true,
          provider: 'letsencrypt',
        },
        middleware: [
          'cors',
          'rate-limit',
          'auth',
          'compression',
          'logging',
          'redirect-to-https'
        ],
      },
      isDefault: false,
    },
    {
      id: 'advanced',
      name: 'Advanced Configuration',
      description: 'Highly customizable setup with advanced routing and middleware',
      category: 'advanced',
      config: {
        ports: {
          dashboard: 8080,
          http: 80,
          https: 443,
        },
        ssl: {
          enabled: true,
          provider: 'letsencrypt',
        },
        middleware: [
          'cors',
          'rate-limit',
          'auth',
          'compression',
          'logging',
          'circuit-breaker',
          'retry',
          'redirect-to-https'
        ],
        entrypoints: {
          web: {
            address: ':80',
            http: {
              redirections: {
                entrypoint: {
                  to: 'websecure',
                  scheme: 'https',
                  permanent: true,
                }
              }
            }
          },
          websecure: {
            address: ':443',
            http: {
              tls: {
                certResolver: 'letsencrypt'
              }
            }
          }
        }
      },
      isDefault: false,
    },
  ];

  private serviceTypeConfigs: ServiceTypeConfig[] = [
    {
      type: 'web',
      recommendedTemplate: 'ssl-letsencrypt',
      defaultPorts: [80, 3000, 8000, 8080],
      commonMiddleware: ['cors', 'compression', 'redirect-to-https'],
      pathPrefixes: ['/'],
    },
    {
      type: 'api',
      recommendedTemplate: 'microservices',
      defaultPorts: [8000, 8080, 3000, 5000],
      commonMiddleware: ['cors', 'rate-limit', 'auth', 'logging'],
      pathPrefixes: ['/api', '/v1', '/v2'],
    },
    {
      type: 'database',
      recommendedTemplate: 'basic',
      defaultPorts: [5432, 3306, 27017, 6379],
      commonMiddleware: ['auth', 'rate-limit'],
      pathPrefixes: ['/'],
    },
    {
      type: 'cache',
      recommendedTemplate: 'basic',
      defaultPorts: [6379, 11211],
      commonMiddleware: ['auth', 'rate-limit'],
      pathPrefixes: ['/'],
    },
    {
      type: 'queue',
      recommendedTemplate: 'basic',
      defaultPorts: [5672, 15672, 9092],
      commonMiddleware: ['auth'],
      pathPrefixes: ['/'],
    },
    {
      type: 'custom',
      recommendedTemplate: 'basic',
      defaultPorts: [8080],
      commonMiddleware: [],
      pathPrefixes: ['/'],
    },
  ];

  /**
   * Get all available templates
   */
  getTemplates(category?: 'basic' | 'ssl' | 'advanced' | 'microservices'): TraefikTemplate[] {
    if (category) {
      return this.templates.filter(template => template.category === category);
    }
    return this.templates;
  }

  /**
   * Get a specific template by ID
   */
  getTemplate(templateId: string): TraefikTemplate | null {
    return this.templates.find(template => template.id === templateId) || null;
  }

  /**
   * Get the default template
   */
  getDefaultTemplate(): TraefikTemplate {
    return this.templates.find(template => template.isDefault) || this.templates[0];
  }

  /**
   * Get service type configuration
   */
  getServiceTypeConfig(serviceType: 'web' | 'api' | 'database' | 'cache' | 'queue' | 'custom'): ServiceTypeConfig | null {
    return this.serviceTypeConfigs.find(config => config.type === serviceType) || null;
  }

  /**
   * Get recommended template for a service type
   */
  getRecommendedTemplateForService(serviceType: 'web' | 'api' | 'database' | 'cache' | 'queue' | 'custom'): TraefikTemplate | null {
    const serviceConfig = this.getServiceTypeConfig(serviceType);
    if (!serviceConfig) return null;
    
    return this.getTemplate(serviceConfig.recommendedTemplate);
  }

  /**
   * Auto-configure Traefik based on service detection
   */
  autoConfigureForService(serviceType: 'web' | 'api' | 'database' | 'cache' | 'queue' | 'custom', customConfig?: {
    acmeEmail?: string;
    logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    dashboardPort?: number;
    httpPort?: number;
    httpsPort?: number;
  }): {
    template: TraefikTemplate;
    instanceConfig: {
      dashboardPort: number;
      httpPort: number;
      httpsPort?: number;
      acmeEmail?: string;
      logLevel: string;
      insecureApi: boolean;
    };
    suggestedMiddleware: string[];
    suggestedPorts: number[];
  } {
    const template = this.getRecommendedTemplateForService(serviceType) || this.getDefaultTemplate();
    const serviceConfig = this.getServiceTypeConfig(serviceType);

    return {
      template,
      instanceConfig: {
        dashboardPort: customConfig?.dashboardPort || template.config.ports.dashboard || 8080,
        httpPort: customConfig?.httpPort || template.config.ports.http || 80,
        httpsPort: template.config.ssl.enabled ? (customConfig?.httpsPort || template.config.ports.https || 443) : undefined,
        acmeEmail: template.config.ssl.enabled ? (customConfig?.acmeEmail || template.config.ssl.acmeEmail) : undefined,
        logLevel: customConfig?.logLevel || 'INFO',
        insecureApi: true,
      },
      suggestedMiddleware: serviceConfig?.commonMiddleware || [],
      suggestedPorts: serviceConfig?.defaultPorts || [8080],
    };
  }

  /**
   * Generate configuration content based on template and service type
   */
  generateConfigurationContent(template: TraefikTemplate, instanceName: string, customConfig?: any): string {
    const config = {
      global: {
        checkNewVersion: false,
        sendAnonymousUsage: false,
      },
      log: {
        level: customConfig?.logLevel || 'INFO',
      },
      api: {
        dashboard: true,
        insecure: true,
      },
      entryPoints: template.config.entrypoints || {
        web: {
          address: `:${template.config.ports.http || 80}`,
        },
        ...(template.config.ssl.enabled && {
          websecure: {
            address: `:${template.config.ports.https || 443}`,
          },
        }),
      },
      providers: {
        file: {
          directory: '/etc/traefik/dynamic',
          watch: true,
        },
        docker: {
          exposedByDefault: false,
          network: `${instanceName}_default`,
        },
      },
      ...(template.config.ssl.enabled && template.config.ssl.provider === 'letsencrypt' && {
        certificatesResolvers: {
          letsencrypt: {
            acme: {
              email: customConfig?.acmeEmail || template.config.ssl.acmeEmail,
              storage: '/etc/traefik/acme.json',
              httpChallenge: {
                entryPoint: 'web',
              },
            },
          },
        },
      }),
    };

    return JSON.stringify(config, null, 2);
  }
}