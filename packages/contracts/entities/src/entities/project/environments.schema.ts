import z from 'zod/v4'
import {
  environmentKindSchema,
  environmentStatusSchema as commonEnvironmentStatusSchema,
  environmentTriggerSchema,
  projectEnvironmentDeploymentStrategySchema,
  projectEnvironmentHealthGateSchema,
  projectEnvironmentStartupModeSchema,
  envNameSchema,
} from '@repo/contracts-common'

/**
 * LEGACY aliases — the old `environmentTypeSchema` was the built-in env NAME
 * enum. New code uses `kind` (stable | preview | ephemeral); these stay for
 * backward-compat with existing contract shapes.
 */
export const environmentStatusSchema = commonEnvironmentStatusSchema
export const environmentTypeSchema = envNameSchema

/**
 * PER-ENVIRONMENT RULES — the specific behavior of THIS environment.
 * Environments are first-class primitives: each carries its own rules so the
 * platform can treat every env independently (any name, any kind).
 */
export const environmentRulesSchema = z
  .object({
    /** Compose-profile style: optional services participating in this env. */
    profiles: z.array(z.string()).default([]),
    /** Auto-deploy on push (stable) / on trigger (preview/ephemeral). */
    autoDeployEnabled: z.boolean().default(true),
    deploymentStrategy: projectEnvironmentDeploymentStrategySchema.default('rolling'),
    healthGate: projectEnvironmentHealthGateSchema.default('strict'),
    startupMode: projectEnvironmentStartupModeSchema.default('parallel'),
    replicas: z
      .object({
        min: z.number().int().nonnegative().default(1),
        max: z.number().int().nonnegative().default(1),
      })
      .default({ min: 1, max: 1 }),
    trafficPolicy: z
      .object({
        maxErrorRatePercent: z.number().default(5),
        maxLatencyMs: z.number().nonnegative().default(1000),
        allowCrossRegionFailover: z.boolean().default(false),
      })
      .default({ maxErrorRatePercent: 5, maxLatencyMs: 1000, allowCrossRegionFailover: false }),
  })
  .strict()
export type EnvironmentRules = z.infer<typeof environmentRulesSchema>

/**
 * ENVIRONMENT — a first-class primitive linked to a project.
 *
 * Environments are NO LONGER built-in names: any env can be created with a
 * free-form NAME + a KIND (stable | preview | ephemeral) + per-env RULES +
 * an optional TRIGGER (how preview/ephemeral envs are brought to life).
 *
 * `type` is the LEGACY built-in name (production/staging/preview/development)
 * kept for backward-compat with deployments; new custom envs leave it null and
 * rely on `kind`.
 */
export const projectEnvironmentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** Free-form env name (production, staging, qa, feat-x, perf-test, …). */
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  /** The primitive TYPE: stable | preview | ephemeral. */
  kind: environmentKindSchema.default('stable'),
  /** Legacy built-in name (production/staging/preview/development) or null. */
  type: envNameSchema.nullable().optional(),
  status: commonEnvironmentStatusSchema,
  /** Per-env rules (profiles, autoDeploy, strategy, health gate, replicas…). */
  rules: environmentRulesSchema.default({
    profiles: [],
    autoDeployEnabled: true,
    deploymentStrategy: 'rolling',
    healthGate: 'strict',
    startupMode: 'parallel',
    replicas: { min: 1, max: 1 },
    trafficPolicy: { maxErrorRatePercent: 5, maxLatencyMs: 1000, allowCrossRegionFailover: false },
  }),
  /** How a preview/ephemeral env is triggered (PR, branch, webhook, schedule). */
  trigger: environmentTriggerSchema.nullable().default(null),
  isActive: z.boolean().default(true),
  domainConfig: z
    .object({
      baseDomain: z.string().optional(),
      subdomain: z.string().optional(),
      customDomain: z.string().optional(),
      sslEnabled: z.boolean().optional(),
    })
    .nullable(),
  deploymentConfig: z
    .object({
      autoDeployEnabled: z.boolean().optional(),
      deploymentStrategy: z.enum(['rolling', 'blue-green', 'canary', 'recreate']).optional(),
      maxInstances: z.number().optional(),
      deployTimeoutMinutes: z.number().optional(),
    })
    .nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
