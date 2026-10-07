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

/**
 * How many tasks of ONE service may land on the SAME node.
 *
 * Maps to Swarm's `Placement.MaxReplicas`. It is the only way to express
 * "spread these replicas so they cannot fail together" as a hard limit: a
 * spread PREFERENCE (`placementPreferences`) only biases the scheduler, so with
 * two replicas and two nodes it can still place both on one node.
 *
 * That gap was live in this codebase: the Cloudflare connector supervisor
 * documented `maxReplicasPerNode = 1` as the guarantee that kept two connectors
 * from being "lost together", while the spec it built had
 * `placementPreferences: []` and no such field could be expressed at all — a
 * comment describing a guarantee the schema could not make. This field is what
 * makes the claim true.
 */
export const swarmPlacementMaxReplicasPerNodeSchema = z.number().int().positive().optional()
export type SwarmPlacementMaxReplicasPerNode = z.infer<typeof swarmPlacementMaxReplicasPerNodeSchema>

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
  /**
   * How the published port is realised.
   *   - "ingress" (default) → published on EVERY node through the routing
   *     mesh (load balanced). Right for mesh-wide services.
   *   - "host"              → published ONLY on the node running the task,
   *     bypassing the mesh. Required for NODE-LOCAL entry points: a GLOBAL
   *     service publishing with the default "ingress" mode is rejected by the
   *     engine (the mesh load balancer cannot front one task per node), and
   *     for an ingress that must serve every host independently "host" is the
   *     semantics we actually want.
   */
  publishMode: z.enum(['ingress', 'host']).optional(),
})
export type SwarmEndpointPort = z.infer<typeof swarmEndpointPortSchema>

export const swarmEndpointPortsSchema = z.array(swarmEndpointPortSchema).default([])
export type SwarmEndpointPorts = z.infer<typeof swarmEndpointPortsSchema>

// ─── Network attachments ────────────────────────────────────────────────────

/**
 * One network a task attaches to, with the DNS ALIASES it answers to.
 *
 * Aliases are load-bearing, not cosmetic: consumers address platform services
 * by their stable alias (`global-db`, `redis`, `traefik`, `db-<instance>`)
 * while the container may also carry a deployment prefix. A swarm service
 * without aliases would only answer to its service NAME, so every prefixed
 * deployment would break the alias-based URLs this platform persists.
 */
export const swarmNetworkAttachmentSchema = z.object({
  target: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
})
export type SwarmNetworkAttachment = z.infer<typeof swarmNetworkAttachmentSchema>

// ─── Linux capabilities ─────────────────────────────────────────────────────

/**
 * Linux capabilities ADDED to the task container. Default-deny is the engine's
 * behaviour, so anything beyond the runtime default (e.g. WireGuard needing
 * `NET_ADMIN` to create its interface) must be requested explicitly.
 */
export const swarmCapabilitiesSchema = z.array(z.string().min(1)).default([])

// ─── The canonical spec ─────────────────────────────────────────────────────

export const swarmServiceSpecInputSchema = z.object({
  name: z.string().min(1),
  image: z.string().min(1),
  /**
   * Scheduling mode.
   *   - "replicated" → `Mode.Replicated.Replicas` (default — user workloads).
   *   - "global"     → `Mode.Global` — one task on EVERY node. Used by the
   *                    platform supervisors (ingress / redis / databases) so
   *                    each node runs its own copy of the node-local infra.
   */
  mode: z.enum(["replicated", "global"]).default("replicated"),
  /** Active only when `mode === "replicated"`. Ignored in global mode. */
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
  /**
   * Hard cap on tasks of THIS service per node (`Placement.MaxReplicas`).
   *
   * Unset means the engine's default (no cap). Set it to 1 for any service
   * whose replicas must not share a node — an edge connector is the motivating
   * case: two connectors on one node are both lost when that node goes, which
   * defeats the point of running two. A spread preference alone does NOT
   * guarantee that; see `swarmPlacementMaxReplicasPerNodeSchema`.
   */
  placementMaxReplicasPerNode: swarmPlacementMaxReplicasPerNodeSchema,
  resourcesLimits: swarmResourcesShapeSchema.default({}),
  resourcesReservations: swarmResourcesShapeSchema.default({}),
  /** Overlay networks the task attaches to (created via `ensureOverlayNetwork`). */
  networks: z.array(swarmNetworkAttachmentSchema).default([]),
  /** Linux capabilities ADDED to the task container (e.g. `NET_ADMIN`). */
  capabilitiesAdd: z.array(z.string().min(1)).optional(),
  healthcheck: swarmHealthcheckConfigSchema,
  updateConfig: swarmUpdateConfigSchema,
  rollbackConfig: swarmUpdateConfigSchema.optional(),
  endpointPorts: swarmEndpointPortsSchema,
  /**
   * How the service's DNS NAME resolves inside the overlay.
   *   - "vip"   (default) → the embedded DNS answers with a VIRTUAL IP that the
   *               node's IPVS load-balances across the tasks. Right for a
   *               multi-replica service reached by many consumers.
   *   - "dnsrr"           → DNS answers with the TASK IPs directly, so traffic
   *               never traverses the load balancer.
   *
   * `dnsrr` is what SINGLE-REPLICA infrastructure wants (the global database,
   * Redis): a VIP for one task adds a load-balancer hop that can only ever
   * forward to that same task, so it is pure risk — and when the node's IPVS
   * rules are missing or stale the VIP accepts nothing at all and every
   * consumer gets `ECONNREFUSED` while the task is perfectly healthy on its
   * own address. That failure mode is indistinguishable from a dead database
   * and is exactly what `dnsrr` removes.
   */
  endpointMode: z.enum(["vip", "dnsrr"]).default("vip"),
  /**
   * Seconds the engine waits after SIGTERM before SIGKILL when stopping a
   * task. STATEFUL services (Postgres, Redis) must set enough of it to shut
   * down cleanly — a SIGKILL mid-write corrupts the data directory
   * ("could not locate a valid checkpoint record"). Default matches Docker's.
   */
  stopGracePeriodSeconds: z.number().int().min(0).default(10),
})
export type SwarmServiceSpecInput = z.infer<typeof swarmServiceSpecInputSchema>