import { Injectable } from '@nestjs/common';
import { ServiceDomainMappingRepository } from '../repositories/service-domain-mapping.repository';
import type { serviceDomainMappings } from '@/config/drizzle/schema';

type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;
type InsertServiceDomainMapping = typeof serviceDomainMappings.$inferInsert;

export interface ServiceDomainMappingWithUrls extends ServiceDomainMapping {
  fullUrl: string;
  internalUrl?: string;
}

@Injectable()
export class ServiceDomainMappingService {
  constructor(
    private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
  ) {}

  /**
   * Create a new service domain mapping
   */
  async create(data: InsertServiceDomainMapping): Promise<ServiceDomainMapping> {
    return await this.serviceDomainMappingRepository.create(data);
  }

  /**
   * Find service domain mapping by ID
   */
  async findById(id: string): Promise<ServiceDomainMapping | null> {
    return await this.serviceDomainMappingRepository.findById(id);
  }

  /**
   * Find all mappings for a service
   */
  async findByServiceId(serviceId: string): Promise<ServiceDomainMapping[]> {
    return await this.serviceDomainMappingRepository.findByServiceId(serviceId);
  }

  /**
   * Find all mappings for a service with computed URLs
   */
  async findByServiceIdWithUrls(serviceId: string): Promise<ServiceDomainMappingWithUrls[]> {
    return await this.serviceDomainMappingRepository.findByServiceIdWithUrls(serviceId);
  }

  /**
   * Find all mappings for a project domain
   */
  async findByProjectDomainId(projectDomainId: string): Promise<ServiceDomainMapping[]> {
    return await this.serviceDomainMappingRepository.findByProjectDomainId(projectDomainId);
  }

  /**
   * Find mappings by project domain with subdomain/basePath
   */
  async findByProjectDomainAndPath(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<ServiceDomainMapping[]> {
    // Use the correct repository method that returns service names
    const results = await this.serviceDomainMappingRepository.findByProjectDomainAndPathWithServiceNames(
      projectDomainId,
      subdomain,
      basePath,
      excludeServiceId,
    );
    // Map to ServiceDomainMapping type (simplified - may need adjustment)
    return results.map(r => ({
      serviceId: r.serviceId,
      subdomain: r.subdomain,
      basePath: r.basePath,
    })) as any;
  }

  /**
   * Find mapping by exact match
   */
  async findByExactMatch(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string | null
  ): Promise<ServiceDomainMapping | null> {
    // findByExactMatch doesn't exist, use findByServiceAndProjectDomain or findByProjectDomainId
    const mappings = await this.serviceDomainMappingRepository.findByProjectDomainId(projectDomainId);
    return mappings.find(m => m.subdomain === subdomain && m.basePath === basePath) || null;
  }

  /**
   * Update service domain mapping
   */
  async update(
    id: string,
    data: Partial<ServiceDomainMapping>
  ): Promise<ServiceDomainMapping | null> {
    return await this.serviceDomainMappingRepository.update(id, data);
  }

  /**
   * Delete service domain mapping
   */
  async delete(id: string): Promise<boolean> {
    return await this.serviceDomainMappingRepository.delete(id);
  }

  /**
   * Delete all mappings for a service
   */
  async deleteByServiceId(serviceId: string): Promise<number> {
    // deleteByServiceId doesn't exist, find and delete individually
    const mappings = await this.serviceDomainMappingRepository.findByServiceId(serviceId);
    let deleted = 0;
    for (const mapping of mappings) {
      const success = await this.serviceDomainMappingRepository.delete(mapping.id);
      if (success) deleted++;
    }
    return deleted;
  }

  /**
   * Count mappings for a project domain
   */
  async countByProjectDomainId(projectDomainId: string): Promise<number> {
    return await this.serviceDomainMappingRepository.countByProjectDomainId(projectDomainId);
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
    return await this.serviceDomainMappingRepository.findByProjectDomainAndPathWithServiceNames(
      projectDomainId,
      subdomain,
      basePath,
      excludeServiceId,
    );
  }
}
