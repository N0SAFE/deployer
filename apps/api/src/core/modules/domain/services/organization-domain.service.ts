import { Injectable } from '@nestjs/common';
import { OrganizationDomainRepository } from '../repositories/organization-domain.repository';
import type { organizationDomains, verificationStatusEnum, verificationMethodEnum } from '@/config/drizzle/schema/domain';

type OrganizationDomain = typeof organizationDomains.$inferSelect;
type InsertOrganizationDomain = typeof organizationDomains.$inferInsert;

@Injectable()
export class OrganizationDomainService {
  constructor(
    private readonly organizationDomainRepository: OrganizationDomainRepository,
  ) {}

  /**
   * Create a new organization domain
   */
  async create(data: InsertOrganizationDomain): Promise<OrganizationDomain> {
    return await this.organizationDomainRepository.create(data);
  }

  /**
   * Find organization domain by ID
   */
  async findById(id: string): Promise<OrganizationDomain | null> {
    return await this.organizationDomainRepository.findById(id);
  }

  /**
   * Find all domains for an organization
   */
  async findByOrganizationId(organizationId: string): Promise<OrganizationDomain[]> {
    return await this.organizationDomainRepository.findByOrganizationId(organizationId);
  }

  /**
   * Find organization domain by domain name
   */
  async findByDomain(domain: string): Promise<OrganizationDomain | null> {
    return await this.organizationDomainRepository.findByDomain(domain);
  }

  /**
   * Check if domain exists (excluding specific ID for updates)
   */
  async domainExists(domain: string, excludeId?: string): Promise<boolean> {
    return await this.organizationDomainRepository.domainExists(domain, excludeId);
  }

  /**
   * Update organization domain
   */
  async update(
    id: string,
    data: Partial<OrganizationDomain>
  ): Promise<OrganizationDomain | null> {
    return await this.organizationDomainRepository.update(id, data);
  }

  /**
   * Update verification status
   */
  async updateVerificationStatus(
    id: string,
    status: typeof verificationStatusEnum.enumValues[number],
    method?: typeof verificationMethodEnum.enumValues[number],
    verifiedAt?: Date
  ): Promise<OrganizationDomain | null> {
    return await this.organizationDomainRepository.updateVerificationStatus(
      id,
      status,
      method,
      verifiedAt,
    );
  }

  /**
   * Get pending domains for auto-verification
   */
  async findPendingDomains(): Promise<OrganizationDomain[]> {
    return await this.organizationDomainRepository.findPendingDomains();
  }

  /**
   * Get verified domains for an organization
   */
  async findVerifiedByOrganizationId(organizationId: string): Promise<OrganizationDomain[]> {
    return await this.organizationDomainRepository.findVerifiedByOrganizationId(organizationId);
  }

  /**
   * Delete organization domain
   */
  async delete(id: string): Promise<boolean> {
    return await this.organizationDomainRepository.delete(id);
  }

  /**
   * Count domains for an organization
   */
  async countByOrganizationId(organizationId: string): Promise<number> {
    return await this.organizationDomainRepository.countByOrganizationId(organizationId);
  }
}
