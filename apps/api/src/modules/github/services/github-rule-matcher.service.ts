import { Injectable, Logger } from '@nestjs/common';
import { GithubRepositoryConfigService } from '@/core/modules/providers/github/services/github-repository-config.service';
import {
  GithubDeploymentRulesService,
  type DeploymentRule,
} from '@/core/modules/providers/github/services/github-deployment-rules.service';
import { ServiceService } from '@/core/modules/service/services/service.service';
import { EnhancedDeploymentRulesService } from '@/core/modules/deployment/services/enhanced-deployment-rules.service';
import { CustomConditionRegistry } from '@/core/modules/deployment/services/custom-condition-registry.service';
import type { NormalizedGitHubEvent } from '@/core/modules/git/github';
import type { DeploymentRuleMatch } from '@/core/modules/deployment/types';

/**
 * Extended rule interface that includes optional metadata fields
 * that may be present on rules from GitHub deployment configuration
 */
interface ExtendedDeploymentRule extends DeploymentRule {
  eventType?: string;
  environment?: string;
  targetServiceId?: string;
  metadata?: {
    targetServiceId?: string;
    targetServiceName?: string;
    customCondition?: string;
    [key: string]: unknown;
  };
}

/**
 * Service representation for deployment matching
 */
interface ServiceInfo {
  id: string;
  name: string;
  projectId: string;
  builderId?: string;
  builderIdConfig?: {
    buildArgs?: Record<string, string>;
    [key: string]: unknown;
  };
  repoConfig?: {
    cacheStrategy?: 'strict' | 'loose';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * GitHub-Specific Rule Matcher Service
 *
 * This service is responsible for matching GitHub webhook events to deployment rules.
 * It's GitHub-specific and lives in the GitHub feature module, NOT in core/deployment.
 *
 * Architecture Decision:
 * - Core deployment modules should be provider-agnostic
 * - Provider-specific logic (like GitHub event → rule matching) belongs in feature modules
 * - This service uses GitHub-specific services (GithubRepositoryConfigService, GithubDeploymentRulesService)
 *   and GitHub-specific types (NormalizedGitHubEvent)
 *
 * Dependencies:
 * - GithubRepositoryConfigService: Find repository configuration by GitHub repo ID
 * - GithubDeploymentRulesService: Get deployment rules for a project
 * - ServiceService: Resolve target services
 * - EnhancedDeploymentRulesService: Evaluate rule conditions (path patterns, etc.)
 * - CustomConditionRegistry: Evaluate custom conditions
 */
@Injectable()
export class GitHubRuleMatcherService {
  private readonly logger = new Logger(GitHubRuleMatcherService.name);

  constructor(
    private readonly githubConfigService: GithubRepositoryConfigService,
    private readonly githubRulesService: GithubDeploymentRulesService,
    private readonly serviceService: ServiceService,
    private readonly enhanced: EnhancedDeploymentRulesService,
    private readonly customRegistry: CustomConditionRegistry,
  ) {}

  /**
   * Find candidate matches for a GitHub event.
   *
   * This returns an array of deployment matches where each match contains:
   * - service: The resolved service DB row (or a synthesized object as fallback)
   * - rule: The matched deployment rule
   * - deploymentConfig: Merged deployment configuration
   * - sourceConfig: GitHub repository configuration
   * - changedFiles: List of files changed in this event
   */
  async findMatchesForEvent(event: NormalizedGitHubEvent): Promise<DeploymentRuleMatch[]> {
    const repoId = event.repository.id.toString();
    const repoFull = event.repository.full_name;

    const config = await this.githubConfigService.findByRepositoryIdOrFullName(repoId, repoFull);

    if (!config) {
      this.logger.debug(`No configuration found for repository ${repoFull} (${repoId})`);
      return [];
    }

    // Find rules for this project and event
    const rules = await this.githubRulesService.findByProjectId(config.projectId);

    // Filter by event type - action takes precedence over type
    const eventType = event.action ?? event.type;
    const filteredRules = rules.filter((rule) => {
      const extRule = rule as ExtendedDeploymentRule;
      return !extRule.eventType || extRule.eventType === eventType;
    });

    const matches: DeploymentRuleMatch[] = [];

    for (const rule of filteredRules) {
      const extRule = rule as ExtendedDeploymentRule;

      // Resolve target service
      const svc = await this.resolveTargetService(extRule, config.projectId);

      // Extract changed files from commits
      const changedFiles = event.commits ? this.extractChangedFiles(event.commits) : [];

      // Evaluate rule-level conditions using the enhanced rules engine
      const enhancedResult = this.enhanced.evaluateRuleWithContext(rule, { changedFiles, event });
      if (!enhancedResult.matches) {
        this.logger.debug(`Rule ${rule.id} did not match enhanced conditions: ${enhancedResult.reason}`);
        continue;
      }

      // Evaluate custom condition if present
      const customCondition = extRule.customCondition ?? extRule.metadata?.customCondition;
      if (customCondition) {
        const evalRes = await this.customRegistry.evaluate(customCondition, {
          event,
          changedFiles,
          rule,
          config,
        });
        if (!evalRes.found) {
          this.logger.warn(
            `Rule ${rule.id} references unknown custom condition: ${customCondition} - skipping rule`,
          );
          continue;
        }
        if (!evalRes.result) {
          this.logger.debug(`Rule ${rule.id} custom condition ${customCondition} returned false`);
          continue;
        }
      }

      // Compose deploymentConfig (merge config and rule preferences)
      const deploymentConfig = {
        branch: config.basePath ?? event.branch ?? 'main',
        environment: extRule.environment ?? 'production',
        strategy: rule.deploymentStrategy ?? config.deploymentStrategy,
      };

      // Transform rule to match expected interface
      const matchedRule: DeploymentRuleMatch['rule'] = {
        id: rule.id,
        name: rule.name,
        environment: extRule.environment,
        deploymentStrategy: rule.deploymentStrategy ?? undefined,
        // Spread additional properties for backward compatibility
        priority: rule.priority,
        event: rule.event,
        branchPattern: rule.branchPattern,
        pathConditions: rule.pathConditions,
      };

      matches.push({
        service: svc,
        rule: matchedRule,
        deploymentConfig,
        sourceConfig: config as Record<string, unknown>,
        changedFiles,
      });
    }

    return matches;
  }

  /**
   * Resolve target service for a deployment rule
   */
  private async resolveTargetService(
    rule: ExtendedDeploymentRule,
    projectId: string,
  ): Promise<ServiceInfo> {
    // Try by service ID first (from metadata or direct property)
    const targetServiceId = rule.metadata?.targetServiceId ?? rule.targetServiceId;
    if (targetServiceId) {
      const svc = await this.serviceService.getServiceById(targetServiceId);
      return svc as ServiceInfo;
    }

    // Try by service name from metadata
    const targetServiceName = rule.metadata?.targetServiceName;
    if (targetServiceName) {
      const services = await this.serviceService.findByProject(projectId);
      const found = services.find((s) => s.name === targetServiceName);
      if (found) {
        return found as ServiceInfo;
      }
    }

    // Fallback: first service in project
    const services = await this.serviceService.findByProject(projectId, 1);
    if (services.length > 0) {
      return services[0] as ServiceInfo;
    }

    // As last resort, synthesize minimal service object
    return {
      id: `svc-${rule.id}`,
      name: `svc-${rule.name}`,
      projectId,
    };
  }

  /**
   * Extract changed files from GitHub commits
   */
  private extractChangedFiles(commits: NormalizedGitHubEvent['commits']): string[] {
    const files = new Set<string>();
    for (const commit of commits ?? []) {
      if (commit.added) commit.added.forEach((f) => files.add(f));
      if (commit.modified) commit.modified.forEach((f) => files.add(f));
      if (commit.removed) commit.removed.forEach((f) => files.add(f));
    }
    return Array.from(files);
  }
}
