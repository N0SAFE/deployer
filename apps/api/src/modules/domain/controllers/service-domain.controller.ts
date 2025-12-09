import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { domainContract } from '@repo/api-contracts';
import { ServiceDomainMappingRepository } from '@/core/modules/domain/repositories/service-domain-mapping.repository';
import { ProjectDomainRepository } from '@/core/modules/domain/repositories/project-domain.repository';
import { OrganizationDomainRepository } from '@/core/modules/domain/repositories/organization-domain.repository';
import { DomainConflictService } from '@/core/modules/domain/services/domain-conflict.service';
import { DomainAdapter } from '@/core/modules/domain/adapters/domain.adapter';
import {
  OrganizationDomainNotFoundError,
  ProjectDomainNotFoundError,
  ServiceDomainMappingNotFoundError,
  ServiceMappingMismatchError,
  SubdomainConflictError,
  ServiceDomainMappingUpdateError,
  ServiceDomainMappingDeletionError,
  SetPrimaryDomainError,
} from '@/core/modules/domain/errors';  

@Controller()
export class ServiceDomainController {
  private readonly logger = new Logger(ServiceDomainController.name);

  constructor(
    private readonly serviceMappingRepository: ServiceDomainMappingRepository,
    private readonly projectDomainRepository: ProjectDomainRepository,
    private readonly orgDomainRepository: OrganizationDomainRepository,
    private readonly conflictService: DomainConflictService,
  ) {}

  @Implement(domainContract.checkSubdomainAvailability)
  checkSubdomainAvailability() {
    return implement(domainContract.checkSubdomainAvailability).handler(async ({ input }) => {
      this.logger.debug(
        `Checking subdomain availability for project domain ${input.projectDomainId}: ` +
        `subdomain=${String(input.subdomain)}, basePath=${input.basePath ?? '/'}`
      );

      return await this.conflictService.checkSubdomainAvailability(
        input.projectDomainId,
        input.subdomain ?? null,
        input.basePath ?? null,
        input.excludeServiceId
      );
    });
  }

