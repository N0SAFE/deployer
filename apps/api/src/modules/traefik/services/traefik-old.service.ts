import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface TraefikRoute {
  rule: string;
  service: string;
  tls?: boolean;
  middlewares?: string[];
}

export interface TraefikLoadBalancer {
  loadBalancer: {
    servers: Array<{ url: string }>;
  };
}

export interface TraefikConfig {
  http: {
    routers: Record<string, TraefikRoute>;
    services: Record<string, TraefikLoadBalancer>;
    middlewares?: Record<string, any>;
  };
}

export interface DeploymentDomain {
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
  private readonly configPath = '/data/traefik/dynamic';
  private readonly baseDomain: string;

  constructor() {
    this.baseDomain = process.env.DEPLOYER_BASE_DOMAIN || 'localhost';
    this.ensureConfigDirectory();
  }

  private async ensureConfigDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.configPath, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create Traefik config directory:', error);
    }
  }

  generateSubdomain(config: {
    projectName: string;
    serviceName: string;
    environment: 'preview' | 'production' | 'staging';
    branch?: string;
    pr?: number;
    customName?: string;
  }): string {
    const { projectName, serviceName, environment, branch, pr, customName } = config;
    
    // Sanitize names for subdomain use
    const sanitizedProject = this.sanitizeSubdomain(projectName);
    const sanitizedService = this.sanitizeSubdomain(serviceName);
    
    if (environment === 'production') {
      // Production: project-service.domain.com
      return `${sanitizedProject}-${sanitizedService}`;
    }
    
    if (environment === 'staging') {
      // Staging: project-service-staging.domain.com
      return `${sanitizedProject}-${sanitizedService}-staging`;
    }
    
    // Preview environments
    let suffix = 'preview';
    if (pr) {
      suffix = `pr-${pr}`;
    } else if (customName) {
      suffix = this.sanitizeSubdomain(customName);
    } else if (branch) {
      suffix = this.sanitizeSubdomain(branch);
    }
    
    return `${sanitizedProject}-${sanitizedService}-${suffix}`;
  }

  private sanitizeSubdomain(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')  // Replace non-alphanumeric with hyphens
      .replace(/-+/g, '-')          // Replace multiple hyphens with single
      .replace(/^-|-$/g, '')        // Remove leading/trailing hyphens
      .substring(0, 50);            // Limit length
  }

  async registerDeployment(domain: DeploymentDomain): Promise<string> {
    const fullDomain = `${domain.subdomain}.${this.baseDomain}`;
    const routerName = `${domain.projectId}-${domain.serviceId}-${domain.deploymentId}`;
    const serviceName = `${domain.projectId}-${domain.serviceId}`;
    
    this.logger.log(`Registering deployment: ${fullDomain} -> ${domain.containerId}:${domain.port}`);

    const config: TraefikConfig = {
      http: {
        routers: {
          [routerName]: {
            rule: `Host(\`${fullDomain}\`)`,
            service: serviceName,
            tls: this.shouldUseTLS(),
            middlewares: this.getDefaultMiddlewares()
          }
        },
        services: {
          [serviceName]: {
            loadBalancer: {
              servers: [{ url: `http://${domain.containerId}:${domain.port}` }]
            }
          }
        }
      }
    };

    const configFileName = `${routerName}.yml`;
    const configFilePath = path.join(this.configPath, configFileName);

    try {
      const yamlContent = yaml.dump(config, { 
        indent: 2,
        lineWidth: -1 // Disable line wrapping
      });
      
      await fs.writeFile(configFilePath, yamlContent, 'utf8');
      
      this.logger.log(`Traefik configuration written to ${configFilePath}`);
      return fullDomain;
      
    } catch (error) {
      this.logger.error(`Failed to write Traefik config for ${fullDomain}:`, error);
      throw new Error(`Failed to register domain: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async unregisterDeployment(deploymentId: string): Promise<void> {
    this.logger.log(`Unregistering deployment: ${deploymentId}`);

    try {
      const files = await fs.readdir(this.configPath);
      const configFiles = files.filter(file => 
        file.includes(deploymentId) && file.endsWith('.yml')
      );

      for (const configFile of configFiles) {
        const filePath = path.join(this.configPath, configFile);
        await fs.unlink(filePath);
        this.logger.log(`Removed Traefik config: ${configFile}`);
      }

    } catch (error) {
      this.logger.error(`Failed to unregister deployment ${deploymentId}:`, error);
      throw new Error(`Failed to unregister deployment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateDeployment(domain: DeploymentDomain): Promise<string> {
    // For updates, we can just overwrite the existing config
    return this.registerDeployment(domain);
  }

  async listActiveRoutes(): Promise<Array<{
    domain: string;
    service: string;
    deploymentId: string;
    configFile: string;
  }>> {
    const routes: Array<{
      domain: string;
      service: string;
      deploymentId: string;
      configFile: string;
    }> = [];

    try {
      const files = await fs.readdir(this.configPath);
      const configFiles = files.filter(file => file.endsWith('.yml'));

      for (const configFile of configFiles) {
        const filePath = path.join(this.configPath, configFile);
        const content = await fs.readFile(filePath, 'utf8');
        const config = yaml.load(content) as TraefikConfig;

        if (config.http && config.http.routers) {
          Object.entries(config.http.routers).forEach(([routerName, router]) => {
            // Extract domain from rule: Host(`subdomain.domain.com`)
            const domainMatch = router.rule.match(/Host\(`([^`]+)`\)/);
            if (domainMatch) {
              routes.push({
                domain: domainMatch[1],
                service: router.service,
                deploymentId: this.extractDeploymentId(configFile),
                configFile: configFile
              });
            }
          });
        }
      }

    } catch (error) {
      this.logger.error('Failed to list active routes:', error);
    }

    return routes;
  }

  private extractDeploymentId(configFile: string): string {
    // Extract deployment ID from filename pattern: project-service-deploymentId.yml
    const parts = configFile.replace('.yml', '').split('-');
    return parts.length >= 3 ? parts.slice(2).join('-') : 'unknown';
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Check if Traefik config directory is accessible
      await fs.access(this.configPath);
      
      // Check if we can write test config
      const testFile = path.join(this.configPath, '.health-check');
      await fs.writeFile(testFile, 'test', 'utf8');
      await fs.unlink(testFile);
      
      return true;
    } catch (error) {
      this.logger.error('Traefik health check failed:', error);
      return false;
    }
  }

  private shouldUseTLS(): boolean {
    // Enable TLS in production or when specifically configured
    return process.env.NODE_ENV === 'production' || 
           process.env.DEPLOYER_ENABLE_TLS === 'true';
  }

  private getDefaultMiddlewares(): string[] {
    const middlewares: string[] = [];
    
    // Add rate limiting in production
    if (process.env.NODE_ENV === 'production') {
      middlewares.push('rate-limit');
    }
    
    // Add security headers
    middlewares.push('security-headers');
    
    return middlewares;
  }

  async createMiddlewareConfig(): Promise<void> {
    const middlewareConfig = {
      http: {
        middlewares: {
          'rate-limit': {
            rateLimit: {
              burst: 100,
              average: 50
            }
          },
          'security-headers': {
            headers: {
              customRequestHeaders: {
                'X-Forwarded-Proto': 'https'
              },
              customResponseHeaders: {
                'X-Frame-Options': 'DENY',
                'X-Content-Type-Options': 'nosniff',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
              }
            }
          }
        }
      }
    };

    const middlewareFile = path.join(this.configPath, '_middlewares.yml');
    const yamlContent = yaml.dump(middlewareConfig, { indent: 2 });
    
    try {
      await fs.writeFile(middlewareFile, yamlContent, 'utf8');
      this.logger.log('Traefik middleware configuration created');
    } catch (error) {
      this.logger.error('Failed to create middleware config:', error);
    }
  }

  getBaseDomain(): string {
    return this.baseDomain;
  }

  getFullDomain(subdomain: string): string {
    return `${subdomain}.${this.baseDomain}`;
  }
}