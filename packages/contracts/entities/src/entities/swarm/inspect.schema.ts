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