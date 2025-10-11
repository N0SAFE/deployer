/**
 * Service Context System
 * 
 * This module provides a comprehensive context system for services and projects.
 * The context is used across multiple systems:
 * - Traefik configuration and routing
 * - Environment variable resolution
 * - Deployment orchestration
 * - Domain management
 */

/**
 * Service domain mapping with computed URL
 * Based on the new multi-level domain system
 */
export interface ServiceDomainMapping {
  id: string;
  serviceId: string;
  projectDomainId: string;
  subdomain: string | null;
  basePath: string | null;
  isPrimary: boolean;
  sslEnabled: boolean;
  sslProvider: 'letsencrypt' | 'custom' | 'none';
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
  
  /** Computed full URL (e.g., "https://api.example.com/path") */
  fullUrl: string;
  
  /** Organization domain details */
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: 'verified' | 'pending' | 'failed';
  };
}

/**
 * Service-level context
 * Contains all information about a specific service
 */
export interface ServiceContext {
  // === Service Identity ===
  service: {
    id: string;
    name: string;
    type: string;
    description?: string;
  };
  
  // === Deployment Information ===
  deployment?: {
    id: string;
    containerName: string;
    containerPort: number;
    containerId?: string;
    environment: 'production' | 'staging' | 'preview' | 'development';
    status?: string;
  };
  
  // === Domain Configuration ===
  /** Domain mappings from the multi-level domain system */
  domainMappings: ServiceDomainMapping[];
  
  /** Get primary domain mapping */
  getPrimaryDomain(): ServiceDomainMapping | undefined;
  
  /** Get all domain URLs */
  getAllUrls(): string[];
  
  /** Get domain mapping by URL */
  getDomainByUrl(url: string): ServiceDomainMapping | undefined;
  
  // === Network Configuration ===
  network?: {
    name: string;
    id?: string;
    internalPort?: number;
    externalPort?: number;
    protocols?: ('http' | 'https' | 'tcp' | 'udp')[];
  };
  
  // === Path Configuration ===
  paths?: {
    healthCheck?: string;
    prefix?: string;
    custom?: Record<string, string>;
  };
  
  // === Route Configuration ===
  routing?: {
    routerName?: string;
    serviceName?: string;
    middlewareName?: string;
    entryPoint?: string;
    priority?: number;
  };
  
  // === Environment Variables ===
  environment?: Record<string, string>;
  
  // === Resource Configuration ===
  resources?: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };
  
  // === Health Check Configuration ===
  healthCheck?: {
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  };
  
  // === Custom Variables ===
  custom?: Record<string, string | number | boolean>;
  
  // === Project Context (Proxy) ===
  /** Get the parent project context */
  getProjectContext(): ProjectContext;
}

/**
 * Project-level context
 * Contains all information about a project and its services
 */
export interface ProjectContext {
  // === Project Identity ===
  project: {
    id: string;
    name: string;
    description?: string;
    baseDomain?: string;
  };
  
  // === Services Context (Proxy) ===
  servicesContext: Record<string, ServiceContext>;
  
  /** Get service context by name */
  getServiceContext(serviceName: string): ServiceContext | undefined;
  
  /** Get all service contexts */
  getAllServiceContexts(): ServiceContext[];
  
  /** Get all service names */
  getServiceNames(): string[];
  
  // === Project-wide Network Configuration ===
  network?: {
    name: string;
    id?: string;
    subnet?: string;
  };
  
  // === Project-wide Environment ===
  environment?: Record<string, string>;
  
  // === Project Metadata ===
  metadata?: {
    createdAt?: Date;
    updatedAt?: Date;
    createdBy?: string;
    tags?: string[];
    custom?: Record<string, any>;
  };
}

/**
 * Context builder for creating service contexts with bidirectional references
 */
export class ServiceContextBuilder {
  private serviceData: Partial<ServiceContext> = {};
  private projectContextRef?: ProjectContext;
  
  withService(service: ServiceContext['service']): this {
    this.serviceData.service = service;
    return this;
  }
  
