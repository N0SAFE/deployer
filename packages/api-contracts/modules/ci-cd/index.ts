import { oc } from '@orpc/contract';
import { pipelineManagementContract } from './pipeline-management';
import { buildAutomationContract } from './build-automation';
import { webhookManagementContract } from './webhook-management';
import { z } from 'zod';
import { CiCdOverviewSchema } from './schemas';

/**
 * CI/CD Contract - Advanced Pipeline Automation
 * 
 * **PURPOSE**: Provides comprehensive CI/CD pipeline capabilities for complex automated workflows
 * 
 * **SCOPE**: This contract handles sophisticated automation scenarios including:
 * - Multi-stage pipeline orchestration with templates and validation
 * - Advanced build automation with artifacts, caching, and multiple environments  
 * - Webhook integrations for third-party service notifications
 * - Cross-module analytics and insights for CI/CD performance
 * 
 * **USAGE GUIDELINES**:
 * ✅ Use for: Complex multi-stage CI/CD workflows, build pipelines, webhook automation
 * ❌ Don't use for: Simple service deployments (use main `deployment` contract instead)
 * 
 * **FRONTEND INTEGRATION**: ❌ Not directly used by frontend components
 * - Designed for backend automation and API integrations
 * - May be used by future advanced CI/CD dashboard features
 * 
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - Complements `deployment` contract (does not duplicate it)
 * - Uses `webhook` events to trigger `deployment` operations
 * - Integrates with `project` and `service` contracts for pipeline context
 * 
 * Routes: /ci-cd/*
 * Status: 🟡 Partially Active - Backend automation ready, frontend integration pending
 * Maturity: Production Ready
 * 
 * @example
 * // Complex pipeline workflow
 * const pipeline = await orpc.ciCd.pipeline.create({
 *   name: "Full Stack CI/CD",
 *   stages: [
 *     { name: "test", script: "npm test" },
 *     { name: "build", script: "npm run build" },  
 *     { name: "deploy", script: "deploy-to-staging" }
 *   ]
 * });
 * 
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../deployment/index.ts for simple deployment operations
 * @see ../webhook/index.ts for basic webhook management (if separate)
 */
export const ciCdContract = oc.router({
  // =============================================================================
  // PIPELINE MANAGEMENT
  // =============================================================================
  
  /** Pipeline configuration, templates, and execution control */
  pipeline: pipelineManagementContract,

  // =============================================================================
  // BUILD AUTOMATION  
  // =============================================================================
  
  /** Build orchestration, artifacts, and build environment management */
  build: buildAutomationContract,

  // =============================================================================
  // WEBHOOK INTEGRATION
  // =============================================================================
  
  /** Webhook configuration, delivery tracking, and event management */
  webhook: webhookManagementContract,
  
  // =============================================================================
  // OVERVIEW & ANALYTICS
  // =============================================================================
  
  /** CI/CD overview with cross-module statistics and insights */
  getOverview: oc
    .route({
      method: 'GET',
      path: '/overview',
      summary: 'Get CI/CD overview with statistics from all modules',
    })
    .input(z.object({
      projectId: z.string().optional(),
      timeRange: z.enum(['day', 'week', 'month', 'quarter']).default('week'),
    }))
    .output(CiCdOverviewSchema)
    .meta({
      description: 'Get CI/CD overview with statistics from all pipeline, build, and webhook modules',
      tags: ['CI/CD Overview'],
    }),
});

export type CiCdContract = typeof ciCdContract;

// Re-export schemas and types (excluding deployment-related exports)
export * from './schemas';
export * from './pipeline-management';
export * from './build-automation';
export * from './webhook-management';

// Note: deployment-automation exports removed to eliminate duplication with main deployment contract