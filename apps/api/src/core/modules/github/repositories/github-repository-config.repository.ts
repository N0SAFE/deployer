/**
 * GitHub Repository Config Repository
 * 
 * PURPOSE: Database access layer for GitHub repository configurations
 * 
 * RESPONSIBILITIES:
 * - All database queries for GitHub repository configs
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for GitHub configs
 * - Returns raw database entities
 * - Used by service layer
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { githubRepositoryConfigs } from '@/config/drizzle/schema/github-provider';
import { eq, desc, and, or, SQL } from 'drizzle-orm';

// Type inference from schema
type GithubRepositoryConfig = typeof githubRepositoryConfigs.$inferSelect;
type GithubRepositoryConfigInsert = typeof githubRepositoryConfigs.$inferInsert;

@Injectable()
export class GithubRepositoryConfigRepository {
  private readonly logger = new Logger(GithubRepositoryConfigRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find config by ID
   */
  async findById(id: string): Promise<GithubRepositoryConfig | null> {
    this.logger.debug(`Finding GitHub config by ID: ${id}`);
    
    const [config] = await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.id, id))
      .limit(1);

    return config || null;
  }

  /**
   * Find config by repository ID
   */
  async findByRepositoryId(repositoryId: string): Promise<GithubRepositoryConfig | null> {
    this.logger.debug(`Finding GitHub config by repository ID: ${repositoryId}`);
    
    const [config] = await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.repositoryId, repositoryId))
      .limit(1);

    return config || null;
  }

  /**
   * Find config by repository full name (owner/repo)
   */
  async findByFullName(fullName: string): Promise<GithubRepositoryConfig | null> {
    this.logger.debug(`Finding GitHub config by full name: ${fullName}`);
    
    const [config] = await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.repositoryFullName, fullName))
      .limit(1);

    return config || null;
  }

  /**
   * Find config by repository ID or full name
   */
  async findByRepositoryIdOrFullName(
    repositoryId?: string,
    fullName?: string
  ): Promise<GithubRepositoryConfig | null> {
    this.logger.debug(`Finding GitHub config by ID or full name`);
    
    if (!repositoryId && !fullName) {
      return null;
    }

    const conditions: SQL[] = [];
    if (repositoryId) {
      conditions.push(eq(githubRepositoryConfigs.repositoryId, repositoryId));
    }
    if (fullName) {
      conditions.push(eq(githubRepositoryConfigs.repositoryFullName, fullName));
    }

    const [config] = await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(or(...conditions))
      .limit(1);

    return config || null;
  }

  /**
   * Find all configs for a project
   */
  async findByProjectId(projectId: string): Promise<GithubRepositoryConfig[]> {
    this.logger.debug(`Finding GitHub configs for project: ${projectId}`);
    
    return await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.projectId, projectId));
  }

  /**
   * Find config by project and repository
   */
  async findByProjectAndRepository(
    projectId: string,
    repositoryId: string
  ): Promise<GithubRepositoryConfig | null> {
    this.logger.debug(`Finding GitHub config for project ${projectId} and repository ${repositoryId}`);
    
    const [config] = await this.databaseService.db
      .select()
      .from(githubRepositoryConfigs)
      .where(
        and(
          eq(githubRepositoryConfigs.projectId, projectId),
          eq(githubRepositoryConfigs.repositoryId, repositoryId)
        )
      )
      .limit(1);

    return config || null;
  }

  /**
   * Create a new GitHub repository config
   */
  async create(data: GithubRepositoryConfigInsert): Promise<GithubRepositoryConfig> {
    this.logger.log(`Creating GitHub repository config for: ${data.repositoryFullName}`);
    
    const [config] = await this.databaseService.db
      .insert(githubRepositoryConfigs)
      .values(data)
      .returning();

    if (!config) {
      throw new Error('Failed to create GitHub repository config');
    }

    return config;
  }

  /**
   * Update a GitHub repository config
   */
  async update(
    id: string,
    data: Partial<GithubRepositoryConfigInsert>
  ): Promise<GithubRepositoryConfig | null> {
    this.logger.log(`Updating GitHub repository config: ${id}`);
    
    const [config] = await this.databaseService.db
      .update(githubRepositoryConfigs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(githubRepositoryConfigs.id, id))
      .returning();

    return config || null;
  }

  /**
   * Delete a GitHub repository config
   */
  async delete(id: string): Promise<boolean> {
    this.logger.log(`Deleting GitHub repository config: ${id}`);
    
    const result = await this.databaseService.db
      .delete(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.id, id));

    return result.rowCount ? result.rowCount > 0 : false;
  }
}
