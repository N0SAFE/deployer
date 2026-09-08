/**
 * @fileoverview Canonical parsed Swarm service / node / task / secret /
 * config snapshots — the platform-facing shapes derived from raw engine
 * responses (`dockerode.schema.ts`) or returned by the `DockerService` SDK
 * group. Business logic (reconciliation, inventory, runner convergence)
 * consumes these types, never dockerode's loose shapes.
 */

import z from 'zod/v4'

// ─── Service inspect snapshot ───────────────────────────────────────────────

export const swarmServiceInspectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  versionIndex: z.number().int().default(0),
  image: z.string().default(''),
  labels: z.record(z.string(), z.string()).default({}),
  /** null when the service runs in global mode. */
  replicas: z.number().int().nonnegative().nullable(),
  networks: z.array(z.string().min(1)).default([]),
  updateStatus: z
    .object({
      state: z.string(),
      startedAt: z.string().nullable(),
      message: z.string().nullable(),
    })
    .nullable()
    .default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})
export type SwarmServiceInspect = z.infer<typeof swarmServiceInspectSchema>

// ─── Node snapshot ──────────────────────────────────────────────────────────

export const swarmNodeSchema = z.object({
  id: z.string().min(1),
  nodeName: z.string().default(''),
  hostname: z.string().default(''),
  role: z.enum(['manager', 'worker']).default('worker'),
  availability: z.enum(['active', 'pause', 'drain']).default('active'),
  state: z.enum(['unknown', 'down', 'ready', 'disconnected']).default('unknown'),
  address: z.string().default(''),
  labels: z.record(z.string(), z.string()).default({}),
  isLeader: z.boolean().nullable().default(null),
  reachability: z.string().nullable().default(null),
  engineVersion: z.string().nullable().default(null),
  nanoCpus: z.number().nonnegative().nullable().default(null),
  memoryBytes: z.number().nonnegative().nullable().default(null),
  versionIndex: z.number().int().default(0),
})
export type SwarmNode = z.infer<typeof swarmNodeSchema>

// ─── Task snapshot ──────────────────────────────────────────────────────────

export const swarmTaskSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().default(''),
  nodeId: z.string().nullable().default(null),
  slot: z.number().int().nullable().default(null),
  state: z.string().default(''),
  desiredState: z.string().default(''),
  error: z.string().nullable().default(null),
  containerId: z.string().nullable().default(null),
  updatedAt: z.string().default(''),
})
export type SwarmTask = z.infer<typeof swarmTaskSchema>

export const swarmTaskStateCheckSchema = z.object({
  runningCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  ready: z.boolean(),
})
export type SwarmTaskStateCheck = z.infer<typeof swarmTaskStateCheckSchema>

// ─── Fleet runtime views (cluster contract surface) ─────────────────────────

/**
 * Live service summary — the mesh-wide view of a running swarm service:
 * deployment mode (global runs on every node; replicated has a target
 * replica count), image, desired vs running tasks. Produced by
 * `SwarmFleetService` from engine probes.
 */
export const swarmServiceRuntimeSchema = swarmServiceInspectSchema.extend({
  mode: z.enum(['global', 'replicated']),
  /** null when global (runs everywhere). */
  replicas: z.number().int().nonnegative().nullable(),
  desiredTasks: z.number().int().nonnegative().default(0),
  runningTasks: z.number().int().nonnegative().default(0),
})
export type SwarmServiceRuntime = z.infer<typeof swarmServiceRuntimeSchema>

/**
 * Live task summary — one swarm task with its scheduling slot and the
 * owning service's name (joined by the aggregation service). Container id
 * is null until the task has been assigned a container.
 */
export const swarmTaskRuntimeSchema = swarmTaskSchema.extend({
  serviceName: z.string().default(''),
  image: z.string().default(''),
})
export type SwarmTaskRuntime = z.infer<typeof swarmTaskRuntimeSchema>

// ─── Per-node docker artifact summaries (node resources surface) ────────────

export const swarmNodeImageSummarySchema = z.object({
  id: z.string(),
  repoTags: z.array(z.string()).default([]),
  sizeBytes: z.number().nullable().default(null),
})
export type SwarmNodeImageSummary = z.infer<typeof swarmNodeImageSummarySchema>

export const swarmNodeNetworkSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string().default(''),
  scope: z.string().default(''),
})
export type SwarmNodeNetworkSummary = z.infer<typeof swarmNodeNetworkSummarySchema>

export const swarmNodeVolumeSummarySchema = z.object({
  name: z.string(),
  driver: z.string().default(''),
  mountpoint: z.string().default(''),
})
export type SwarmNodeVolumeSummary = z.infer<typeof swarmNodeVolumeSummarySchema>

/**
 * Per-node resource aggregation: swarm services/tasks scheduled on the node
 * plus (when the API node is the queried node — `dockerScope: 'local'`) the
 * engine's local images/networks/volumes. Remote nodes only expose the
 * swarm-visible portion (`dockerScope: 'remote'`, docker arrays empty).
 */
export const swarmNodeResourcesSchema = z.object({
  nodeId: z.string().min(1),
  dockerScope: z.enum(['local', 'remote']),
  services: z.array(swarmServiceRuntimeSchema).default([]),
  tasks: z.array(swarmTaskRuntimeSchema).default([]),
  images: z.array(swarmNodeImageSummarySchema).default([]),
  networks: z.array(swarmNodeNetworkSummarySchema).default([]),
  volumes: z.array(swarmNodeVolumeSummarySchema).default([]),
})
export type SwarmNodeResources = z.infer<typeof swarmNodeResourcesSchema>

// ─── Secret / Config snapshot ───────────────────────────────────────────────

export const swarmSecretSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  labels: z.record(z.string(), z.string()).default({}),
  versionIndex: z.number().int().default(0),
  createdAt: z.string().default(''),
})
export type SwarmSecret = z.infer<typeof swarmSecretSchema>

export const swarmConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  labels: z.record(z.string(), z.string()).default({}),
  versionIndex: z.number().int().default(0),
  createdAt: z.string().default(''),
})
export type SwarmConfig = z.infer<typeof swarmConfigSchema>

// ─── Overlay network request / summary ──────────────────────────────────────

export const swarmOverlayNetworkRequestSchema = z.object({
  name: z.string().min(1),
  driver: z.string().default('overlay'),
  attachable: z.boolean().default(true),
  ingress: z.boolean().default(false),
  labels: z.record(z.string(), z.string()).default({}),
  enableIpv6: z.boolean().default(false),
})
export type SwarmOverlayNetworkRequest = z.infer<typeof swarmOverlayNetworkRequestSchema>