  withDeployment(deployment: ServiceContext['deployment']): this {
    this.serviceData.deployment = deployment;
    return this;
  }
  
  withDomainMappings(domainMappings: ServiceDomainMapping[]): this {
    this.serviceData.domainMappings = domainMappings;
    return this;
  }
  
  withNetwork(network: ServiceContext['network']): this {
    this.serviceData.network = network;
    return this;
  }
  
  withPaths(paths: ServiceContext['paths']): this {
    this.serviceData.paths = paths;
    return this;
  }
  
  withRouting(routing: ServiceContext['routing']): this {
    this.serviceData.routing = routing;
    return this;
  }
  
  withEnvironment(environment: ServiceContext['environment']): this {
    this.serviceData.environment = environment;
    return this;
  }
  
  withResources(resources: ServiceContext['resources']): this {
    this.serviceData.resources = resources;
    return this;
  }
  
  withHealthCheck(healthCheck: ServiceContext['healthCheck']): this {
    this.serviceData.healthCheck = healthCheck;
    return this;
  }
  
  withCustom(custom: ServiceContext['custom']): this {
    this.serviceData.custom = custom;
    return this;
  }
  
  withProjectContext(projectContext: ProjectContext): this {
    this.projectContextRef = projectContext;
    return this;
  }
  
  build(): ServiceContext {
    if (!this.serviceData.service) {
      throw new Error('Service information is required');
    }
    
    const context: ServiceContext = {
      service: this.serviceData.service,
      domainMappings: this.serviceData.domainMappings || [],
      deployment: this.serviceData.deployment,
      network: this.serviceData.network,
      paths: this.serviceData.paths,
      routing: this.serviceData.routing,
      environment: this.serviceData.environment,
      resources: this.serviceData.resources,
      healthCheck: this.serviceData.healthCheck,
      custom: this.serviceData.custom,
      
      getPrimaryDomain() {
        return this.domainMappings.find(d => d.isPrimary);
      },
      
      getAllUrls() {
        return this.domainMappings.map(d => d.fullUrl);
      },
      
      getDomainByUrl(url: string) {
        return this.domainMappings.find(d => d.fullUrl === url);
      },
      
      getProjectContext: () => {
        if (!this.projectContextRef) {
          throw new Error('Project context not available');
        }
        return this.projectContextRef;
      },
    };
    
    return context;
  }
}

/**
 * Context builder for creating project contexts with services
 */
export class ProjectContextBuilder {
  private projectData: Partial<ProjectContext> = {};
  private servicesMap: Map<string, ServiceContext> = new Map();
  
  withProject(project: ProjectContext['project']): this {
    this.projectData.project = project;
    return this;
  }
  
  withNetwork(network: ProjectContext['network']): this {
    this.projectData.network = network;
    return this;
  }
  
  withEnvironment(environment: ProjectContext['environment']): this {
    this.projectData.environment = environment;
    return this;
  }
  
  withMetadata(metadata: ProjectContext['metadata']): this {
    this.projectData.metadata = metadata;
    return this;
  }
  
  addService(serviceName: string, serviceContext: ServiceContext): this {
    this.servicesMap.set(serviceName, serviceContext);
    return this;
  }
  
