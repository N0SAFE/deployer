import { Injectable, Logger } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { githubDeploymentRules } from '@/config/drizzle/schema';

export interface PathCondition {
  include?: string[];
  exclude?: string[];
  requireAll?: boolean;
}

export interface DeploymentRule {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  event: string;
  branchPattern: string | null;
  tagPattern: string | null;
  pathConditions: PathCondition | null;
  customCondition: string | null;
  action: string;
  deploymentStrategy: 'standard' | 'blue-green' | 'canary' | 'rolling' | 'custom' | null;
  customStrategyScript: string | null;
  bypassCache: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeploymentRuleInput {
  projectId: string;
  name: string;
  description?: string;
  priority?: number;
  isActive?: boolean;
  event: string;
  branchPattern?: string;
  tagPattern?: string;
  pathConditions?: PathCondition;
  customCondition?: string;
  action: string;
  deploymentStrategy?: 'standard' | 'blue-green' | 'canary' | 'rolling' | 'custom';
  customStrategyScript?: string;
  bypassCache?: boolean;
}

export interface UpdateDeploymentRuleInput {
  name?: string;
  description?: string;
  priority?: number;
  isActive?: boolean;
  event?: string;
  branchPattern?: string;
  tagPattern?: string;
  pathConditions?: PathCondition;
  customCondition?: string;
  action?: string;
  deploymentStrategy?: 'standard' | 'blue-green' | 'canary' | 'rolling' | 'custom';
  customStrategyScript?: string;
  bypassCache?: boolean;
}

export interface RuleMatchContext {
  event: string;
  branch?: string;
  tag?: string;
  changedFiles?: string[];
  pullRequest?: {
    number: number;
    labels: string[];
    targetBranch: string;
  };
  commit?: {
    sha: string;
    message: string;
    author: string;
  };
}

export interface RuleMatchResult {
  matches: boolean;
  rule: DeploymentRule;
  reason: string;
  action: string;
  deploymentStrategy: string | null;
  bypassCache: boolean;
}

@Injectable()
export class GithubDeploymentRulesService {
  private readonly logger = new Logger(GithubDeploymentRulesService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Create a new deployment rule
   */
  async create(input: CreateDeploymentRuleInput): Promise<DeploymentRule> {
    this.logger.log(`Creating deployment rule: ${input.name}`);

    const [rule] = await this.databaseService.db
      .insert(githubDeploymentRules)
      .values({
        projectId: input.projectId,
        name: input.name,
        description: input.description || null,
        priority: input.priority ?? 0,
        isActive: input.isActive ?? true,
        event: input.event,
        branchPattern: input.branchPattern || null,
        tagPattern: input.tagPattern || null,
        pathConditions: input.pathConditions || null,
        customCondition: input.customCondition || null,
        action: input.action,
        deploymentStrategy: input.deploymentStrategy || null,
        customStrategyScript: input.customStrategyScript || null,
        bypassCache: input.bypassCache ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return rule as DeploymentRule;
  }

  /**
   * Get rule by ID
   */
  async findById(id: string): Promise<DeploymentRule | null> {
    const [rule] = await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(eq(githubDeploymentRules.id, id));

    return (rule as DeploymentRule) || null;
  }

  /**
   * Get all rules for a project (ordered by priority)
   */
  async findByProjectId(projectId: string): Promise<DeploymentRule[]> {
    const rules = await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(eq(githubDeploymentRules.projectId, projectId))
      .orderBy(desc(githubDeploymentRules.priority));

    return rules as DeploymentRule[];
  }

  /**
   * Get active rules for a project
   */
  async findActiveRules(projectId: string): Promise<DeploymentRule[]> {
    const rules = await this.databaseService.db
      .select()
      .from(githubDeploymentRules)
      .where(
        and(
          eq(githubDeploymentRules.projectId, projectId),
          eq(githubDeploymentRules.isActive, true),
        ),
      )
      .orderBy(desc(githubDeploymentRules.priority));

    return rules as DeploymentRule[];
  }

  /**
   * Update a deployment rule
   */
  async update(id: string, input: UpdateDeploymentRuleInput): Promise<DeploymentRule> {
    const [rule] = await this.databaseService.db
      .update(githubDeploymentRules)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(githubDeploymentRules.id, id))
      .returning();

    return rule as DeploymentRule;
  }

  /**
   * Delete a deployment rule
   */
  async delete(id: string): Promise<void> {
    await this.databaseService.db
      .delete(githubDeploymentRules)
      .where(eq(githubDeploymentRules.id, id));

    this.logger.log(`Deleted deployment rule: ${id}`);
  }

  /**
   * Match event against rules and return the first matching rule
   */
  async matchRules(
    projectId: string,
    context: RuleMatchContext,
  ): Promise<RuleMatchResult | null> {
    const rules = await this.findActiveRules(projectId);

    for (const rule of rules) {
      const matchResult = await this.matchRule(rule, context);
      if (matchResult.matches) {
        return matchResult;
      }
    }

    return null;
  }

  /**
   * Match a single rule against context
   */
  async matchRule(rule: DeploymentRule, context: RuleMatchContext): Promise<RuleMatchResult> {
    const reasons: string[] = [];

    // 1. Check event type
    if (rule.event !== context.event) {
      return {
        matches: false,
        rule,
        reason: `Event mismatch: expected ${rule.event}, got ${context.event}`,
        action: rule.action,
        deploymentStrategy: rule.deploymentStrategy,
        bypassCache: rule.bypassCache,
      };
    }
    reasons.push(`Event matches: ${context.event}`);

    // 2. Check branch pattern (if specified)
    if (rule.branchPattern && context.branch) {
      if (!this.matchPattern(context.branch, rule.branchPattern)) {
        return {
          matches: false,
          rule,
          reason: `Branch mismatch: ${context.branch} does not match ${rule.branchPattern}`,
          action: rule.action,
          deploymentStrategy: rule.deploymentStrategy,
          bypassCache: rule.bypassCache,
        };
      }
      reasons.push(`Branch matches: ${context.branch}`);
    }

    // 3. Check tag pattern (if specified)
    if (rule.tagPattern && context.tag) {
      if (!this.matchPattern(context.tag, rule.tagPattern)) {
        return {
          matches: false,
          rule,
          reason: `Tag mismatch: ${context.tag} does not match ${rule.tagPattern}`,
          action: rule.action,
          deploymentStrategy: rule.deploymentStrategy,
          bypassCache: rule.bypassCache,
        };
      }
      reasons.push(`Tag matches: ${context.tag}`);
    }

    // 4. Check path conditions (if specified)
    if (rule.pathConditions && context.changedFiles) {
      const pathMatch = this.matchPathConditions(rule.pathConditions, context.changedFiles);
      if (!pathMatch.matches) {
        return {
          matches: false,
          rule,
          reason: pathMatch.reason,
          action: rule.action,
          deploymentStrategy: rule.deploymentStrategy,
          bypassCache: rule.bypassCache,
        };
      }
      reasons.push(pathMatch.reason);
    }

    // 5. Check custom condition (if specified)
    if (rule.customCondition) {
      const customMatch = this.evaluateCustomCondition(rule.customCondition, context);
      if (!customMatch.matches) {
        return {
          matches: false,
          rule,
          reason: customMatch.reason,
          action: rule.action,
          deploymentStrategy: rule.deploymentStrategy,
          bypassCache: rule.bypassCache,
        };
      }
      reasons.push(customMatch.reason);
    }

    // All conditions matched
    return {
      matches: true,
      rule,
      reason: reasons.join('; '),
      action: rule.action,
      deploymentStrategy: rule.deploymentStrategy,
      bypassCache: rule.bypassCache,
    };
  }

  /**
   * Match path conditions
   */
  private matchPathConditions(
    conditions: PathCondition,
    changedFiles: string[],
  ): { matches: boolean; reason: string } {
    const { include, exclude, requireAll } = conditions;

    // Check exclude patterns first
    if (exclude && exclude.length > 0) {
      const excludedFiles = changedFiles.filter((file) =>
        exclude.some((pattern) => this.matchPattern(file, pattern)),
      );

      if (excludedFiles.length === changedFiles.length) {
        return {
          matches: false,
          reason: 'All changed files are excluded',
        };
      }
    }

    // Check include patterns
    if (include && include.length > 0) {
      const includedFiles = changedFiles.filter((file) =>
        include.some((pattern) => this.matchPattern(file, pattern)),
      );

      if (requireAll) {
        // All patterns must match at least one file
        const allPatternsMatch = include.every((pattern) =>
          changedFiles.some((file) => this.matchPattern(file, pattern)),
        );

        if (!allPatternsMatch) {
          return {
            matches: false,
            reason: 'Not all required path patterns matched',
          };
        }
      } else {
        // At least one file must match
        if (includedFiles.length === 0) {
          return {
            matches: false,
            reason: 'No files match include patterns',
          };
        }
      }

      return {
        matches: true,
        reason: `${includedFiles.length} file(s) match path conditions`,
      };
    }

    return {
      matches: true,
      reason: 'No path conditions specified',
    };
  }

  /**
   * Evaluate custom condition (JavaScript expression)
   * IMPORTANT: This uses eval() - should be sanitized and run in sandbox in production
   */
  private evaluateCustomCondition(
    condition: string,
    context: RuleMatchContext,
  ): { matches: boolean; reason: string } {
    try {
      // Create a safe context for evaluation
      const safeContext = {
        event: context.event,
        branch: context.branch || '',
        tag: context.tag || '',
        changedFiles: context.changedFiles || [],
        pr: context.pullRequest
          ? {
              number: context.pullRequest.number,
              labels: context.pullRequest.labels,
              targetBranch: context.pullRequest.targetBranch,
            }
          : null,
        commit: context.commit
          ? {
              sha: context.commit.sha,
              message: context.commit.message,
              author: context.commit.author,
            }
          : null,
      };

      // Evaluate the condition
      const result = eval(`(function(ctx) { with(ctx) { return ${condition}; } })`)(safeContext);

      return {
        matches: !!result,
        reason: result ? 'Custom condition evaluated to true' : 'Custom condition evaluated to false',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Error evaluating custom condition: ${errorMessage}`, errorStack);
      return {
        matches: false,
        reason: `Custom condition error: ${errorMessage}`,
      };
    }
  }

  /**
   * Match a string against a glob-like pattern
   */
  private matchPattern(text: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*\*/g, '.*') // ** matches any number of directories
      .replace(/\*/g, '[^/]*') // * matches anything except /
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }

  /**
   * Get all rules that would match a given context (for debugging/UI)
   */
  async findMatchingRules(
    projectId: string,
    context: RuleMatchContext,
  ): Promise<RuleMatchResult[]> {
    const rules = await this.findActiveRules(projectId);
    const results: RuleMatchResult[] = [];

    for (const rule of rules) {
      const matchResult = await this.matchRule(rule, context);
      if (matchResult.matches) {
        results.push(matchResult);
      }
    }

    return results;
  }

  /**
   * Validate a custom condition without executing it
   */
  validateCustomCondition(condition: string): { valid: boolean; error?: string } {
    try {
      // Basic syntax check
      new Function('ctx', `with(ctx) { return ${condition}; }`);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get rule statistics for a project
   */
  async getRuleStats(projectId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    byEvent: Record<string, number>;
    byAction: Record<string, number>;
  }> {
    const rules = await this.findByProjectId(projectId);

    const stats = {
      total: rules.length,
      active: rules.filter((r) => r.isActive).length,
      inactive: rules.filter((r) => !r.isActive).length,
      byEvent: {} as Record<string, number>,
      byAction: {} as Record<string, number>,
    };

    for (const rule of rules) {
      stats.byEvent[rule.event] = (stats.byEvent[rule.event] || 0) + 1;
      stats.byAction[rule.action] = (stats.byAction[rule.action] || 0) + 1;
    }

    return stats;
  }
}
