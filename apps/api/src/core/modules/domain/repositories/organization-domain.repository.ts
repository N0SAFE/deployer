import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import {
  organizationDomains,
  verificationStatusEnum,
  verificationMethodEnum,
} from '@/config/drizzle/schema/domain';

type OrganizationDomain = typeof organizationDomains.$inferSelect;
type InsertOrganizationDomain = typeof organizationDomains.$inferInsert;

@Injectable()
export class OrganizationDomainRepository {
  private readonly logger = new Logger(OrganizationDomainRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new organization domain
   */
  async create(data: InsertOrganizationDomain): Promise<OrganizationDomain> {
    const [domain] = await this.databaseService.db
      .insert(organizationDomains)
      .values(data)
      .returning();
    
    this.logger.debug(`Created organization domain: ${domain.domain} for org ${domain.organizationId}`);
    return domain;
  }

  /**
   * Find organization domain by ID
   */
  async findById(id: string): Promise<OrganizationDomain | null> {
    const [domain] = await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.id, id))
      .limit(1);
    
    return domain || null;
  }

  /**
   * Find all domains for an organization
   */
  async findByOrganizationId(organizationId: string): Promise<OrganizationDomain[]> {
    return await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.organizationId, organizationId));
  }

  /**
   * Find organization domain by domain name
   */
  async findByDomain(domain: string): Promise<OrganizationDomain | null> {
    const [result] = await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.domain, domain))
      .limit(1);
    
    return result || null;
  }

  /**
   * Check if domain exists (excluding specific ID for updates)
   */
  async domainExists(domain: string, excludeId?: string): Promise<boolean> {
    const conditions = excludeId
      ? and(
          eq(organizationDomains.domain, domain),
          ne(organizationDomains.id, excludeId)
        )
      : eq(organizationDomains.domain, domain);

    const [result] = await this.databaseService.db
      .select({ id: organizationDomains.id })
      .from(organizationDomains)
      .where(conditions)
      .limit(1);
    
    return !!result;
  }

  /**
   * Update organization domain
   */
  async update(
    id: string,
    data: Partial<OrganizationDomain>
  ): Promise<OrganizationDomain | null> {
    const [updated] = await this.databaseService.db
      .update(organizationDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizationDomains.id, id))
      .returning();
    
    if (updated) {
      this.logger.debug(`Updated organization domain: ${id}`);
    }
    
    return updated || null;
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
    const updateData: Partial<OrganizationDomain> = {
      verificationStatus: status,
      updatedAt: new Date(),
    };

    if (method) {
      updateData.verificationMethod = method;
    }

    if (verifiedAt) {
      updateData.verifiedAt = verifiedAt;
    }

    const [updated] = await this.databaseService.db
      .update(organizationDomains)
      .set(updateData)
      .where(eq(organizationDomains.id, id))
      .returning();
    
    if (updated) {
      this.logger.log(`Domain ${updated.domain} verification status updated to: ${status}`);
    }
    
    return updated || null;
  }

  /**
   * Get pending domains for auto-verification
   */
  async findPendingDomains(): Promise<OrganizationDomain[]> {
    return await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.verificationStatus, 'pending'));
  }

  /**
   * Get verified domains for an organization
   */
  async findVerifiedByOrganizationId(organizationId: string): Promise<OrganizationDomain[]> {
    return await this.databaseService.db
      .select()
      .from(organizationDomains)
      .where(
        and(
          eq(organizationDomains.organizationId, organizationId),
          eq(organizationDomains.verificationStatus, 'verified')
        )
      );
  }

  /**
   * Delete organization domain
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(organizationDomains)
      .where(eq(organizationDomains.id, id));
    
    const deleted = result.rowCount > 0;
    if (deleted) {
      this.logger.debug(`Deleted organization domain: ${id}`);
    }
    
    return deleted;
  }

  /**
   * Count domains for an organization
   */
  async countByOrganizationId(organizationId: string): Promise<number> {
    const result = await this.databaseService.db
      .select({ count: organizationDomains.id })
      .from(organizationDomains)
      .where(eq(organizationDomains.organizationId, organizationId));
    
    return result.length;
  }
}
