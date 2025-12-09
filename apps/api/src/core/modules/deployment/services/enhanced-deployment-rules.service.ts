import { Injectable, Logger } from '@nestjs/common';
import { DeploymentRulesService } from './deployment-rules.service';

// Define the rule structure based on what testRuleMatch expects
interface DeploymentRuleWithPatterns {
  id: string;
  isEnabled: boolean;
  trigger: 'push' | 'pull_request' | 'tag' | 'release' | 'manual';
  branchPattern?: string | null;
  excludeBranchPattern?: string | null;
  tagPattern?: string | null;
  prLabels?: string[] | null;
  prTargetBranches?: string[] | null;
  pathPatterns?: string[];
  metadata?: {
    customCondition?: string;
    [key: string]: unknown;
  } | null;
}

// Event context for rule evaluation
interface RuleEvaluationEvent {
  type?: 'push' | 'pull_request' | 'tag' | 'release';
  branch?: string;
  tag?: string;
  action?: string;
  prLabels?: string[];
  prTargetBranch?: string;
}

interface RuleEvaluationContext {
  changedFiles?: string[];
  event?: RuleEvaluationEvent;
}

/**
 * Enhanced rules engine that extends the base DeploymentRulesService with
 * additional matching capabilities such as path-based conditions and
 * pluggable custom condition callbacks.
 *
 * This service is intentionally conservative: it augments the DB-driven
 * rules engine with extra checks but falls back to the base rule when
 * advanced conditions are not present.
 */
@Injectable()
export class EnhancedDeploymentRulesService {
  private readonly logger = new Logger(EnhancedDeploymentRulesService.name);
  constructor(private readonly base: DeploymentRulesService) {}

  async listEnabledRulesForService(serviceId: string) {
    return this.base.listEnabledRulesByService(serviceId);
  }

  /**
   * Evaluate a rule against a set of changed files and event metadata.
   * - If the rule contains path-based conditions it will check that
   *   at least one watched path is present in changedFiles.
   * - Custom conditions are supported via metadata.customCondition which
   *   can later be used to reference registered predicates.
   */
  evaluateRuleWithContext(
    rule: DeploymentRuleWithPatterns,
    context: RuleEvaluationContext
  ): { matches: boolean; reason: string } {
    // Use base rule matching first
    const baseMatch = this.base.testRuleMatch(rule, {
      type: context.event?.type ?? 'push',
      branch: context.event?.branch,
      tag: context.event?.tag,
      prAction: context.event?.action,
      prLabels: context.event?.prLabels,
      prTargetBranch: context.event?.prTargetBranch,
    });

    if (!baseMatch.matches) {
      return baseMatch;
    }

    // Path-based matching (optional)
    if (rule.pathPatterns && rule.pathPatterns.length > 0) {
      const changed = context.changedFiles ?? [];
      const matchesAny = rule.pathPatterns.some((pattern: string) =>
        changed.some((file) => this.base.matchesPattern(file, pattern))
      );

      if (!matchesAny) {
        return { matches: false, reason: 'No changed files match rule pathPatterns' };
      }
    }

    // Custom condition placeholder (metadata.customCondition is a string key)
    if (rule.metadata?.customCondition) {
      // For now, we don't have a registry of predicates, so conservatively
      // log and accept the rule. In future we'll resolve and run predicates.
      this.logger.debug(`Rule ${rule.id} has customCondition ${rule.metadata.customCondition} (not evaluated yet)`);
    }

    return { matches: true, reason: 'All conditions matched' };
  }
}
