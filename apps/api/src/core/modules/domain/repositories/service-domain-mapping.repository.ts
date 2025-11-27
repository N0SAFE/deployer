import { Injectable, Logger } from '@nestjs/common';
import { eq, and, ne, isNull } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import {
  serviceDomainMappings,
  projectDomains,
  organizationDomains,
} from '@/config/drizzle/schema/domain';

type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;
type InsertServiceDomainMapping = typeof serviceDomainMappings.$inferInsert;

@Injectable()
export class ServiceDomainMappingRepository {
  private readonly logger = new Logger(ServiceDomainMappingRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new service domain mapping
   */
  async create(data: InsertServiceDomainMapping): Promise<ServiceDomainMapping> {
    const [mapping] = await this.databaseService.db
      .insert(serviceDomainMappings)
      .values(data)
      .returning();
    
    this.logger.debug(
      `Created service domain mapping for service ${mapping.serviceId}: ` +
      `${mapping.subdomain || ''}${mapping.subdomain ? '.' : ''}[project-domain]${mapping.basePath}`
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
    
    return mapping || null;
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
    
    return mapping || null;
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
   * Get full URL for a service domain mapping
   */
  async getFullUrl(mappingId: string): Promise<string | null> {
    const result = await this.databaseService.db
      .select({
        subdomain: serviceDomainMappings.subdomain,
        basePath: serviceDomainMappings.basePath,
        orgDomain: organizationDomains.domain,
      })
      .from(serviceDomainMappings)
      .innerJoin(projectDomains, eq(serviceDomainMappings.projectDomainId, projectDomains.id))
      .innerJoin(organizationDomains, eq(projectDomains.organizationDomainId, organizationDomains.id))
      .where(eq(serviceDomainMappings.id, mappingId))
      .limit(1);

    if (!result || result.length === 0) {
      return null;
    }

    const { subdomain, basePath, orgDomain } = result[0];
    
    // Default to HTTPS for security
    const protocol = 'https';
    const serviceSubdomain = subdomain || '';
    
    // Build domain: [service-subdomain].org-domain.com
    const domain = serviceSubdomain 
      ? `${serviceSubdomain}.${orgDomain}`
      : orgDomain;
    
    return `${protocol}://${domain}${basePath}`;
  }

  /**
   * Get all mappings for a service with full URLs
   */
  async findByServiceIdWithUrls(serviceId: string): Promise<Array<ServiceDomainMapping & { fullUrl: string }>> {
    const mappings = await this.findByServiceId(serviceId);
    
    const mappingsWithUrls = await Promise.all(
      mappings.map(async (mapping) => {
        const fullUrl = await this.getFullUrl(mapping.id);
        return {
          ...mapping,
          fullUrl: fullUrl || '',
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
    
    return updated || null;
  }

  /**
   * Delete service domain mapping
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(serviceDomainMappings)
      .where(eq(serviceDomainMappings.id, id));
    
    const deleted = result.rowCount > 0;
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
   * Find mappings by project domain with subdomain and optional basePath (with service names)
   */
  async findByProjectDomainAndPathWithServiceNames(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<Array<{
    serviceId: string;
    serviceName: string;
    subdomain: string | null;
    basePath: string | null;
  }>> {
    const { services } = await import('@/config/drizzle/schema');
    
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
