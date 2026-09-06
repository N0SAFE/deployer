/**
 * @fileoverview Platform cluster state — the single source of truth for how
 * the platform views its Swarm fleet, independent from raw engine shapes.
 *
 * `ClusterNode` / `ClusterMaster` / `ClusterMembership` back the `cluster`
 * domain (node inventory, master election, membership tracking). `DockerService`
 * SDK + `SwarmClusterService` produce these from engine probes; later phases
 * persist them alongside `docker node ls` output for reconciliation.
 */

import z from 'zod/v4'

export const clusterSwarmRoleSchema = z.enum(['manager', 'worker', 'none'])
export type ClusterSwarmRole = z.infer<typeof clusterSwarmRoleSchema>

export const clusterPlatformRoleSchema = z.enum(['both', 'control', 'worker'])
export type ClusterPlatformRole = z.infer<typeof clusterPlatformRoleSchema>

export const clusterMembershipStateSchema = z.enum(['active', 'leaving', 'down', 'quorum-lost'])
export type ClusterMembershipState = z.infer<typeof clusterMembershipStateSchema>

// ─── Node ────────────────────────────────────────────────────────────────────

export const clusterNodeSchema = z.object({
  nodeId: z.string().min(1),
  hostname: z.string().default(''),
  swarmRole: clusterSwarmRoleSchema,
  platformRole: clusterPlatformRoleSchema.default('both'),
  isMaster: z.boolean().default(false),
  isIngress: z.boolean().default(false),
  availability: z.enum(['active', 'pause', 'drain']).default('active'),
  capacity: z
    .object({
      nanoCpus: z.number().nonnegative().nullable().default(null),
      memoryBytes: z.number().nonnegative().nullable().default(null),
    })
    .default({ nanoCpus: null, memoryBytes: null }),
  labels: z.record(z.string(), z.string()).default({}),
  lastHeartbeatAt: z.string().nullable().default(null),
})
export type ClusterNode = z.infer<typeof clusterNodeSchema>

// ─── Master (controlling manager) ───────────────────────────────────────────

export const clusterMasterSchema = z.object({
  nodeId: z.string().min(1),
  term: z.number().int().nonnegative().default(0),
  electedAt: z.string().default(''),
  heartbeatAt: z.string().default(''),
  reason: z.string().default(''),
})
export type ClusterMaster = z.infer<typeof clusterMasterSchema>

// ─── Membership ─────────────────────────────────────────────────────────────

export const clusterMembershipSchema = z.object({
  nodeId: z.string().min(1),
  state: clusterMembershipStateSchema,
  joinedAt: z.string().default(''),
})
export type ClusterMembership = z.infer<typeof clusterMembershipSchema>

// ─── Cluster snapshot (local node's view) ───────────────────────────────────

export const clusterSnapshotSchema = z.object({
  clusterId: z.string().nullable().default(null),
  clusterName: z.string().nullable().default(null),
  localNodeState: z.enum(['inactive', 'pending', 'active', 'error', 'locked']),
  controlAvailable: z.boolean().default(false),
  nodeCount: z.number().int().nonnegative().default(0),
  managerCount: z.number().int().nonnegative().default(0),
  localNode: clusterNodeSchema,
  master: clusterMasterSchema.nullable().default(null),
  membership: clusterMembershipSchema,
  joinTokens: z
    .object({
      worker: z.string(),
      manager: z.string(),
    })
    .nullable()
    .default(null),
})
export type ClusterSnapshot = z.infer<typeof clusterSnapshotSchema>