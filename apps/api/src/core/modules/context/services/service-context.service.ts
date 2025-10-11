import { Injectable } from '@nestjs/common';
import type {
  ServiceContext,
  ProjectContext,
  ServiceDomainMapping,
} from '../types/service-context.types';
import {
  ServiceContextBuilder,
  ProjectContextBuilder,
  ContextUtils,
} from '../types/service-context.types';
import { ServiceDomainMappingRepository } from '@/core/modules/domain/repositories/service-domain-mapping.repository';
import { ProjectDomainRepository } from '@/core/modules/domain/repositories/project-domain.repository';
import { OrganizationDomainRepository } from '@/core/modules/domain/repositories/organization-domain.repository';

/**
 * Service for managing service and project contexts
 */
@Injectable()
export class ServiceContextService {
  constructor(
    private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
    private readonly projectDomainRepository: ProjectDomainRepository,
    private readonly orgDomainRepository: OrganizationDomainRepository,
  ) {}

  /**
   * Create a service context from database entities
   */
  async createServiceContext(params: {
    service: {
      id: string;
      name: string;
      type: string;
      description?: string;
      port?: number;
      healthCheckPath?: string;
      environmentVariables?: Record<string, string>;
      resourceLimits?: any;
    };
    deployment?: {
      id: string;
      containerName: string;
      containerPort: number;
      containerId?: string;
      environment: 'production' | 'staging' | 'preview' | 'development';
      status?: string;
    };
    project: {
      id: string;
      name: string;
      baseDomain?: string;
    };
    network?: {
      name: string;
      id?: string;
    };
    routing?: ServiceContext['routing'];
    custom?: Record<string, string | number | boolean>;
  }): Promise<ServiceContext> {
    const builder = new ServiceContextBuilder();

    // Service info
    builder.withService({
      id: params.service.id,
      name: params.service.name,
      type: params.service.type,
      description: params.service.description,
    });

    // Deployment info
    if (params.deployment) {
      builder.withDeployment(params.deployment);
    }

    // Fetch domain mappings from database
    const rawMappings = await this.serviceDomainMappingRepository.findByServiceIdWithUrls(params.service.id);
    
    // Transform to include organization domain details
    const domainMappings: ServiceDomainMapping[] = await Promise.all(
      rawMappings.map(async (mapping) => {
        const projectDomain = await this.serviceDomainMappingRepository['projectDomainRepository'].findById(mapping.projectDomainId);
        const orgDomain = await this.serviceDomainMappingRepository['orgDomainRepository'].findById(projectDomain!.organizationDomainId);
        
        return {
          ...mapping,
          organizationDomain: {
            id: orgDomain!.id,
            domain: orgDomain!.domain,
            verificationStatus: orgDomain!.verificationStatus as 'verified' | 'pending' | 'failed',
          },
        };
      })
    );
    
    builder.withDomainMappings(domainMappings);

    // Network
    if (params.network) {
      builder.withNetwork({
        name: params.network.name,
        id: params.network.id,
        internalPort: params.deployment?.containerPort,
        externalPort: params.service.port,
        protocols: ['http', 'https'],
      });
    }

    // Paths - use primary domain's basePath if available
    const primaryDomain = domainMappings.find(d => d.isPrimary);
    builder.withPaths({
      healthCheck: params.service.healthCheckPath || '/health',
      prefix: primaryDomain?.basePath || undefined,
    });

    // Routing
    if (params.routing) {
      builder.withRouting(params.routing);
    }

    // Environment
    if (params.service.environmentVariables) {
      builder.withEnvironment(params.service.environmentVariables);
    }

    // Resources
    if (params.service.resourceLimits) {
      builder.withResources({
        cpu: params.service.resourceLimits.cpu,
        memory: params.service.resourceLimits.memory,
        storage: params.service.resourceLimits.storage,
      });
    }

    // Health check
    builder.withHealthCheck({
      enabled: true,
      path: params.service.healthCheckPath || '/health',
    });

    // Custom variables
    if (params.custom) {
      builder.withCustom(params.custom);
    }

    return builder.build();
  }

  /**
   * Create a project context with services
   */
  async createProjectContext(params: {
    project: {
      id: string;
      name: string;
      description?: string;
      baseDomain?: string;
    };
    services: Array<{
      name: string;
      context: ServiceContext;
    }>;
    network?: {
      name: string;
      id?: string;
    };
    environment?: Record<string, string>;
    metadata?: ProjectContext['metadata'];
  }): Promise<ProjectContext> {
    const builder = new ProjectContextBuilder();

    // Project info
    builder.withProject({
      id: params.project.id,
      name: params.project.name,
      description: params.project.description,
      baseDomain: params.project.baseDomain,
    });

    // Network
    if (params.network) {
      builder.withNetwork(params.network);
    }

    // Environment
    if (params.environment) {
      builder.withEnvironment(params.environment);
    }

    // Metadata
    if (params.metadata) {
      builder.withMetadata(params.metadata);
    }

    // Add services
    for (const service of params.services) {
      builder.addService(service.name, service.context);
    }

    return builder.build();
  }

  /**
   * Convert service context to Traefik variable context
   */
  toTraefikContext(serviceContext: ServiceContext): any {
    return ContextUtils.toTraefikVariableContext(serviceContext);
  }

  /**
   * Get all domain mappings from service
   */
  getAllDomainMappings(serviceContext: ServiceContext): ServiceDomainMapping[] {
    return ContextUtils.getAllDomainMappings(serviceContext);
  }

  /**
   * Get domain mapping by URL or primary
   */
  getDomainMappingByUrlOrPrimary(serviceContext: ServiceContext, url?: string): ServiceDomainMapping | undefined {
    return ContextUtils.getDomainMappingByUrlOrPrimary(serviceContext, url);
  }

  /**
   * Get merged environment (project + service)
   */
  getMergedEnvironment(serviceContext: ServiceContext): Record<string, string> {
    return ContextUtils.getMergedEnvironment(serviceContext);
  }

  /**
   * Get all URLs for a service
   */
  getAllUrls(serviceContext: ServiceContext): string[] {
    return serviceContext.getAllUrls();
  }

  /**
   * Get primary domain mapping
   */
  getPrimaryDomain(serviceContext: ServiceContext): ServiceDomainMapping | undefined {
    return serviceContext.getPrimaryDomain();
  }

  /**
   * Get domain mapping by URL
   */
  getDomainByUrl(serviceContext: ServiceContext, url: string): ServiceDomainMapping | undefined {
    return serviceContext.getDomainByUrl(url);
  }
}
