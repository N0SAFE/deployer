import { Injectable } from '@nestjs/common';
import { GithubDeploymentRulesRepository } from '@/core/modules/github/repositories/github-deployment-rules.repository';
import type { githubDeploymentRules } from '@/config/drizzle/schema/github-provider';

type GithubDeploymentRule = typeof githubDeploymentRules.$inferSelect;
type GithubDeploymentRuleInsert = typeof githubDeploymentRules.$inferInsert;

@Injectable()
export class GithubDeploymentRulesDataService {
  constructor(
    private readonly githubDeploymentRulesRepository: GithubDeploymentRulesRepository,
  ) {}

  /**
   * Find a GitHub deployment rule by ID
   */
  async findById(id: string): Promise<GithubDeploymentRule | null> {
    return await this.githubDeploymentRulesRepository.findById(id);
  }

  /**
   * Find rules by project ID and event
   */
  async findByProjectAndEvent(
    projectId: string,
    event: string
  ): Promise<GithubDeploymentRule[]> {
    return await this.githubDeploymentRulesRepository.findByProjectAndEvent(projectId, event);
  }

  /**
   * Find all rules for a project
   */
  async findByProjectId(projectId: string): Promise<GithubDeploymentRule[]> {
    return await this.githubDeploymentRulesRepository.findByProjectId(projectId);
  }

  /**
   * Find active rules for a project (ordered by priority)
   */
  async findActiveByProjectId(projectId: string): Promise<GithubDeploymentRule[]> {
    return await this.githubDeploymentRulesRepository.findActiveByProjectId(projectId);
  }

  /**
   * Create a new GitHub deployment rule
   */
  async create(data: GithubDeploymentRuleInsert): Promise<GithubDeploymentRule> {
    return await this.githubDeploymentRulesRepository.create(data);
  }

  /**
   * Update an existing GitHub deployment rule
   */
  async update(id: string, data: Partial<GithubDeploymentRule>): Promise<GithubDeploymentRule> {
    const result = await this.githubDeploymentRulesRepository.update(id, data);
    if (!result) {
      throw new Error(`GitHub deployment rule with id ${id} not found`);
    }
    return result;
  }

  /**
   * Delete a GitHub deployment rule
   */
  async delete(id: string): Promise<boolean> {
    return await this.githubDeploymentRulesRepository.delete(id);
  }
}
