import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * This node, as its own agent keeps it.
 *
 * Two ids, two meanings: `agentId` is the agent's own identity on the mesh, generated on its first boot; `nodeId` is the
 * platform node id (the one the global database's `cluster_nodes` row is keyed by), written when the node is configured.
 * Before that write there is no platform id at all — nothing invents one, and nothing reads one from the environment.
 *
 * The config mirrors the `node_config` row: the agent owns the node's local database, so the services of the node read
 * and write it here instead of opening the SQLite file themselves.
 *
 * Served only on the node door (the agent's unix socket): a node's configuration is not a peer's business.
 */
export const meshNodeSetupStateSchema = z.enum([
    'not_started',
    'setup_in_progress',
    'setup_done',
    'upgrade_pending',
    'upgrade_in_progress',
    'upgrade_failed',
])

export const meshNodeSwarmConfigSchema = z.object({
    mode: z.enum(['create', 'join']),
    policy: z.enum(['auto', 'manager', 'worker']),
    advertiseAddr: z.string().nullable(),
    joinToken: z.string().nullable(),
    joinAddrs: z.array(z.string().min(1)),
})

export const meshNodeScanConfigSchema = z.object({
    autoScan: z.boolean(),
    scanners: z.array(z.enum(['trivy', 'grype', 'dive'])),
})

/** The node's mesh wiring: what peers reach this node on, and how strictly it trusts them. Null until configured. */
export const meshNodeMeshConfigSchema = z.object({
    nodeServerUrl: z.string().nullable(),
    bootstrapPeers: z.string().nullable(),
    syncIntervalMs: z.number(),
    /** A decimal string, as stored: the ratio is compared exactly, not through a float round-trip. */
    trustStrictMinAckRatio: z.string(),
    trustStrictMaxAckAgeSeconds: z.number(),
    trustStrictRolloutWaveSize: z.number(),
    trustStrictAutoRollback: z.boolean(),
    controlEnvelopeTrustRequired: z.boolean(),
})

/** The node's persisted configuration: the `node_config` row, minus what the agent owns itself. */
export const meshNodeConfigSchema = z.object({
    /** The platform node id, assigned when the node is configured (a UUID). Null on an unconfigured node. */
    nodeId: z.uuid().nullable(),
    strategy: z.enum(['local', 'remote']),
    setupState: meshNodeSetupStateSchema,
    /** The deployer version at setup, and at the last successful upgrade. */
    deployerVersion: z.string().nullable(),
    upgradedAtVersion: z.string().nullable(),
    databaseUrl: z.string().nullable(),
    databaseProvisioning: z.enum(['local', 'external']).nullable(),
    /** The peer addresses this node bootstraps from, in order. */
    meshUrlsSnapshot: z.array(z.string()),
    swarmConfig: meshNodeSwarmConfigSchema.nullable(),
    /** Long-lived peer service token issued by a remote mesh, and when it stops being accepted. */
    peerServiceToken: z.string().nullable(),
    peerServiceTokenExpiresAt: z.string().nullable(),
    /** The secret peers present to this node, and when it was last rotated. */
    meshSharedSecret: z.string().nullable(),
    meshSharedSecretUpdatedAt: z.string().nullable(),
    platformSecret: z.string().nullable(),
    platformSecretUpdatedAt: z.string().nullable(),
    scanConfig: meshNodeScanConfigSchema.nullable(),
    /** The node's mesh wiring, once something configured it. Null on an unconfigured node. */
    mesh: meshNodeMeshConfigSchema.nullable(),
    postSetupFlags: z.record(z.string(), z.string()).nullable(),
    /** ISO-8601, set once when the node is first configured. */
    configuredAt: z.string().nullable(),
    /** ISO-8601, the agent's clock at the last write. */
    updatedAt: z.string(),
})

export const meshNodeStateSchema = z.object({
    /** The agent's own identity on the mesh, generated on its first boot. Not the platform node id. */
    agentId: z.string().min(1),
    /** False until `node.configure` has written a config: a node that is running but not yet set up. */
    configured: z.boolean(),
    config: meshNodeConfigSchema.nullable(),
})

export type MeshNodeConfig = z.infer<typeof meshNodeConfigSchema>
export type MeshNodeMeshConfig = z.infer<typeof meshNodeMeshConfigSchema>
export type MeshNodeState = z.infer<typeof meshNodeStateSchema>

const meshNodeStateOps = standard.zod(meshNodeStateSchema, 'meshNodeState')

/** This node's own record, as its agent holds it. Read-only. */
export const meshNodeStateContract = meshNodeStateOps
    .list()
    .path('/state')
    .input(z.object({}))
    .output(meshNodeStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
