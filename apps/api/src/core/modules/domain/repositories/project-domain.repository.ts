import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import {
  projectDomains,
  organizationDomains,
} from '@/config/drizzle/schema/domain';

type ProjectDomain = typeof projectDomains.$inferSelect;
type InsertProjectDomain = typeof projectDomains.$inferInsert;

@Injectable()
export class ProjectDomainRepository {
  private readonly logger = new Logger(ProjectDomainRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new project domain
   */
  async create(data: InsertProjectDomain): Promise<ProjectDomain> {
    const [domain] = await this.databaseService.db
      .insert(projectDomains)
      .values(data)
      .returning();
    
    this.logger.debug(`Created project domain for project ${domain.projectId} using org domain ${domain.organizationDomainId}`);
    return domain;
  }

  /**
   * Find project domain by ID
   */
  async findById(id: string): Promise<ProjectDomain | null> {
    const [domain] = await this.databaseService.db
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.id, id))
      .limit(1);
    
    return domain || null;
  }

  /**
   * Find all domains for a project
   */
  async findByProjectId(projectId: string): Promise<ProjectDomain[]> {
    return await this.databaseService.db
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, projectId));
  }

  /**
   * Find project domain by project and org domain ID
   */
  async findByProjectAndOrgDomain(
    projectId: string,
    organizationDomainId: string
  ): Promise<ProjectDomain | null> {
    const [domain] = await this.databaseService.db
      .select()
      .from(projectDomains)
      .where(
        and(
          eq(projectDomains.projectId, projectId),
          eq(projectDomains.organizationDomainId, organizationDomainId)
        )
      )
      .limit(1);
    
    return domain || null;
  }

  /**
   * Check if project already has a domain mapping for this org domain
   */
  async hasProjectDomainMapping(
    projectId: string,
    organizationDomainId: string,
    excludeId?: string
  ): Promise<boolean> {
    const baseConditions = [
      eq(projectDomains.projectId, projectId),
      eq(projectDomains.organizationDomainId, organizationDomainId),
    ];

    if (excludeId) {
      baseConditions.push(ne(projectDomains.id, excludeId));
    }

    const [result] = await this.databaseService.db
      .select({ id: projectDomains.id })
      .from(projectDomains)
      .where(and(...baseConditions))
      .limit(1);
    
    return !!result;
  }

  /**
   * Get available verified domains for a project
   * This shows which org domains the project hasn't used yet
   */
  async getAvailableDomainsForProject(projectId: string): Promise<{
    organizationDomainId: string;
    domain: string;
    organizationId: string;
  }[]> {
    // Get the project's owner organization through organization_domains
    // We need to find what organization this project belongs to
    const existingProjectDomains = await this.databaseService.db
      .select({
        organizationId: organizationDomains.organizationId,
        organizationDomainId: organizationDomains.id,
      })
      .from(projectDomains)
      .innerJoin(organizationDomains, eq(projectDomains.organizationDomainId, organizationDomains.id))
      .where(eq(projectDomains.projectId, projectId))
      .limit(1);

    if (existingProjectDomains.length === 0) {
      // Project has no domains yet, can't determine organization
      // This should be handled at a higher level
      return [];
    }

    const orgId = existingProjectDomains[0].organizationId;

    // Get all verified domains for the organization
    const allOrgDomains = await this.databaseService.db
      .select({
        organizationDomainId: organizationDomains.id,
        domain: organizationDomains.domain,
        organizationId: organizationDomains.organizationId,
      })
      .from(organizationDomains)
      .where(
        and(
          eq(organizationDomains.organizationId, orgId),
          eq(organizationDomains.verificationStatus, 'verified')
        )
      );

    // Filter out domains already used by this project
    const usedDomainIds = await this.databaseService.db
      .select({ organizationDomainId: projectDomains.organizationDomainId })
      .from(projectDomains)
      .where(eq(projectDomains.projectId, projectId));

    const usedIds = new Set(usedDomainIds.map(d => d.organizationDomainId));

    return allOrgDomains.filter(d => !usedIds.has(d.organizationDomainId));
  }

  /**
   * Update project domain
   */
  async update(
    id: string,
    data: Partial<ProjectDomain>
  ): Promise<ProjectDomain | null> {
    const [updated] = await this.databaseService.db
      .update(projectDomains)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projectDomains.id, id))
      .returning();
    
    if (updated) {
      this.logger.debug(`Updated project domain: ${id}`);
    }
    
    return updated || null;
  }

  /**
   * Update allowed subdomains for a project domain
   */
  async updateAllowedSubdomains(
    id: string,
    allowedSubdomains: string[]
  ): Promise<ProjectDomain | null> {
    const [updated] = await this.databaseService.db
      .update(projectDomains)
      .set({ allowedSubdomains, updatedAt: new Date() })
      .where(eq(projectDomains.id, id))
      .returning();
    
    if (updated) {
      this.logger.log(`Updated allowed subdomains for project domain ${id}: [${allowedSubdomains.join(', ')}]`);
    }
    
    return updated || null;
  }

  /**
   * Delete project domain
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(projectDomains)
      .where(eq(projectDomains.id, id));
    
    const deleted = result.rowCount > 0;
    if (deleted) {
      this.logger.debug(`Deleted project domain: ${id}`);
    }
    
    return deleted;
  }

  /**
   * Count domains for a project
   */
  async countByProjectId(projectId: string): Promise<number> {
    const result = await this.databaseService.db
      .select({ count: projectDomains.id })
      .from(projectDomains)
      .where(eq(projectDomains.projectId, projectId));
    
    return result.length;
  }

  /**
   * Count domains using a specific organization domain
   */
  async countByOrganizationDomainId(organizationDomainId: string): Promise<number> {
    const result = await this.databaseService.db
      .select({ count: projectDomains.id })
      .from(projectDomains)
      .where(eq(projectDomains.organizationDomainId, organizationDomainId));
    
    return result.length;
  }
}
