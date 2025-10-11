import { Injectable } from '@nestjs/common'
import { eq, and, desc } from 'drizzle-orm'
import { DatabaseService } from '@/core/modules/database/services/database.service'
import {
  deploymentRules,
  deploymentRuleTriggerEnum,
} from '@/config/drizzle/schema'

// Type inference from schema
type SelectDeploymentRule = typeof deploymentRules.$inferSelect
type DeploymentRuleTrigger = typeof deploymentRuleTriggerEnum.enumValues[number]

export interface CreateDeploymentRuleInput {
  serviceId: string
  name: string
  trigger: DeploymentRuleTrigger
  isEnabled?: boolean
  priority?: number
  branchPattern?: string | null
  excludeBranchPattern?: string | null
  tagPattern?: string | null
  prLabels?: string[] | null
  prTargetBranches?: string[] | null
  requireApproval?: boolean
  minApprovals?: number | null
  environment: 'production' | 'staging' | 'preview' | 'development'
  autoMergeOnSuccess?: boolean
  autoDeleteOnMerge?: boolean
  environmentVariables?: Record<string, string> | null
  builderConfigOverride?: Record<string, any> | null
  description?: string | null
}

export interface UpdateDeploymentRuleInput {
  name?: string
  isEnabled?: boolean
  priority?: number
  branchPattern?: string | null
  excludeBranchPattern?: string | null
  tagPattern?: string | null
  prLabels?: string[] | null
  prTargetBranches?: string[] | null
  requireApproval?: boolean
  minApprovals?: number | null
  environment?: 'production' | 'staging' | 'preview' | 'development'
  autoMergeOnSuccess?: boolean
  autoDeleteOnMerge?: boolean
  environmentVariables?: Record<string, string> | null
  builderConfigOverride?: Record<string, any> | null
  description?: string | null
}

@Injectable()
export class DeploymentRulesService {
  constructor(private database: DatabaseService) {}

  /**
   * Create a new deployment rule
   */
  async createRule(
    input: CreateDeploymentRuleInput
  ): Promise<SelectDeploymentRule> {
    const [rule] = await this.database.db
      .insert(deploymentRules)
      .values({
        serviceId: input.serviceId,
        name: input.name,
        trigger: input.trigger,
        isEnabled: input.isEnabled ?? true,
        priority: input.priority ?? 50,
        branchPattern: input.branchPattern ?? undefined,
        excludeBranchPattern: input.excludeBranchPattern ?? undefined,
        tagPattern: input.tagPattern ?? undefined,
        prLabels: input.prLabels ?? undefined,
        prTargetBranches: input.prTargetBranches ?? undefined,
        requireApproval: input.requireApproval ?? false,
        minApprovals: input.minApprovals ?? undefined,
        environment: input.environment,
        autoMergeOnSuccess: input.autoMergeOnSuccess ?? false,
        autoDeleteOnMerge: input.autoDeleteOnMerge ?? false,
        environmentVariables: input.environmentVariables ?? undefined,
        builderConfigOverride: input.builderConfigOverride ?? undefined,
        metadata: {
          description: input.description ?? undefined,
          triggerCount: 0,
        },
      })
      .returning()

    return rule
  }

  /**
   * Get a deployment rule by ID
   */
  async getRuleById(id: string): Promise<SelectDeploymentRule | null> {
    const [rule] = await this.database.db
      .select()
      .from(deploymentRules)
      .where(eq(deploymentRules.id, id))

    return rule || null
  }

  /**
   * List all deployment rules for a service
   */
  async listRulesByService(
    serviceId: string
  ): Promise<SelectDeploymentRule[]> {
    const rules = await this.database.db
      .select()
      .from(deploymentRules)
      .where(eq(deploymentRules.serviceId, serviceId))
      .orderBy(desc(deploymentRules.priority), deploymentRules.name)

    return rules
  }

  /**
   * List enabled deployment rules for a service (ordered by priority)
   */
  async listEnabledRulesByService(
    serviceId: string
  ): Promise<SelectDeploymentRule[]> {
    const rules = await this.database.db
      .select()
      .from(deploymentRules)
      .where(
        and(
          eq(deploymentRules.serviceId, serviceId),
          eq(deploymentRules.isEnabled, true)
        )
      )
      .orderBy(desc(deploymentRules.priority), deploymentRules.name)

    return rules
  }

  /**
   * Update a deployment rule
   */
  async updateRule(
    id: string,
    input: UpdateDeploymentRuleInput
  ): Promise<SelectDeploymentRule | null> {
    const [rule] = await this.database.db
      .update(deploymentRules)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(deploymentRules.id, id))
      .returning()

