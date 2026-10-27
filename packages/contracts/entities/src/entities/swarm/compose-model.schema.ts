/**
 * @fileoverview Typed Compose model + compatibility report for the
 * Compose→Swarm realizer (docs/swarm-orchestration/05 §6, SW-025).
 *
 * The platform implements its own compose→swarm transform (NO `docker stack
 * deploy` — that's a client-side compose transform with no Engine-API
 * equivalent). This schema is the canonical intermediate model: parsed
 * compose YAML lands in these shapes, `validateCompatibility` produces an
 * actionable report, and `realizeCompose` maps it onto `SwarmServiceSpecInput`.
 */

import z from 'zod/v4'
import { swarmServiceSpecInputSchema } from './service.spec.schema'

// ─── Compatibility report ───────────────────────────────────────────────────

export const composeCompatibilitySeveritySchema = z.enum(['error', 'warn'])
export type ComposeCompatibilitySeverity = z.infer<typeof composeCompatibilitySeveritySchema>

export const composeCompatibilityIssueSchema = z.object({
  /** dot path into the compose model, e.g. `services.api.build`. */
  path: z.string().min(1),
  severity: composeCompatibilitySeveritySchema,
  message: z.string().min(1),
})
export type ComposeCompatibilityIssue = z.infer<typeof composeCompatibilityIssueSchema>

export const composeCompatibilityReportSchema = z.object({
  issues: z.array(composeCompatibilityIssueSchema).default([]),
})
export type ComposeCompatibilityReport = z.infer<typeof composeCompatibilityReportSchema>

// ─── Port mapping ───────────────────────────────────────────────────────────

export const composePortSchema = z.object({
  targetPort: z.number().int().min(1).max(65535),
  publishedPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})
export type ComposePort = z.infer<typeof composePortSchema>

// ─── Healthcheck (compose form) ─────────────────────────────────────────────

export const composeHealthcheckSchema = z
  .object({
    test: z.array(z.string().min(1)).optional(),
    intervalMs: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional(),
    retries: z.number().int().positive().optional(),
    startPeriodMs: z.number().positive().optional(),
  })
  .nullable()
  .default(null)
export type ComposeHealthcheck = z.infer<typeof composeHealthcheckSchema>

// ─── Deploy block ───────────────────────────────────────────────────────────

export const composeDeploySchema = z.object({
  replicas: z.number().int().positive().default(1),
  updateOrder: z.enum(['start-first', 'stop-first']).default('start-first'),
  failureAction: z.enum(['pause', 'continue', 'rollback']).default('rollback'),
  constraints: z.array(z.string()).default([]),
  preferences: z.array(z.string()).default([]),
  cpuLimit: z.number().positive().optional(),
  memoryLimitBytes: z.number().positive().optional(),
  restartCondition: z.enum(['none', 'on-failure', 'any']).default('any'),
})
export type ComposeDeploy = z.infer<typeof composeDeploySchema>

// ─── Service ────────────────────────────────────────────────────────────────

export const composeServiceModelSchema = z.object({
  name: z.string().min(1),  /** null = image-less (build-only) — incompatible on swarm without an image. */
  image: z.string().min(1).nullable(),
  env: z.array(z.string().min(1)).default([]),
  command: z.array(z.string()).default([]),
  args: z.array(z.string()).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  dependsOn: z.array(z.string()).default([]),
  networks: z.array(z.string().min(1)).default([]),
  ports: z.array(composePortSchema).default([]),
  mounts: z
    .array(
      z.object({
        type: z.enum(['volume', 'bind', 'tmpfs']),
        source: z.string(),
        target: z.string().min(1),
        readOnly: z.boolean().default(false),
      }),
    )
    .default([]),
  healthcheck: composeHealthcheckSchema,
  deploy: composeDeploySchema,
  /** Secret/config references (by top-level name). */
  secretRefs: z.array(z.string().min(1)).default([]),
  configRefs: z.array(z.string().min(1)).default([]),
})
export type ComposeServiceModel = z.infer<typeof composeServiceModelSchema>

// ─── Top-level model ────────────────────────────────────────────────────────

export const composeModelSchema = z.object({
  services: z.array(composeServiceModelSchema).default([]),
  networks: z.record(
    z.string(),
    z.object({
      driver: z.string().default('overlay'),
      attachable: z.boolean().default(true),
      labels: z.record(z.string(), z.string()).default({}),
    }),
  ),
  secrets: z.record(z.string(), z.string()),
  configs: z.record(z.string(), z.string()),
  volumes: z.record(z.string(), z.record(z.string(), z.unknown())),
})
export type ComposeModel = z.infer<typeof composeModelSchema>

// ─── Realization plan ───────────────────────────────────────────────────────

export const composeRealizationPlanSchema = z.object({
  networks: z
    .array(
      z.object({
        name: z.string().min(1),
        driver: z.string().default('overlay'),
        attachable: z.boolean().default(true),
        labels: z.record(z.string(), z.string()).default({}),
      }),
    )
    .default([]),
  secrets: z
    .array(z.object({ name: z.string().min(1), data: z.string() }))
    .default([]),
  configs: z
    .array(z.object({ name: z.string().min(1), data: z.string() }))
    .default([]),
  /** Ordered by `depends_on` (topological); each carries its full spec. */
  services: z
    .array(
      z.object({
        serviceName: z.string().min(1),
        spec: swarmServiceSpecInputSchema,
      }),
    )
    .default([]),
})
export type ComposeRealizationPlan = z.infer<typeof composeRealizationPlanSchema>