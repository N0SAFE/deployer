import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { domainContract } from '@repo/api-contracts';
import { OrganizationDomainRepository } from '../repositories/organization-domain.repository';
import { DomainVerificationService } from '../services/domain-verification.service';
import { DomainAdapter } from '../adapters/domain.adapter';

@Controller()
export class OrganizationDomainController {
  private readonly logger = new Logger(OrganizationDomainController.name);

  constructor(
    private readonly orgDomainRepository: OrganizationDomainRepository,
    private readonly verificationService: DomainVerificationService,
  ) {}

  @Implement(domainContract.addOrganizationDomain)
  addOrganizationDomain() {
    return implement(domainContract.addOrganizationDomain).handler(async ({ input }) => {
      this.logger.debug(`Creating organization domain: ${input.domain} for org ${input.organizationId}`);

      // Check if domain already exists
      const existing = await this.orgDomainRepository.findByDomain(input.domain);
      if (existing) {
        throw new Error(`Domain ${input.domain} is already registered`);
      }

      // Generate verification token and instructions
      const token = this.verificationService.generateVerificationToken();
      const instructions = this.verificationService.getVerificationInstructions(
        input.domain,
        token,
        input.verificationMethod
      );

      // Create the domain record
      const domain = await this.orgDomainRepository.create({
        organizationId: input.organizationId,
        domain: input.domain,
        verificationToken: token,
        verificationStatus: 'pending',
        verificationMethod: input.verificationMethod,
      });

      return DomainAdapter.toAddDomainResponse(domain, instructions);
    });
  }

  @Implement(domainContract.listOrganizationDomains)
  listOrganizationDomains() {
    return implement(domainContract.listOrganizationDomains).handler(async ({ input }) => {
      this.logger.debug(`Fetching domains for organization: ${input.organizationId}`);

      let domains = await this.orgDomainRepository.findByOrganizationId(input.organizationId);

      // Filter by verification status if provided
      if (input.verificationStatus) {
        domains = domains.filter(d => d.verificationStatus === input.verificationStatus);
      }

      return domains.map(domain => DomainAdapter.toOrganizationDomainContract(domain));
    });
  }

  @Implement(domainContract.getOrganizationDomain)
  getOrganizationDomain() {
    return implement(domainContract.getOrganizationDomain).handler(async ({ input }) => {
      this.logger.debug(`Fetching organization domain: ${input.domainId}`);

      const domain = await this.orgDomainRepository.findById(input.domainId);
      if (!domain) {
        throw new Error(`Organization domain ${input.domainId} not found`);
      }

      return DomainAdapter.toOrganizationDomainContract(domain);
    });
  }

  @Implement(domainContract.verifyOrganizationDomain)
  verifyOrganizationDomain() {
    return implement(domainContract.verifyOrganizationDomain).handler(async ({ input }) => {
      this.logger.log(`Verifying domain: ${input.domainId}`);

      const domain = await this.orgDomainRepository.findById(input.domainId);
      if (!domain) {
        throw new Error(`Domain ${input.domainId} not found`);
      }

      // Perform verification
      const result = await this.verificationService.verifyDomain(domain.id);

      if (result.success && result.status === 'verified') {
        // Update verification status
        await this.orgDomainRepository.updateVerificationStatus(
          domain.id,
          'verified',
          domain.verificationMethod!,
          result.verifiedAt
        );
      } else {
        // Update to failed status
        await this.orgDomainRepository.updateVerificationStatus(
          domain.id,
          'failed',
          domain.verificationMethod!
        );
      }

      return DomainAdapter.toVerifyDomainResponse(result);
    });
  }

  @Implement(domainContract.deleteOrganizationDomain)
  deleteOrganizationDomain() {
    return implement(domainContract.deleteOrganizationDomain).handler(async ({ input }) => {
      this.logger.log(`Deleting organization domain: ${input.domainId}`);

      const domain = await this.orgDomainRepository.findById(input.domainId);
      if (!domain) {
        throw new Error(`Domain ${input.domainId} not found`);
      }

      const deleted = await this.orgDomainRepository.delete(input.domainId);
      if (!deleted) {
        throw new Error(`Failed to delete domain ${input.domainId}`);
      }

      return {
        success: true,
        message: `Domain ${domain.domain} deleted successfully`,
      };
    });
  }
}
