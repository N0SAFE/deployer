import { Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { githubApps, githubRepositoryConfigs, githubDeploymentRules } from '@/config/drizzle/schema/github-provider';
import { services } from '@/config/drizzle/schema';

@Injectable()
export class GithubProviderRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find GitHub App installation by organization login
   */
  async findInstallationByOrganization(organizationLogin: string) {
    const db = this.databaseService.db;
    const [installation] = await db
      .select()
      .from(githubApps)
      .where(eq(githubApps.organizationId, organizationLogin))
      .limit(1);

    return installation || null;
  }

  /**
   * Get all GitHub App installations
   */
  async findAllInstallations() {
    const db = this.databaseService.db;
    return await db
      .select()
      .from(githubApps);
  }

  /**
   * Create GitHub App installation
   */
  async createInstallation(data: {
    organizationId: string;
    name: string;
    appId: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
    webhookSecret: string;
    installationId: string;
    isActive: boolean;
  }) {
    const db = this.databaseService.db;
    const [inserted] = await db.insert(githubApps).values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return inserted;
  }

  /**
   * Update GitHub App installation
   */
  async updateInstallation(id: string, updateData: Partial<{
    installationId: string;
    appId: string;
    privateKey: string;
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
  }>) {
    const db = this.databaseService.db;
    await db
      .update(githubApps)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(githubApps.id, id));
  }

  /**
   * Find repository config by repository ID
   */
  async findRepositoryConfigByRepositoryId(repositoryId: string) {
    const db = this.databaseService.db;
    const [config] = await db
      .select()
      .from(githubRepositoryConfigs)
      .where(eq(githubRepositoryConfigs.repositoryId, repositoryId))
      .limit(1);

    return config || null;
  }

  /**
   * Update repository config
   */
  async updateRepositoryConfig(repositoryId: string, data: {
    repositoryFullName: string;
  }) {
    const db = this.databaseService.db;
    await db
      .update(githubRepositoryConfigs)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(githubRepositoryConfigs.repositoryId, repositoryId));
  }

  /**
   * Find repository config by repository ID or full name
   */
  async findRepositoryConfig(repositoryId?: string, repositoryFullName?: string) {
    const db = this.databaseService.db;
    const condition = repositoryId 
      ? eq(githubRepositoryConfigs.repositoryId, repositoryId)
      : eq(githubRepositoryConfigs.repositoryFullName, repositoryFullName!);

    const [config] = await db
      .select()
      .from(githubRepositoryConfigs)
      .where(condition)
      .limit(1);

    return config || null;
  }

  /**
   * Find deployment rules by project ID and event
   */
  async findDeploymentRulesByProjectAndEvent(projectId: string, event: string) {
    const db = this.databaseService.db;
    return await db
      .select()
      .from(githubDeploymentRules)
      .where(and(
        eq(githubDeploymentRules.projectId, projectId),
        eq(githubDeploymentRules.event, event)
      ));
  }

  /**
   * Find service by project ID
   */
  async findServiceByProjectId(projectId: string) {
    const db = this.databaseService.db;
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.projectId, projectId))
      .limit(1);

    return service || null;
  }
}
