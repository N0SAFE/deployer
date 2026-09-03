import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne, isNull } from 'drizzle-orm';
import { GlobalDatabaseService } from '@/core/modules/database/services/global-database.service';
import { AppError } from "@repo/errors";
import {
  serviceDomainMappings,
  projectDomains,
} from '@/config/drizzle/global/schema/domain';
import { previewEnvironments } from '@/config/drizzle/global/schema/deployment';

type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;
type InsertServiceDomainMapping = typeof serviceDomainMappings.$inferInsert;

@Injectable()
export class ServiceDomainMappingRepository {
  private readonly logger = new Logger(ServiceDomainMappingRepository.name);

  constructor(private readonly databaseService: GlobalDatabaseService) {}

  /**
   * Create a new service domain mapping
   */
  async create(data: InsertServiceDomainMapping): Promise<ServiceDomainMapping> {
    const [mapping] = await this.databaseService.db
      .insert(serviceDomainMappings)
      .values(data)
      .returning();
    
    if (!mapping) {
      throw new AppError('Failed to create service domain mapping', 'INTERNAL_ERROR');
    }
    
    this.logger.debug(
      `Created service domain mapping for service ${mapping.serviceId}: ` +
      `${mapping.subdomain ?? ''}${mapping.subdomain ? '.' : ''}[project-domain]${mapping.basePath ?? ''}`
    );
    return mapping;
  }

