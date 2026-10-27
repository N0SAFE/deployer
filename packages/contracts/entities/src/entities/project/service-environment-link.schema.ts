import z from 'zod/v4'
import { serviceEnvironmentExecutionOverrideSchema } from '../configuration/service-overrides.schema'

/**
 * SERVICE × ENVIRONMENT LINK — a service's membership + overrides in a given
 * environment. This is the "environment links to services" primitive:
 * a service participates in an env (isEnabled) with optional per-env
 * execution overrides (replicas, strategy, dependency link policy, …).
 *
 * Example: `api-prod` is linked to env `production` (enabled, 3 replicas) and
 * to env `qa` (enabled, 1 replica) — same service, different rules per env.
 */
export const serviceEnvironmentLinkSchema = z
  .object({
    id: z.uuid(),
    serviceId: z.uuid(),
    environmentId: z.uuid(),
    /** Whether the service participates in this environment. */
    isEnabled: z.boolean().default(true),
    /** Per-environment execution overrides (replicas, strategy, deps, …). */
    overrides: serviceEnvironmentExecutionOverrideSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
export type ServiceEnvironmentLink = z.infer<typeof serviceEnvironmentLinkSchema>

/** Create/update input for a service×environment link. */
export const serviceEnvironmentLinkInputSchema = z
  .object({
    serviceId: z.uuid(),
    environmentId: z.uuid(),
    isEnabled: z.boolean().default(true),
    overrides: serviceEnvironmentExecutionOverrideSchema.optional(),
  })
  .strict()
export type ServiceEnvironmentLinkInput = z.infer<typeof serviceEnvironmentLinkInputSchema>
