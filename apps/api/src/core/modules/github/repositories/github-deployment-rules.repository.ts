/**
 * GitHub Deployment Rules Repository
 * 
 * PURPOSE: Database access layer for GitHub deployment rules
 * 
 * RESPONSIBILITIES:
 * - All database queries for GitHub-specific deployment rules
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for GitHub deployment rules
 * - Returns raw database entities
 * - Used by service layer
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { githubDeploymentRules } from '@/config/drizzle/schema/github-provider';
import { eq, and, desc } from 'drizzle-orm';

// Type inference from schema
type GithubDeploymentRule = typeof githubDeploymentRules.$inferSelect;
type GithubDeploymentRuleInsert = typeof githubDeploymentRules.$inferInsert;

@Injectable()
export class GithubDeploymentRulesRepository {
  private readonly logger = new Logger(GithubDeploymentRulesRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find a GitHub deployment rule by ID
   */
  async findById(id: string): Promise<GithubDeploymentRule | null> {
    this.logger.debug(`Finding GitHub deployment rule by ID: ${id}`);
    
    const [rule] = await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(eq(githubDeploymentRules.id, id))
      .limit(1);

    return rule || null;
  }

  /**
   * Find rules by project ID and event
   */
  async findByProjectAndEvent(
    projectId: string,
    event: string
  ): Promise<GithubDeploymentRule[]> {
    this.logger.debug(`Finding GitHub deployment rules for project ${projectId} and event ${event}`);
    
    return await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(
        and(
          eq(githubDeploymentRules.projectId, projectId),
          eq(githubDeploymentRules.event, event)
        )
      );
  }

  /**
   * Find all rules for a project
   */
  async findByProjectId(projectId: string): Promise<GithubDeploymentRule[]> {
    this.logger.debug(`Finding all GitHub deployment rules for project: ${projectId}`);
    
    return await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(eq(githubDeploymentRules.projectId, projectId))
      .orderBy(desc(githubDeploymentRules.priority));
  }

  /**
   * Find active rules for a project (ordered by priority)
   */
  async findActiveByProjectId(projectId: string): Promise<GithubDeploymentRule[]> {
    this.logger.debug(`Finding active GitHub deployment rules for project: ${projectId}`);
    
    return await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(
        and(
          eq(githubDeploymentRules.projectId, projectId),
          eq(githubDeploymentRules.isActive, true),
        ),
      )
      .orderBy(desc(githubDeploymentRules.priority));
  }

  /**
   * Create a new GitHub deployment rule
   */
  async create(data: GithubDeploymentRuleInsert): Promise<GithubDeploymentRule> {
    this.logger.log(`Creating GitHub deployment rule: ${data.name}`);
    
    const [rule] = await this.databaseService.db
      .insert(githubDeploymentRules)
      .values(data)
      .returning();

    if (!rule) {
      throw new Error('Failed to create GitHub deployment rule');
    }

    return rule;
  }

  /**
   * Update a GitHub deployment rule
   */
  async update(
    id: string,
    data: Partial<GithubDeploymentRuleInsert>
  ): Promise<GithubDeploymentRule | null> {
    this.logger.log(`Updating GitHub deployment rule: ${id}`);
    
    const [rule] = await this.databaseService.db
      .update(githubDeploymentRules)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(githubDeploymentRules.id, id))
      .returning();

    return rule || null;
  }

  /**
   * Delete a GitHub deployment rule
   */
  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting GitHub deployment rule: ${id}`);
    
    const result = await this.databaseService.db
      .delete(githubDeploymentRules)
      .where(eq(githubDeploymentRules.id, id));

    return result.rowCount ? result.rowCount > 0 : false;
  }
}