    return rule || null
  }

  /**
   * Toggle a deployment rule's enabled state
   */
  async toggleRule(id: string): Promise<SelectDeploymentRule | null> {
    // Get current state
    const currentRule = await this.getRuleById(id)
    if (!currentRule) {
      return null
    }

    // Toggle the isEnabled flag
    const [rule] = await this.database.db
      .update(deploymentRules)
      .set({
        isEnabled: !currentRule.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(deploymentRules.id, id))
      .returning()

    return rule || null
  }

  /**
   * Delete a deployment rule
   */
  async deleteRule(id: string): Promise<boolean> {
    const result = await this.database.db
      .delete(deploymentRules)
      .where(eq(deploymentRules.id, id))

    return result.rowCount ? result.rowCount > 0 : false
  }

  /**
   * Increment trigger count when a rule is used
   */
  async incrementTriggerCount(id: string): Promise<void> {
    const rule = await this.getRuleById(id)
    if (!rule) {
      return
    }

    const currentCount = rule.metadata?.triggerCount || 0

    await this.database.db
      .update(deploymentRules)
      .set({
        metadata: {
          ...rule.metadata,
          triggerCount: currentCount + 1,
          lastTriggeredAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(deploymentRules.id, id))
  }

  /**
   * Validate rule configuration
   */
  validateRuleConfig(input: CreateDeploymentRuleInput): {
    valid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    // Validate trigger-specific requirements
    switch (input.trigger) {
      case 'push':
        if (!input.branchPattern) {
          errors.push('Push trigger requires branchPattern')
        }
        break

      case 'pull_request':
        if (!input.branchPattern && !input.prLabels) {
          errors.push(
            'Pull request trigger requires branchPattern or prLabels'
          )
        }
        if (input.requireApproval && !input.minApprovals) {
          errors.push('requireApproval requires minApprovals to be set')
        }
        break

      case 'tag':
        if (!input.tagPattern) {
          errors.push('Tag trigger requires tagPattern')
        }
        break

      case 'release':
        // Release trigger is optional, can match all releases
        break

      case 'manual':
        // Manual trigger has no specific requirements
        break
    }

    // Validate priority
    if (input.priority !== undefined && (input.priority < 0 || input.priority > 100)) {
      errors.push('Priority must be between 0 and 100')
    }

    // Validate environment
    const validEnvironments = ['production', 'staging', 'preview', 'development']
    if (!validEnvironments.includes(input.environment)) {
      errors.push(`Environment must be one of: ${validEnvironments.join(', ')}`)
    }

    // Validate approval settings
    if (input.minApprovals !== undefined && input.minApprovals !== null && input.minApprovals < 0) {
      errors.push('minApprovals must be non-negative')
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Test if a rule would match a given event (for testing purposes)
   */
  testRuleMatch(
    rule: SelectDeploymentRule,
    testEvent: {
      type: 'push' | 'pull_request' | 'tag' | 'release'
      branch?: string
      tag?: string
      prAction?: string
      prLabels?: string[]
      prTargetBranch?: string
    }
  ): { matches: boolean; reason: string } {
    // Check if rule is enabled
    if (!rule.isEnabled) {
      return { matches: false, reason: 'Rule is disabled' }
    }

    // Check trigger type
    const eventTriggerMap: Record<string, DeploymentRuleTrigger> = {
      push: 'push',
      pull_request: 'pull_request',
      tag: 'tag',
      release: 'release',
    }

    if (rule.trigger !== eventTriggerMap[testEvent.type]) {
      return { matches: false, reason: `Trigger type mismatch: expected ${rule.trigger}, got ${testEvent.type}` }
    }

    // Type-specific matching
    switch (testEvent.type) {
      case 'push':
        if (testEvent.branch && rule.branchPattern) {
          if (!this.matchesPattern(testEvent.branch, rule.branchPattern)) {
            return { matches: false, reason: `Branch ${testEvent.branch} does not match pattern ${rule.branchPattern}` }
          }
          if (rule.excludeBranchPattern && this.matchesPattern(testEvent.branch, rule.excludeBranchPattern)) {
            return { matches: false, reason: `Branch ${testEvent.branch} matches exclude pattern ${rule.excludeBranchPattern}` }
          }
        }
        break

      case 'pull_request':
        if (testEvent.branch && rule.branchPattern) {
          if (!this.matchesPattern(testEvent.branch, rule.branchPattern)) {
            return { matches: false, reason: `Branch ${testEvent.branch} does not match pattern ${rule.branchPattern}` }
          }
        }
        if (testEvent.prTargetBranch && rule.prTargetBranches) {
          if (!rule.prTargetBranches.includes(testEvent.prTargetBranch)) {
            return { matches: false, reason: `Target branch ${testEvent.prTargetBranch} not in allowed list` }
          }
        }
        if (testEvent.prLabels && rule.prLabels) {
          const hasAllLabels = rule.prLabels.every(label => testEvent.prLabels?.includes(label))
          if (!hasAllLabels) {
            return { matches: false, reason: `PR does not have all required labels: ${rule.prLabels.join(', ')}` }
          }
        }
        break

      case 'tag':
        if (testEvent.tag && rule.tagPattern) {
          if (!this.matchesPattern(testEvent.tag, rule.tagPattern)) {
            return { matches: false, reason: `Tag ${testEvent.tag} does not match pattern ${rule.tagPattern}` }
          }
        }
        break

      case 'release':
        // Release trigger matches all published releases
        // Could add tag pattern matching if needed
        break
    }

    return { matches: true, reason: 'Rule matches all criteria' }
  }

  /**
   * Pattern matching utility (glob-style wildcards)
   */
  private matchesPattern(value: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\?/g, '.') // Convert ? to .

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(value)
  }
}
