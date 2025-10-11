import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { domainContract } from '@repo/api-contracts';
import { ProjectDomainRepository } from '../repositories/project-domain.repository';
import { OrganizationDomainRepository } from '../repositories/organization-domain.repository';
import { ServiceDomainMappingRepository } from '../repositories/service-domain-mapping.repository';
import { DomainAdapter } from '../adapters/domain.adapter';

@Controller()
export class ProjectDomainController {
  private readonly logger = new Logger(ProjectDomainController.name);

  constructor(
    private readonly projectDomainRepository: ProjectDomainRepository,
    private readonly orgDomainRepository: OrganizationDomainRepository,
    private readonly serviceMappingRepository: ServiceDomainMappingRepository,
  ) {}

  @Implement(domainContract.addProjectDomain)
  addProjectDomain() {
    return implement(domainContract.addProjectDomain).handler(async ({ input }) => {
      this.logger.debug(`Assigning domain ${input.organizationDomainId} to project ${input.projectId}`);

      // Verify the organization domain exists and is verified
      const orgDomain = await this.orgDomainRepository.findById(input.organizationDomainId);
      if (!orgDomain) {
        throw new Error(`Organization domain ${input.organizationDomainId} not found`);
      }

      if (orgDomain.verificationStatus !== 'verified') {
        throw new Error(`Domain ${orgDomain.domain} is not verified. Please verify the domain first.`);
      }

      // Check if project already uses this domain
      const existing = await this.projectDomainRepository.findByProjectAndOrgDomain(
        input.projectId,
        input.organizationDomainId
      );

      if (existing) {
        throw new Error(`Project already uses domain ${orgDomain.domain}`);
      }

      // Create project domain
      const projectDomain = await this.projectDomainRepository.create({
        projectId: input.projectId,
        organizationDomainId: input.organizationDomainId,
        allowedSubdomains: input.allowedSubdomains || [],
        isPrimary: input.isPrimary || false,
      });

      return {
        projectDomain: {
          ...DomainAdapter.toProjectDomainContract(projectDomain),
          organizationDomain: DomainAdapter.toOrganizationDomainContract(orgDomain),
        },
        suggestions: {
          commonSubdomains: ['api', 'www', 'app', 'admin', 'staging'],
          wildcardOption: '*',
        },
      };
    });
  }

  @Implement(domainContract.listProjectDomains)
  listProjectDomains() {
    return implement(domainContract.listProjectDomains).handler(async ({ input }) => {
      this.logger.debug(`Fetching domains for project: ${input.projectId}`);

      const projectDomains = await this.projectDomainRepository.findByProjectId(input.projectId);

      // Fetch organization domain details for each
      const domainsWithDetails = await Promise.all(
        projectDomains.map(async (pd) => {
          const orgDomain = await this.orgDomainRepository.findById(pd.organizationDomainId);
          return {
            ...DomainAdapter.toProjectDomainContract(pd),
            organizationDomain: DomainAdapter.toOrganizationDomainContract(orgDomain!),
          };
        })
      );

      return domainsWithDetails;
    });
  }

  @Implement(domainContract.getAvailableDomains)
  getAvailableDomains() {
    return implement(domainContract.getAvailableDomains).handler(async ({ input }) => {
      this.logger.debug(`Fetching available domains for project: ${input.projectId}`);

      const availableDomains = await this.projectDomainRepository.getAvailableDomainsForProject(
        input.projectId
      );

      // Get full org domain details for each
      const domainsWithDetails = await Promise.all(
        availableDomains.map(async (d) => {
          const orgDomain = await this.orgDomainRepository.findById(d.organizationDomainId);
          if (!orgDomain || orgDomain.verificationStatus !== 'verified' || !orgDomain.verifiedAt) {
            return null;
          }
          
          // Check if already selected by this project
          const alreadySelected = await this.projectDomainRepository.hasProjectDomainMapping(
            input.projectId,
            d.organizationDomainId
          );

          return {
            id: orgDomain.id,
            domain: orgDomain.domain,
            verificationStatus: 'verified' as const,
            verifiedAt: orgDomain.verifiedAt,
            alreadySelected,
          };
        })
      );

      return domainsWithDetails.filter((d): d is NonNullable<typeof d> => d !== null);
    });
  }

  @Implement(domainContract.updateProjectDomain)
  updateProjectDomain() {
    return implement(domainContract.updateProjectDomain).handler(async ({ input }) => {
      this.logger.debug(`Updating project domain: ${input.domainId}`);

      const projectDomain = await this.projectDomainRepository.findById(input.domainId);
      if (!projectDomain) {
        throw new Error(`Project domain ${input.domainId} not found`);
      }

      const updateData: Record<string, any> = {};
      
      if (input.allowedSubdomains !== undefined) {
        updateData.allowedSubdomains = input.allowedSubdomains;
      }
      
      if (input.isPrimary !== undefined) {
        updateData.isPrimary = input.isPrimary;
      }

      const updated = await this.projectDomainRepository.update(input.domainId, updateData);
      if (!updated) {
        throw new Error(`Failed to update project domain ${input.domainId}`);
      }

      const orgDomain = await this.orgDomainRepository.findById(updated.organizationDomainId);

      return {
        ...DomainAdapter.toProjectDomainContract(updated),
        organizationDomain: DomainAdapter.toOrganizationDomainContract(orgDomain!),
      };
    });
  }

  @Implement(domainContract.removeProjectDomain)
  removeProjectDomain() {
    return implement(domainContract.removeProjectDomain).handler(async ({ input }) => {
      this.logger.log(`Removing project domain: ${input.domainId}`);

      const projectDomain = await this.projectDomainRepository.findById(input.domainId);
      if (!projectDomain) {
        throw new Error(`Project domain ${input.domainId} not found`);
      }

      // Count affected services (cascade deletes)
      const affectedServices = await this.serviceMappingRepository.countByProjectDomainId(input.domainId);

      const deleted = await this.projectDomainRepository.delete(input.domainId);
      if (!deleted) {
        throw new Error(`Failed to delete project domain ${input.domainId}`);
      }

      return {
        success: true,
        message: 'Domain removed from project successfully',
        affectedServices,
      };
    });
  }
}
