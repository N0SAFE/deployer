/**
 * @fileoverview Canonical deployable Swarm service specification.
 *
 * The platform-owned, fully typed shape describing a service the platform
 * wants to run on the Swarm cluster. It is deliberately independent from
 * dockerode's (permissive) types: pure mappers (`toDockerServiceSpec`)
 * translate it to a dockerode `CreateServiceOptions` at the runner boundary.
 */

import z from 'zod/v4'

// ─── Placement ──────────────────────────────────────────────────────────────

export const swarmPlacementPreferenceSchema = z.object({
  spreadDescriptor: z.string().min(1),
})
export type SwarmPlacementPreference = z.infer<typeof swarmPlacementPreferenceSchema>

// ─── Resources ──────────────────────────────────────────────────────────────

export const swarmResourcesShapeSchema = z.object({
  nanoCpus: z.number().nonnegative().optional(),
  memoryBytes: z.number().nonnegative().optional(),
})
export type SwarmResourcesShape = z.infer<typeof swarmResourcesShapeSchema>

// ─── Healthcheck (dockerode HealthConfig parity, ms-based for humans) ───────

export const swarmHealthcheckConfigSchema = z
  .object({
    test: z.array(z.string().min(1)).optional(),
    intervalMs: z.number().positive().optional(),
    timeoutMs: z.number().positive().optional(),
    retries: z.number().int().positive().optional(),
    startPeriodMs: z.number().positive().optional(),
  })
  .nullable()
  .default(null)
export type SwarmHealthcheckConfig = z.infer<typeof swarmHealthcheckConfigSchema>

// ─── Update / rollback config ───────────────────────────────────────────────

export const swarmUpdateConfigSchema = z
  .object({
    parallelism: z.number().int().positive().default(1),
    delayMs: z.number().nonnegative().default(0),
    order: z.enum(['start-first', 'stop-first']).default('start-first'),
    failureAction: z.enum(['pause', 'continue', 'rollback']).default('rollback'),
  })
  .default({ parallelism: 1, delayMs: 0, order: 'start-first', failureAction: 'rollback' })
export type SwarmUpdateConfig = z.infer<typeof swarmUpdateConfigSchema>

// ─── Mounts (named-volume storage bindings) ──────────────────────────────────

export const swarmMountSchema = z.object({
  type: z.enum(['bind', 'volume', 'tmpfs']).default('volume'),
  source: z.string().min(1),
  target: z.string().min(1),
  readOnly: z.boolean().default(false),
})
export type SwarmMount = z.infer<typeof swarmMountSchema>

// ─── Endpoint ports ──────────────────────────────────────────────────────

export const swarmEndpointPortSchema = z.object({
  targetPort: z.number().int().min(1).max(65535),
  publishedPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
})
export type SwarmEndpointPort = z.infer<typeof swarmEndpointPortSchema>

export const swarmEndpointPortsSchema = z.array(swarmEndpointPortSchema).default([])
export type SwarmEndpointPorts = z.infer<typeof swarmEndpointPortsSchema>

// ─── The canonical spec ─────────────────────────────────────────────────────

export const swarmServiceSpecInputSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  replicas: z.number().int().positive().default(1),
  /** "K=V" entries — matches dockerode ContainerSpec.Env. */
  env: z.array(z.string().min(1)).default([]),
  command: z.array(z.string()).default([]),
  args: z.array(z.string()).default([]),
  /** Service-level labels (also carried by Traefik swarm provider). */
  labels: z.record(z.string(), z.string()).default({}),
  containerLabels: z.record(z.string(), z.string()).default({}),
  mounts: z.array(swarmMountSchema).default([]),
  placementPreferences: z.array(swarmPlacementPreferenceSchema).default([]),
  placementConstraints: z.array(z.string()).default([]),
  resourcesLimits: swarmResourcesShapeSchema.default({}),
  resourcesReservations: swarmResourcesShapeSchema.default({}),
  /** Overlay network names (created via `ensureOverlayNetwork`). */
  networks: z.array(z.string().min(1)).default([]),
  healthcheck: swarmHealthcheckConfigSchema,
  updateConfig: swarmUpdateConfigSchema,
  rollbackConfig: swarmUpdateConfigSchema.optional(),
  endpointPorts: swarmEndpointPortsSchema,
})
export type SwarmServiceSpecInput = z.infer<typeof swarmServiceSpecInputSchema>