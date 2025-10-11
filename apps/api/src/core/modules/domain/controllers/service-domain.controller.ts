import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { domainContract } from '@repo/api-contracts';
import { ServiceDomainMappingRepository } from '../repositories/service-domain-mapping.repository';
import { ProjectDomainRepository } from '../repositories/project-domain.repository';
import { OrganizationDomainRepository } from '../repositories/organization-domain.repository';
import { DomainConflictService } from '../services/domain-conflict.service';
import { DomainAdapter } from '../adapters/domain.adapter';

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
        `subdomain=${input.subdomain}, basePath=${input.basePath || '/'}`
      );

      return await this.conflictService.checkSubdomainAvailability(
        input.projectDomainId,
        input.subdomain,
        input.basePath || null,
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
          const orgDomain = await this.orgDomainRepository.findById(projectDomain!.organizationDomainId);
          
          return {
            ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, mapping.fullUrl),
            organizationDomain: {
              id: orgDomain!.id,
              domain: orgDomain!.domain,
              verificationStatus: orgDomain!.verificationStatus as 'verified',
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
        `with subdomain: ${input.subdomain || 'root'}, basePath: ${input.basePath || '/'}`
      );

      // Verify project domain exists
      const projectDomain = await this.projectDomainRepository.findById(input.projectDomainId);
      if (!projectDomain) {
        throw new Error(`Project domain ${input.projectDomainId} not found`);
      }

      // Check subdomain availability
      const availabilityCheck = await this.conflictService.checkSubdomainAvailability(
        input.projectDomainId,
        input.subdomain,
        input.basePath || null
      );

      if (!availabilityCheck.available) {
        const suggestions = availabilityCheck.suggestions?.availableBasePaths?.join(', ') || 'none available';
        throw new Error(
          `Subdomain+path combination already in use. ` +
          `Available base paths: ${suggestions}`
        );
      }

      // Create service domain mapping
      const mapping = await this.serviceMappingRepository.create({
        serviceId: input.serviceId,
        projectDomainId: input.projectDomainId,
        subdomain: input.subdomain,
        basePath: input.basePath || null,
        isPrimary: input.isPrimary || false,
        sslEnabled: input.sslEnabled !== undefined ? input.sslEnabled : true,
        sslProvider: input.sslProvider || 'letsencrypt',
      });

      // Get full URL
      const fullUrl = await this.serviceMappingRepository.getFullUrl(mapping.id);
      
      // Get organization domain
      const orgDomain = await this.orgDomainRepository.findById(projectDomain.organizationDomainId);

      // Check if subdomain is shared
      const sharedMappings = await this.serviceMappingRepository.findBySubdomain(
        input.projectDomainId,
        input.subdomain
      );

      const warning = sharedMappings.length > 1 ? {
        message: `This subdomain is shared with ${sharedMappings.length - 1} other service(s)`,
        sharedWith: sharedMappings
          .filter(m => m.id !== mapping.id)
          .slice(0, 5)
          .map(m => ({
            serviceName: m.serviceId, // TODO: get actual service name
            fullUrl: fullUrl || '',
          })),
      } : undefined;

      return {
        mapping: {
          ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, fullUrl!),
          organizationDomain: {
            id: orgDomain!.id,
            domain: orgDomain!.domain,
            verificationStatus: orgDomain!.verificationStatus as 'verified',
          },
        },
        fullUrl: fullUrl!,
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
        throw new Error(`Service domain mapping ${input.mappingId} not found`);
      }

      const updateData: Record<string, any> = {};
      
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
          input.subdomain !== undefined ? input.subdomain : mapping.subdomain,
          input.basePath !== undefined ? input.basePath : mapping.basePath
        );

        if (!availabilityCheck.available) {
          const suggestions = availabilityCheck.suggestions?.availableBasePaths?.join(', ') || 'none available';
          throw new Error(
            `Subdomain+path combination already in use. ` +
            `Available base paths: ${suggestions}`
          );
        }
      }

      const updated = await this.serviceMappingRepository.update(input.mappingId, updateData);
      if (!updated) {
        throw new Error(`Failed to update service domain mapping ${input.mappingId}`);
      }

      const fullUrl = await this.serviceMappingRepository.getFullUrl(updated.id);
      const projectDomain = await this.projectDomainRepository.findById(updated.projectDomainId);
      const orgDomain = await this.orgDomainRepository.findById(projectDomain!.organizationDomainId);

      return {
        ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl!),
        organizationDomain: {
          id: orgDomain!.id,
          domain: orgDomain!.domain,
          verificationStatus: orgDomain!.verificationStatus as 'verified',
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
        throw new Error(`Service domain mapping ${input.mappingId} not found`);
      }

      if (mapping.serviceId !== input.serviceId) {
        throw new Error(`Mapping ${input.mappingId} does not belong to service ${input.serviceId}`);
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
        throw new Error(`Failed to set primary domain`);
      }

      const fullUrl = await this.serviceMappingRepository.getFullUrl(updated.id);
      const projectDomain = await this.projectDomainRepository.findById(updated.projectDomainId);
      const orgDomain = await this.orgDomainRepository.findById(projectDomain!.organizationDomainId);

      return {
        ...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl!),
        organizationDomain: {
          id: orgDomain!.id,
          domain: orgDomain!.domain,
          verificationStatus: orgDomain!.verificationStatus as 'verified',
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
        throw new Error(`Service domain mapping ${input.mappingId} not found`);
      }

      if (mapping.serviceId !== input.serviceId) {
        throw new Error(`Mapping ${input.mappingId} does not belong to service ${input.serviceId}`);
      }

      const deleted = await this.serviceMappingRepository.delete(input.mappingId);
      if (!deleted) {
        throw new Error(`Failed to delete service domain mapping ${input.mappingId}`);
      }

      return {
        success: true,
        message: 'Domain mapping removed from service successfully',
      };
    });
  }
}
