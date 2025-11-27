/**
 * Deployment Rules Repository
 * 
 * PURPOSE: Database access layer for deployment rules
 * 
 * RESPONSIBILITIES:
 * - All database queries for deployment rules
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for deployment rules
 * - Returns raw database entities
 * - Used by service layer
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { deploymentRules } from '@/config/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// Type inference from schema
type DeploymentRule = typeof deploymentRules.$inferSelect;
type DeploymentRuleInsert = typeof deploymentRules.$inferInsert;

@Injectable()
export class DeploymentRulesRepository {
  private readonly logger = new Logger(DeploymentRulesRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new deployment rule
   */
  async create(data: DeploymentRuleInsert): Promise<DeploymentRule> {
    this.logger.log(`Creating deployment rule: ${data.name}`);
    
    const [rule] = await this.databaseService.db
      .insert(deploymentRules)
      .values(data)
      .returning();

    if (!rule) {
      throw new Error('Failed to create deployment rule');
    }

    return rule;
  }

  /**
   * Find a deployment rule by ID
   */
  async findById(id: string): Promise<DeploymentRule | null> {
    this.logger.debug(`Finding deployment rule by ID: ${id}`);
    
    const [rule] = await this.databaseService.db
      .select()
      .from(deploymentRules)
      .where(eq(deploymentRules.id, id))
      .limit(1);

    return rule || null;
  }

  /**
   * List all deployment rules for a service
   */
  async findByService(serviceId: string): Promise<DeploymentRule[]> {
    this.logger.debug(`Finding deployment rules for service: ${serviceId}`);
    
    return await this.databaseService.db
      .select()
      .from(deploymentRules)
      .where(eq(deploymentRules.serviceId, serviceId))
      .orderBy(desc(deploymentRules.priority), deploymentRules.name);
  }

  /**
   * List enabled deployment rules for a service (ordered by priority)
   */
  async findEnabledByService(serviceId: string): Promise<DeploymentRule[]> {
    this.logger.debug(`Finding enabled deployment rules for service: ${serviceId}`);
    
    return await this.databaseService.db
      .select()
      .from(deploymentRules)
      .where(
        and(
          eq(deploymentRules.serviceId, serviceId),
          eq(deploymentRules.isEnabled, true)
        )
      )
      .orderBy(desc(deploymentRules.priority), deploymentRules.name);
  }

  /**
   * Update a deployment rule
   */
  async update(id: string, data: Partial<DeploymentRuleInsert>): Promise<DeploymentRule | null> {
    this.logger.log(`Updating deployment rule: ${id}`);
    
    const [rule] = await this.databaseService.db
      .update(deploymentRules)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(deploymentRules.id, id))
      .returning();

    return rule || null;
  }

  /**
   * Delete a deployment rule
   */
  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting deployment rule: ${id}`);
    
    const result = await this.databaseService.db
      .delete(deploymentRules)
      .where(eq(deploymentRules.id, id));

    return result.rowCount ? result.rowCount > 0 : false;
  }
}
