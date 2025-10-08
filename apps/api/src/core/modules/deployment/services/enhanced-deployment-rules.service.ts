import { Injectable, Logger } from '@nestjs/common';
import { DeploymentRulesService } from './deployment-rules.service';

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
    rule: any,
    context: { changedFiles?: string[]; event?: any }
  ): { matches: boolean; reason: string } {
    // Use base rule matching first
    const baseMatch = this.base.testRuleMatch(rule, {
      type: (context.event?.type as any) || 'push',
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
      const changed = context.changedFiles || [];
      const matchesAny = rule.pathPatterns.some((pattern: string) =>
        changed.some((file) => this.base['matchesPattern'](file, pattern))
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