  /**
   * Find service domain mapping by ID
   */
  async findById(id: string): Promise<ServiceDomainMapping | null> {
    const [mapping] = await this.databaseService.db
      .select()
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.id, id))
      .limit(1);
    
    return mapping ?? null;
  }

  /**
   * Find all mappings for a service
   */
  async findByServiceId(serviceId: string): Promise<ServiceDomainMapping[]> {
    return await this.databaseService.db
      .select()
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.serviceId, serviceId));
  }

  /**
   * Find all mappings for a project domain
   */
  async findByProjectDomainId(projectDomainId: string): Promise<ServiceDomainMapping[]> {
    return await this.databaseService.db
      .select()
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.projectDomainId, projectDomainId));
  }

  /**
   * Find mapping by service and project domain
   */
  async findByServiceAndProjectDomain(
    serviceId: string,
    projectDomainId: string
  ): Promise<ServiceDomainMapping | null> {
    const [mapping] = await this.databaseService.db
      .select()
      .from(serviceDomainMappings)
      .where(
        and(
          eq(serviceDomainMappings.serviceId, serviceId),
          eq(serviceDomainMappings.projectDomainId, projectDomainId)
        )
      )
      .limit(1);
    
    return mapping ?? null;
  }

  /**
   * Check if subdomain+basePath combination is available
   */
  async isCombinationAvailable(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string,
    excludeId?: string
  ): Promise<boolean> {
    const baseConditions = [
      eq(serviceDomainMappings.projectDomainId, projectDomainId),
      subdomain === null 
        ? isNull(serviceDomainMappings.subdomain) 
        : eq(serviceDomainMappings.subdomain, subdomain),
      eq(serviceDomainMappings.basePath, basePath),
    ];

    if (excludeId) {
      baseConditions.push(ne(serviceDomainMappings.id, excludeId));
    }

    const [result] = await this.databaseService.db
      .select({ id: serviceDomainMappings.id })
      .from(serviceDomainMappings)
      .where(and(...baseConditions))
      .limit(1);
    
    return !result; // Available if no result found
  }

  /**
   * True when the project domain has at least one service mapping
   */
  async hasProjectDomainMappings(projectDomainId: string): Promise<boolean> {
    const [result] = await this.databaseService.db
      .select({ id: serviceDomainMappings.id })
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.projectDomainId, projectDomainId))
      .limit(1);
    return !!result;
  }

  /**
   * Get full URL for a service domain mapping
   */
  async getFullUrl(mappingId: string): Promise<string | null> {
    const result = await this.databaseService.db
      .select({
        subdomain: serviceDomainMappings.subdomain,
        basePath: serviceDomainMappings.basePath,
        orgDomain: projectDomains.domain,
      })
      .from(serviceDomainMappings)
      .innerJoin(projectDomains, eq(serviceDomainMappings.projectDomainId, projectDomains.id))
      .where(eq(serviceDomainMappings.id, mappingId))
      .limit(1);

    const row = result[0];
    if (!row) {
      return null;
    }
    
    const { subdomain, basePath, orgDomain } = row;
    
    // Default to HTTPS for security
    const protocol = 'https';
    const serviceSubdomain = subdomain ?? '';
    
    // Build domain: [service-subdomain].org-domain.com
    const domain = serviceSubdomain 
      ? `${serviceSubdomain}.${orgDomain}`
      : orgDomain;
    
    return `${protocol}://${domain}${basePath ?? ''}`;
  }

  /**
   * Get all mappings for a service with full URLs
   */
  async findByServiceIdWithUrls(serviceId: string): Promise<(ServiceDomainMapping & { fullUrl: string })[]> {
    const mappings = await this.findByServiceId(serviceId);
    
    const mappingsWithUrls = await Promise.all(
      mappings.map(async (mapping) => {
        const fullUrl = await this.getFullUrl(mapping.id);
        return {
          ...mapping,
          fullUrl: fullUrl ?? '',
        };
      })
    );

    return mappingsWithUrls;
  }

  /**
   * Update service domain mapping
   */
  async update(
    id: string,
    data: Partial<ServiceDomainMapping>
  ): Promise<ServiceDomainMapping | null> {
    const [updated] = await this.databaseService.db
      .update(serviceDomainMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(serviceDomainMappings.id, id))
      .returning();
    
    if (updated) {
      this.logger.debug(`Updated service domain mapping: ${id}`);
    }
    
    return updated ?? null;
  }

  /**
   * Delete service domain mapping
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(serviceDomainMappings)
      .where(eq(serviceDomainMappings.id, id));
    
    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      this.logger.debug(`Deleted service domain mapping: ${id}`);
    }
    
    return deleted;
  }

  /**
   * Count mappings for a service
   */
  async countByServiceId(serviceId: string): Promise<number> {
    const result = await this.databaseService.db
      .select({ count: serviceDomainMappings.id })
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.serviceId, serviceId));
    
    return result.length;
  }

  /**
   * Count mappings for a project domain
   */
  async countByProjectDomainId(projectDomainId: string): Promise<number> {
    const result = await this.databaseService.db
      .select({ count: serviceDomainMappings.id })
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.projectDomainId, projectDomainId));
    
    return result.length;
  }

  /**
   * Find mappings by subdomain (useful for conflict detection)
   */
  async findBySubdomain(
    projectDomainId: string,
    subdomain: string | null
  ): Promise<ServiceDomainMapping[]> {
    return await this.databaseService.db
      .select()
      .from(serviceDomainMappings)
      .where(
        and(
          eq(serviceDomainMappings.projectDomainId, projectDomainId),
          subdomain === null 
            ? isNull(serviceDomainMappings.subdomain) 
            : eq(serviceDomainMappings.subdomain, subdomain)
        )
      );
  }

  /**
   * Joined mapping + project-domain rows for a service,
   * ordered by mapping creation (oldest first). Used by URL resolution.
   */
  async findServiceUrlRows(serviceId: string) {
    return this.databaseService.db
      .select({
        mappingId: serviceDomainMappings.id,
        subdomain: serviceDomainMappings.subdomain,
        basePath: serviceDomainMappings.basePath,
        isPrimary: serviceDomainMappings.isPrimary,
        sslEnabled: serviceDomainMappings.sslEnabled,
        sslProvider: serviceDomainMappings.sslProvider,
        orgDomain: projectDomains.domain,
      })
      .from(serviceDomainMappings)
      .innerJoin(projectDomains, eq(serviceDomainMappings.projectDomainId, projectDomains.id))
      .where(eq(serviceDomainMappings.serviceId, serviceId))
      .orderBy(serviceDomainMappings.createdAt);
  }

  /** The project-domain id a mapping belongs to (or null when the mapping is gone). */
  async findProjectDomainIdByMappingId(mappingId: string): Promise<string | null> {
    const [row] = await this.databaseService.db
      .select({ projectDomainId: serviceDomainMappings.projectDomainId })
      .from(serviceDomainMappings)
      .where(eq(serviceDomainMappings.id, mappingId))
      .limit(1);
    return row?.projectDomainId ?? null;
  }

  /**
   * Mark every preview-environment row pointing at `fullDomain` inactive.
   * Part of the promote-preview-to-stable flow: once a stable mapping exists,
   * the superseded preview row must not linger as active. Reads/writes the
   * global schema directly — this repository is the routing domain's
   * data-access layer and must not import product modules.
   */
  async deactivatePreviewEnvironmentsByFullDomain(fullDomain: string): Promise<void> {
    await this.databaseService.db
      .update(previewEnvironments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(previewEnvironments.fullDomain, fullDomain));
  }

  /**
   * Find mappings by project domain with subdomain and optional basePath (with service names)
   */
  async findByProjectDomainAndPathWithServiceNames(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<{
    serviceId: string;
    serviceName: string;
    subdomain: string | null;
    basePath: string | null;
  }[]> {
    const { services } = await import('@/config/drizzle/global/schema');
    
    const conditions = [
      eq(serviceDomainMappings.projectDomainId, projectDomainId),
      subdomain === null 
        ? isNull(serviceDomainMappings.subdomain)
        : eq(serviceDomainMappings.subdomain, subdomain),
    ];

    if (excludeServiceId) {
      conditions.push(ne(serviceDomainMappings.serviceId, excludeServiceId));
    }

    return await this.databaseService.db
      .select({
        serviceId: serviceDomainMappings.serviceId,
        serviceName: services.name,
        subdomain: serviceDomainMappings.subdomain,
        basePath: serviceDomainMappings.basePath,
      })
      .from(serviceDomainMappings)
      .innerJoin(services, eq(services.id, serviceDomainMappings.serviceId))
      .where(and(...conditions));
  }
}
