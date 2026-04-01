import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { GlobalDatabaseService } from '../../database/services/global-database.service';
import {
  providerTraefikTemplates,
  serviceTraefikTemplates,
  type ProviderTraefikTemplate,
  type ServiceTraefikTemplate,
} from '@/config/drizzle/global/schema/traefik';

@Injectable()
export class TraefikTemplateRepository {
  constructor(private readonly databaseService: GlobalDatabaseService) {}

  /**
   * Get provider template by type
   */
  async findProviderByType(providerType: string): Promise<ProviderTraefikTemplate | null> {
    const db = this.databaseService.db;
    
    const [template] = await db
      .select()
      .from(providerTraefikTemplates)
      .where(eq(providerTraefikTemplates.providerType, providerType))
      .limit(1);
    
    return template ?? null;
  }

  /**
   * Get active service template by service ID
   */
  async findActiveByServiceId(serviceId: string): Promise<ServiceTraefikTemplate | null> {
    const db = this.databaseService.db;
    
    const [template] = await db
      .select()
      .from(serviceTraefikTemplates)
      .where(and(
        eq(serviceTraefikTemplates.serviceId, serviceId),
        eq(serviceTraefikTemplates.isActive, true)
      ))
      .limit(1);
    
    return template ?? null;
  }

  /**
   * Create provider template
   */
  async createProviderTemplate(data: {
    id: string;
    providerType: string;
    templateName: string;
    templateContent: string;
    description: string | null;
    variables: unknown;
    isDefault: boolean;
  }): Promise<ProviderTraefikTemplate | null> {
    const db = this.databaseService.db;
    
    const [template] = await db
      .insert(providerTraefikTemplates)
      .values(data)
      .returning();
    
    return template ?? null;
  }

  /**
   * Create service template
   */
  async createServiceTemplate(data: {
    id: string;
    serviceId: string;
    templateContent: string;
    variables: unknown;
    isActive: boolean;
  }): Promise<ServiceTraefikTemplate | null> {
    const db = this.databaseService.db;
    
    const [template] = await db
      .insert(serviceTraefikTemplates)
      .values(data)
      .returning();
    
    return template ?? null;
  }

  /**
   * Update service template
   */
  async updateServiceTemplate(
    id: string,
    updateData: {
      templateContent?: string;
      variables?: any;
      isActive?: boolean;
      updatedAt: Date;
    },
  ): Promise<ServiceTraefikTemplate | null> {
    const db = this.databaseService.db;
    
    const [template] = await db
      .update(serviceTraefikTemplates)
      .set(updateData)
      .where(eq(serviceTraefikTemplates.id, id))
      .returning();
    
    return template ?? null;
  }
}
