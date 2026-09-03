import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import { GlobalDatabaseService } from '@/core/modules/database/services/global-database.service';
import { AppError } from "@repo/errors";
import {
  projectDomains,
} from '@/config/drizzle/global/schema/domain';

type ProjectDomain = typeof projectDomains.$inferSelect;
type InsertProjectDomain = typeof projectDomains.$inferInsert;

@Injectable()
export class ProjectDomainRepository {
  private readonly logger = new Logger(ProjectDomainRepository.name);

  constructor(private readonly databaseService: GlobalDatabaseService) {}

  /**
   * Create a new project domain (domains attach directly to a project)
   */
  async create(data: InsertProjectDomain): Promise<ProjectDomain> {
    const [domain] = await this.databaseService.db
      .insert(projectDomains)
      .values(data)
      .returning();
    
    if (!domain) {
      throw new AppError('Failed to create project domain', 'INTERNAL_ERROR');
    }
    
    this.logger.debug(`Created project domain ${domain.domain} for project ${domain.projectId}`);
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
    
    return domain ?? null;
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
   * Find project domain by project and domain name
   */
  async findByProjectAndDomain(
    projectId: string,
    domain: string
  ): Promise<ProjectDomain | null> {
    const [row] = await this.databaseService.db
      .select()
      .from(projectDomains)
      .where(
        and(
          eq(projectDomains.projectId, projectId),
          eq(projectDomains.domain, domain)
        )
      )
      .limit(1);
    
    return row ?? null;
  }

  /**
   * Check if project already has this domain name
   */
  async hasProjectDomain(
    projectId: string,
    domain: string,
    excludeId?: string
  ): Promise<boolean> {
    const baseConditions = [
      eq(projectDomains.projectId, projectId),
      eq(projectDomains.domain, domain),
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
   * Find all pending project domains (for auto-verification sweeps)
   */
  async findPending(): Promise<ProjectDomain[]> {
    return await this.databaseService.db
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.verificationStatus, 'pending'));
  }

  /**
   * Get the project's OWN verified domains (direct-domain model — no org).
   */
  async getAvailableDomainsForProject(projectId: string): Promise<Array<{
    id: string;
    domain: string;
    verifiedAt: Date;
  }>> {
    const rows = await this.databaseService.db
      .select({
        id: projectDomains.id,
        domain: projectDomains.domain,
        verifiedAt: projectDomains.verifiedAt,
      })
      .from(projectDomains)
      .where(
        and(
          eq(projectDomains.projectId, projectId),
          eq(projectDomains.verificationStatus, 'verified')
        )
      );
    
    return rows.filter((d): d is typeof d & { verifiedAt: Date } => d.verifiedAt !== null);
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
    
    return updated ?? null;
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
    
    return updated ?? null;
  }

  /**
   * Delete project domain
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(projectDomains)
      .where(eq(projectDomains.id, id));
    
    const deleted = (result.rowCount ?? 0) > 0;
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


}