  @Implement(domainContract.listServiceDomains)
  listServiceDomains() {
    return implement(domainContract.listServiceDomains).handler(async ({ input }) => {
      this.logger.debug(`Fetching domain mappings for service: ${input.serviceId}`);

      const mappings = await this.serviceMappingRepository.findByServiceIdWithUrls(input.serviceId);

      // Get org domain details for each
      const mappingsWithOrgDomain = await Promise.all(
        mappings.map(async (mapping) => {
          const projectDomain = await this.projectDomainRepository.findById(mapping.projectDomainId);
          if (!projectDomain) {
            throw new ProjectDomainNotFoundError(mapping.projectDomainId);
          }
          
          const orgDomain = await this.orgDomainRepository.findById(projectDomain.organizationDomainId);
          if (!orgDomain) {
            throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
          }
          
          return {
            ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, mapping.fullUrl),
            organizationDomain: {
              id: orgDomain.id,
              domain: orgDomain.domain,
              verificationStatus: orgDomain.verificationStatus as 'verified',
            },
          };
        })
      );

      return mappingsWithOrgDomain;
    });
  }

  @Implement(domainContract.addServiceDomain)
  addServiceDomain() {
    return implement(domainContract.addServiceDomain).handler(async ({ input }) => {
      this.logger.debug(
        `Mapping service ${input.serviceId} to project domain ${input.projectDomainId} ` +
        `with subdomain: ${input.subdomain ?? 'root'}, basePath: ${input.basePath ?? '/'}`
      );

      // Verify project domain exists
      const projectDomain = await this.projectDomainRepository.findById(input.projectDomainId);
      if (!projectDomain) {
        throw new ProjectDomainNotFoundError(input.projectDomainId);
      }

      // Check subdomain availability
      const availabilityCheck = await this.conflictService.checkSubdomainAvailability(
        input.projectDomainId,
        input.subdomain ?? null,
        input.basePath ?? null
      );

      if (!availabilityCheck.available) {
        const conflicts = availabilityCheck.conflicts.map(
          c => `${c.subdomain ?? 'root'}.domain${c.basePath ?? '/'} (${c.serviceName})`
        );
        throw new SubdomainConflictError(
          input.subdomain ?? null,
          input.basePath ?? null,
          conflicts,
          availabilityCheck.suggestions.availableBasePaths
        );
      }

      // Create service domain mapping
      const mapping = await this.serviceMappingRepository.create({
        serviceId: input.serviceId,
        projectDomainId: input.projectDomainId,
        subdomain: input.subdomain,
        basePath: input.basePath,
        isPrimary: input.isPrimary,
        sslEnabled: input.sslEnabled,
        sslProvider: input.sslProvider,
      });

      // Get full URL
      const fullUrl = await this.serviceMappingRepository.getFullUrl(mapping.id);
      if (!fullUrl) {
        throw new ServiceDomainMappingNotFoundError(mapping.id);
      }
      
      // Get organization domain
      const orgDomain = await this.orgDomainRepository.findById(projectDomain.organizationDomainId);
      if (!orgDomain) {
        throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
      }

      // Check if subdomain is shared
      const sharedMappings = await this.serviceMappingRepository.findBySubdomain(
        input.projectDomainId,
        input.subdomain ?? null
      );

      const warning = sharedMappings.length > 1 ? {
        message: `This subdomain is shared with ${String(sharedMappings.length - 1)} other service(s)`,
        sharedWith: sharedMappings
          .filter(m => m.id !== mapping.id)
          .slice(0, 5)
          .map(m => ({
            serviceName: m.serviceId, // TODO: get actual service name
            fullUrl,
          })),
      } : undefined;

      return {
        mapping: {
          ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, fullUrl),
          organizationDomain: {
            id: orgDomain.id,
            domain: orgDomain.domain,
            verificationStatus: orgDomain.verificationStatus as 'verified',
          },
        },
        fullUrl,
        warning,
      };
    });
  }

  @Implement(domainContract.updateServiceDomain)
  updateServiceDomain() {
    return implement(domainContract.updateServiceDomain).handler(async ({ input }) => {
      this.logger.debug(`Updating service domain mapping: ${input.mappingId}`);

      const mapping = await this.serviceMappingRepository.findById(input.mappingId);
      if (!mapping) {
        throw new ServiceDomainMappingNotFoundError(input.mappingId);
      }

      const updateData: Record<string, unknown> = {};
      
      if (input.subdomain !== undefined) {
        updateData.subdomain = input.subdomain;
      }
      
      if (input.basePath !== undefined) {
        updateData.basePath = input.basePath;
      }
      
      if (input.isPrimary !== undefined) {
        updateData.isPrimary = input.isPrimary;
      }
      
      if (input.sslEnabled !== undefined) {
        updateData.sslEnabled = input.sslEnabled;
      }
      
      if (input.sslProvider !== undefined) {
        updateData.sslProvider = input.sslProvider;
      }

      // If changing subdomain or basePath, check availability
      if (input.subdomain !== undefined || input.basePath !== undefined) {
        const availabilityCheck = await this.conflictService.checkSubdomainAvailability(
          mapping.projectDomainId,
          input.subdomain ?? mapping.subdomain,
          input.basePath ?? mapping.basePath
        );

        if (!availabilityCheck.available) {
          const conflicts = availabilityCheck.conflicts.map(
            c => `${c.subdomain ?? 'root'}.domain${c.basePath ?? '/'} (${c.serviceName})`
          );
          throw new SubdomainConflictError(
            input.subdomain ?? mapping.subdomain,
            input.basePath ?? mapping.basePath,
            conflicts,
            availabilityCheck.suggestions.availableBasePaths
          );
        }
      }

      const updated = await this.serviceMappingRepository.update(input.mappingId, updateData);
      if (!updated) {
        throw new ServiceDomainMappingUpdateError(input.mappingId);
      }

      const fullUrl = await this.serviceMappingRepository.getFullUrl(updated.id);
      if (!fullUrl) {
        throw new ServiceDomainMappingNotFoundError(updated.id);
      }

      const projectDomain = await this.projectDomainRepository.findById(updated.projectDomainId);
      if (!projectDomain) {
        throw new ProjectDomainNotFoundError(updated.projectDomainId);
      }

      const orgDomain = await this.orgDomainRepository.findById(projectDomain.organizationDomainId);
      if (!orgDomain) {
        throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
      }

      return {
        ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
        organizationDomain: {
          id: orgDomain.id,
          domain: orgDomain.domain,
          verificationStatus: orgDomain.verificationStatus as 'verified',
        },
      };
    });
  }

  @Implement(domainContract.setPrimaryServiceDomain)
  setPrimaryServiceDomain() {
    return implement(domainContract.setPrimaryServiceDomain).handler(async ({ input }) => {
      this.logger.log(`Setting primary domain for service ${input.serviceId}: mapping ${input.mappingId}`);

      const mapping = await this.serviceMappingRepository.findById(input.mappingId);
      if (!mapping) {
        throw new ServiceDomainMappingNotFoundError(input.mappingId);
      }

      if (mapping.serviceId !== input.serviceId) {
        throw new ServiceMappingMismatchError(input.mappingId, input.serviceId);
      }

      // Unset other primary mappings for this service
      const allMappings = await this.serviceMappingRepository.findByServiceId(input.serviceId);
      await Promise.all(
        allMappings
          .filter(m => m.id !== input.mappingId && m.isPrimary)
          .map(m => this.serviceMappingRepository.update(m.id, { isPrimary: false }))
      );

      // Set this one as primary
      const updated = await this.serviceMappingRepository.update(input.mappingId, { isPrimary: true });
      if (!updated) {
        throw new SetPrimaryDomainError(input.serviceId, input.mappingId);
      }

      const fullUrl = await this.serviceMappingRepository.getFullUrl(updated.id);
      if (!fullUrl) {
        throw new ServiceDomainMappingNotFoundError(updated.id);
      }

      const projectDomain = await this.projectDomainRepository.findById(updated.projectDomainId);
      if (!projectDomain) {
        throw new ProjectDomainNotFoundError(updated.projectDomainId);
      }

      const orgDomain = await this.orgDomainRepository.findById(projectDomain.organizationDomainId);
      if (!orgDomain) {
        throw new OrganizationDomainNotFoundError(projectDomain.organizationDomainId);
      }

      return {
        ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
        organizationDomain: {
          id: orgDomain.id,
          domain: orgDomain.domain,
          verificationStatus: orgDomain.verificationStatus as 'verified',
        },
      };
    });
  }

  @Implement(domainContract.removeServiceDomain)
  removeServiceDomain() {
    return implement(domainContract.removeServiceDomain).handler(async ({ input }) => {
      this.logger.log(`Removing service domain mapping: ${input.mappingId}`);

      const mapping = await this.serviceMappingRepository.findById(input.mappingId);
      if (!mapping) {
        throw new ServiceDomainMappingNotFoundError(input.mappingId);
      }

      if (mapping.serviceId !== input.serviceId) {
        throw new ServiceMappingMismatchError(input.mappingId, input.serviceId);
      }

      const deleted = await this.serviceMappingRepository.delete(input.mappingId);
      if (!deleted) {
        throw new ServiceDomainMappingDeletionError(input.mappingId);
      }

      return {
        success: true,
        message: 'Domain mapping removed from service successfully',
      };
    });
  }
}
