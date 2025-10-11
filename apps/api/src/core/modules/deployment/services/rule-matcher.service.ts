import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { githubRepositoryConfigs, githubDeploymentRules } from '@/config/drizzle/schema/github-provider';
import { services } from '@/config/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { EnhancedDeploymentRulesService } from './enhanced-deployment-rules.service';
import { CustomConditionRegistry } from './custom-condition-registry.service';

@Injectable()
export class RuleMatcherService {
  private readonly logger = new Logger(RuleMatcherService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly enhanced: EnhancedDeploymentRulesService,
    private readonly customRegistry: CustomConditionRegistry,
  ) {}

  /**
   * Find candidate matches for a GitHub event. This returns an array of
   * { service, rule, deploymentConfig } objects where service is the resolved
   * service DB row (or a synthesized object as a fallback).
   */
  async findMatchesForEvent(event: any): Promise<Array<any>> {
    const repoId = event.repository?.id?.toString();
    const repoFull = event.repository?.full_name;

    const configs = await this.db.db
      .select()
      .from(githubRepositoryConfigs)
      .where(repoId ? eq(githubRepositoryConfigs.repositoryId, repoId) : eq(githubRepositoryConfigs.repositoryFullName, repoFull))
      .limit(1);

    if (!configs || configs.length === 0) {
      return [];
    }
    const config = configs[0];

    // Find rules for this project and event
    const rules = await this.db.db
      .select()
      .from(githubDeploymentRules)
      .where(and(eq(githubDeploymentRules.projectId, config.projectId), eq(githubDeploymentRules.event, event.action || event.type || 'push')));

    const matches: Array<any> = [];
    for (const rule of rules) {
      // Resolve target service in multiple ways
      let svc: any = null;
      if ((rule as any).metadata?.targetServiceId || (rule as any).targetServiceId) {
        const svcId = (rule as any).metadata?.targetServiceId || (rule as any).targetServiceId;
        const found = await this.db.db.select().from(services).where(eq(services.id, svcId)).limit(1);
        if (found && found.length > 0) svc = found[0];
      }

      if (!svc && (rule as any).metadata?.targetServiceName) {
        const found = await this.db.db.select().from(services).where(and(eq(services.name, (rule as any).metadata.targetServiceName), eq(services.projectId, config.projectId))).limit(1);
        if (found && found.length > 0) svc = found[0];
      }

      // Fallback: first service in project
      if (!svc) {
        const found = await this.db.db.select().from(services).where(eq(services.projectId, config.projectId)).limit(1);
        if (found && found.length > 0) svc = found[0];
      }

      // As last resort synthesize minimal service object
      if (!svc) {
        svc = { id: `svc-${rule.id}`, name: `svc-${rule.name}`, projectId: config.projectId };
      }

      // Evaluate rule-level conditions (path patterns and such) using the enhanced rules engine
      const changedFiles = event.commits ? this.extractChangedFiles(event.commits) : [];
      const enhancedResult = this.enhanced.evaluateRuleWithContext(rule, { changedFiles, event });
      if (!enhancedResult.matches) {
        this.logger.debug(`Rule ${rule.id} did not match enhanced conditions: ${enhancedResult.reason}`);
        continue;
      }

      // Evaluate custom condition if present
      if ((rule as any).customCondition || (rule as any).metadata?.customCondition) {
        const condName = (rule as any).customCondition || (rule as any).metadata?.customCondition;
        const evalRes = await this.customRegistry.evaluate(condName, { event, changedFiles, rule, config });
        if (!evalRes.found) {
          this.logger.warn(`Rule ${rule.id} references unknown custom condition: ${condName} - skipping rule`);
          continue;
        }
        if (!evalRes.result) {
          this.logger.debug(`Rule ${rule.id} custom condition ${condName} returned false`);
          continue;
        }
      }

      // Compose deploymentConfig (merge config and rule preferences)
      const deploymentConfig = {
        branch: config.basePath || event.branch || 'main',
        environment: (rule as any).environment || 'production',
        strategy: rule.deploymentStrategy || config.deploymentStrategy,
      };

      matches.push({ service: svc, rule, deploymentConfig, repoConfig: config, changedFiles });
    }

    return matches;
  }

  private extractChangedFiles(commits: any[]): string[] {
    const files = new Set<string>();
    for (const commit of commits || []) {
      if (commit.added) commit.added.forEach((f: string) => files.add(f));
      if (commit.modified) commit.modified.forEach((f: string) => files.add(f));
      if (commit.removed) commit.removed.forEach((f: string) => files.add(f));
    }
    return Array.from(files);
  }
}