  build(): ProjectContext {
    if (!this.projectData.project) {
      throw new Error('Project information is required');
    }
    
    const projectContext: ProjectContext = {
      project: this.projectData.project,
      servicesContext: {},
      network: this.projectData.network,
      environment: this.projectData.environment,
      metadata: this.projectData.metadata,
      
      getServiceContext(serviceName: string) {
        return this.servicesContext[serviceName];
      },
      
      getAllServiceContexts() {
        return Object.values(this.servicesContext);
      },
      
      getServiceNames() {
        return Object.keys(this.servicesContext);
      },
    };
    
    // Create proxy for servicesContext to ensure bidirectional references
    projectContext.servicesContext = new Proxy({}, {
      get: (target, serviceName: string) => {
        const serviceContext = this.servicesMap.get(serviceName);
        if (!serviceContext) return undefined;
        
        // Create a proxy that overrides getProjectContext to return this project
        return new Proxy(serviceContext, {
          get: (serviceTarget, prop) => {
            if (prop === 'getProjectContext') {
              return () => projectContext;
            }
            return serviceTarget[prop as keyof ServiceContext];
          },
        });
      },
      
      has: (target, serviceName: string) => {
        return this.servicesMap.has(serviceName);
      },
      
      ownKeys: () => {
        return Array.from(this.servicesMap.keys());
      },
      
      getOwnPropertyDescriptor: (target, serviceName) => {
        if (this.servicesMap.has(serviceName as string)) {
          return {
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      },
    });
    
    return projectContext;
  }
}

/**
 * Utility functions for context conversion
 */
export class ContextUtils {
  /**
   * Convert ServiceContext to Traefik variable context
   */
  static toTraefikVariableContext(serviceContext: ServiceContext): any {
    const primaryDomain = serviceContext.getPrimaryDomain();
    
    // Parse primary domain URL for backward compatibility
    let domainInfo: any;
    if (primaryDomain) {
      try {
        const url = new URL(primaryDomain.fullUrl);
        const hostname = url.hostname;
        const parts = hostname.split('.');
        const baseDomain = parts.slice(-2).join('.'); // e.g., "example.com"
        const subdomain = parts.length > 2 ? parts.slice(0, -2).join('.') : undefined;
        
        domainInfo = {
          domain: baseDomain,
          subdomain: subdomain,
          fullDomain: hostname,
          baseDomain: baseDomain,
          basePath: primaryDomain.basePath,
        };
      } catch {
        domainInfo = undefined;
      }
    }
    
    return {
      service: {
        id: serviceContext.service.id,
        name: serviceContext.service.name,
        type: serviceContext.service.type,
        port: serviceContext.deployment?.containerPort,
        healthCheckPath: serviceContext.paths?.healthCheck,
      },
      deployment: serviceContext.deployment ? {
        id: serviceContext.deployment.id,
        containerName: serviceContext.deployment.containerName,
        containerPort: serviceContext.deployment.containerPort,
        containerId: serviceContext.deployment.containerId,
        environment: serviceContext.deployment.environment,
      } : undefined,
      domain: domainInfo,
      ssl: primaryDomain ? {
        enabled: primaryDomain.sslEnabled,
        provider: primaryDomain.sslProvider,
      } : undefined,
      path: serviceContext.paths,
      network: serviceContext.network,
      project: {
        id: serviceContext.getProjectContext().project.id,
        name: serviceContext.getProjectContext().project.name,
      },
      route: serviceContext.routing,
      custom: serviceContext.custom,
      // Add all domain mappings for multi-domain support
      allDomains: serviceContext.domainMappings.map(dm => ({
        url: dm.fullUrl,
        subdomain: dm.subdomain,
        basePath: dm.basePath,
        isPrimary: dm.isPrimary,
        sslEnabled: dm.sslEnabled,
      })),
    };
  }
  
  /**
   * Get all domain mappings from service context
   */
  static getAllDomainMappings(serviceContext: ServiceContext): ServiceDomainMapping[] {
    return serviceContext.domainMappings;
  }
  
  /**
   * Get domain mapping by URL or return primary
   */
  static getDomainMappingByUrlOrPrimary(serviceContext: ServiceContext, url?: string): ServiceDomainMapping | undefined {
    if (url) {
      const domain = serviceContext.getDomainByUrl(url);
      if (domain) return domain;
    }
    return serviceContext.getPrimaryDomain();
  }
  
  /**
   * Merge project and service environments
   */
  static getMergedEnvironment(serviceContext: ServiceContext): Record<string, string> {
    const projectEnv = serviceContext.getProjectContext().environment || {};
    const serviceEnv = serviceContext.environment || {};
    
    return {
      ...projectEnv,
      ...serviceEnv, // Service env overrides project env
    };
  }
}
