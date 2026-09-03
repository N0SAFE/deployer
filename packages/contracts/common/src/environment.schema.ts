import z from 'zod'

/**
 * ENVIRONMENT KIND — the primitive TYPE of an environment (decoupled from its
 * NAME). Environments are first-class entities: you can create ANY env name
 * (qa, feature-x, perf-test, ...) and give it a KIND that defines how it
 * behaves:
 *  - stable:    persistent, shared, long-lived (production, staging, dev)
 *  - preview:   ephemeral, per-PR/branch, auto-created + auto-destroyed
 *               (triggered via pull-request / branch / webhook / schedule)
 *  - ephemeral: short-lived test envs (manual trigger, TTL-based)
 */
export const environmentKindSchema = z.enum(['stable', 'preview', 'ephemeral'])
export type EnvironmentKind = z.infer<typeof environmentKindSchema>
export const ENVIRONMENT_KINDS = [...environmentKindSchema.options] as readonly EnvironmentKind[]
export const ENVIRONMENT_KIND_VALUES = environmentKindSchema.options

/**
 * ENVIRONMENT TRIGGER — how a non-stable (preview/ephemeral) environment is
 * brought to life. `manual` = user clicks "create"; the rest are event-driven:
 *  - pull-request: created when a PR opens/reopens (sourcePR)
 *  - branch:       created when a branch push matches (sourceBranch)
 *  - webhook:      created by an external webhook call
 *  - schedule:     created on a cron/interval
 * Stable environments have no trigger (always exist).
 */
export const environmentTriggerSourceSchema = z.enum([
    'manual',
    'webhook',
    'pull-request',
    'branch',
    'schedule',
])
export type EnvironmentTriggerSource = z.infer<typeof environmentTriggerSourceSchema>

export const environmentTriggerSchema = z
    .object({
        source: environmentTriggerSourceSchema,
        /** For source=branch: the branch pattern (e.g. feat/*). */
        sourceBranch: z.string().optional(),
        /** For source=pull-request: the PR number that created this env. */
        sourcePR: z.number().int().positive().optional(),
        /** For source=schedule: cron expression. */
        schedule: z.string().optional(),
        /** Optional webhook secret ref for source=webhook. */
        webhookSecretRef: z.string().optional(),
        /** TTL after which the env auto-destroys (hours). */
        ttlHours: z.number().int().positive().optional(),
        /** Whether the env auto-destroys when its source PR closes/merges. */
        destroyOnMerge: z.boolean().default(false),
    })
    .strict()
export type EnvironmentTrigger = z.infer<typeof environmentTriggerSchema>

/**
 * Legacy built-in env NAMES (production/staging/preview/development). Kept for
 * deployment backward-compat (deployments.environment enum) and as convenient
 * defaults when seeding a project. New environments use free-form names.
 */
export const envNameSchema = z.enum(['production', 'staging', 'preview', 'development'])
export type EnvName = z.infer<typeof envNameSchema>
export const ENV_NAMES = [...envNameSchema.options] as readonly EnvName[]
export const ENV_NAME_VALUES = envNameSchema.options
export const REQUIRED_ENV_NAMES = ['production'] as const
export const SPECIAL_ENV_NAMES = ['preview', 'development'] as const

export const withRequiredEnvironments = <T extends z.ZodTypeAny>(valueSchema: T) =>
	z
		.object({
			production: valueSchema,
			staging: valueSchema.optional(),
			preview: valueSchema.optional(),
			development: valueSchema.optional(),
		})
		.catchall(valueSchema)

export const projectEnvironmentDeploymentStrategySchema = z.enum(['rolling', 'canary', 'blue-green', 'manual'])
export type ProjectEnvironmentDeploymentStrategy = z.infer<typeof projectEnvironmentDeploymentStrategySchema>

export const projectEnvironmentHealthGateSchema = z.enum(['strict', 'warn', 'ignore'])
export type ProjectEnvironmentHealthGate = z.infer<typeof projectEnvironmentHealthGateSchema>

export const projectEnvironmentStartupModeSchema = z.enum(['before', 'parallel', 'after'])
export type ProjectEnvironmentStartupMode = z.infer<typeof projectEnvironmentStartupModeSchema>

export const serviceHealthProtocolSchema = z.enum(['http', 'tcp', 'grpc', 'command'])
export type ServiceHealthProtocol = z.infer<typeof serviceHealthProtocolSchema>

export const serviceLifecycleSchema = z.enum(['running', 'degraded', 'starting', 'stopped', 'maintenance'])
export type ServiceLifecycle = z.infer<typeof serviceLifecycleSchema>

export const serviceHealthStateSchema = z.enum(['passing', 'warning', 'failing', 'unknown'])
export type ServiceHealthState = z.infer<typeof serviceHealthStateSchema>
