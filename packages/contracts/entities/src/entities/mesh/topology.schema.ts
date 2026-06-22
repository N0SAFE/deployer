import z from "zod/v4";

export const meshNodeRoleSchema = z.enum(["edge", "relay", "partition-owner", "observer"]);
export type MeshNodeRole = z.infer<typeof meshNodeRoleSchema>;

export const meshNodeLifecycleStateSchema = z.enum([
    "discovering",
    "connecting",
    "healthy",
    "degraded",
    "suspect",
    "isolated",
    "leaving",
]);
export type MeshNodeLifecycleState = z.infer<typeof meshNodeLifecycleStateSchema>;

export const meshLinkStateSchema = z.enum(["up", "degraded", "down"]);
export type MeshLinkState = z.infer<typeof meshLinkStateSchema>;

export const meshRoutingModeSchema = z.enum(["latency", "balanced", "throughput", "resilience"]);
export type MeshRoutingMode = z.infer<typeof meshRoutingModeSchema>;

export const meshPartitionConsistencyModeSchema = z.enum(["ap", "cp", "hybrid"]);
export type MeshPartitionConsistencyMode = z.infer<typeof meshPartitionConsistencyModeSchema>;

export const meshPeerLinkMetricsSchema = z.object({
    latencyMs: z.number().min(0),
    jitterMs: z.number().min(0),
    packetLossRatio: z.number().min(0).max(1),
    throughputMbps: z.number().min(0),
    reliabilityScore: z.number().min(0).max(1),
    weight: z.number().min(0),
    measuredAt: z.string(),
});
export type MeshPeerLinkMetrics = z.infer<typeof meshPeerLinkMetricsSchema>;

export const systemMetricsSnapshotSchema = z.object({
    capturedAt: z.string(),
    cpu: z.object({
        manufacturer: z.string(),
        brand: z.string(),
        speed: z.number(),
        cores: z.number(),
        physicalCores: z.number(),
        load: z.object({
            currentLoad: z.number(),
            currentLoadUser: z.number(),
            currentLoadSystem: z.number(),
            currentLoadIdle: z.number(),
            cpus: z.array(
                z.object({
                    load: z.number(),
                    loadUser: z.number(),
                    loadSystem: z.number(),
                    loadIdle: z.number(),
                }),
            ),
        }),
    }),
    memory: z.object({
        total: z.number(),
        free: z.number(),
        used: z.number(),
        active: z.number(),
        available: z.number(),
        buffcache: z.number(),
        swaptotal: z.number(),
        swapused: z.number(),
        swapfree: z.number(),
    }),
    disk: z.object({
        totals: z.object({
            size: z.number(),
            used: z.number(),
            available: z.number(),
            use: z.number(),
        }),
        filesystems: z.array(
            z.object({
                fs: z.string(),
                type: z.string(),
                size: z.number(),
                used: z.number(),
                available: z.number(),
                use: z.number(),
                mount: z.string(),
                rw: z.boolean().nullable(),
            }),
        ),
    }),
    network: z.object({
        totals: z.object({
            rxBytes: z.number(),
            txBytes: z.number(),
            rxDropped: z.number(),
            txDropped: z.number(),
            rxErrors: z.number(),
            txErrors: z.number(),
        }),
        interfaces: z.array(
            z.object({
                iface: z.string(),
                operstate: z.string(),
                rxBytes: z.number(),
                txBytes: z.number(),
                rxDropped: z.number(),
                txDropped: z.number(),
                rxErrors: z.number(),
                txErrors: z.number(),
                rxSec: z.number(),
                txSec: z.number(),
            }),
        ),
    }),
    process: z
        .object({
            pid: z.number(),
            name: z.string(),
            cpu: z.number().nullable(),
            mem: z.number().nullable(),
            command: z.string().nullable(),
            started: z.string().nullable(),
        })
        .nullable(),
    gpu: z.object({
        controllers: z.array(
            z.object({
                vendor: z.string(),
                model: z.string(),
                bus: z.string(),
                vram: z.number().nullable(),
                vramDynamic: z.boolean(),
                fanSpeed: z.number().optional(),
                memoryTotal: z.number().optional(),
                memoryUsed: z.number().optional(),
                memoryFree: z.number().optional(),
                utilizationGpu: z.number().optional(),
                utilizationMemory: z.number().optional(),
                temperatureGpu: z.number().optional(),
                temperatureMemory: z.number().optional(),
                powerDraw: z.number().optional(),
                powerLimit: z.number().optional(),
                clockCore: z.number().optional(),
                clockMemory: z.number().optional(),
            }),
        ),
    }),
});
export type SystemMetricsSnapshot = z.infer<typeof systemMetricsSnapshotSchema>;

export const meshNodeStateSchema = z.object({
    nodeId: z.uuid(),
    region: z.string().min(1),
    zone: z.string().min(1).optional(),
    roles: z.array(meshNodeRoleSchema).min(1),
    lifecycleState: meshNodeLifecycleStateSchema,
    routingMode: meshRoutingModeSchema,
    consistencyMode: meshPartitionConsistencyModeSchema,
    version: z.string().min(1),
    startedAt: z.string(),
    lastSeenAt: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshNodeState = z.infer<typeof meshNodeStateSchema>;

/**
 * Public, unauthenticated ping response.
 *
 * Exposed at `GET /mesh/ping` so that other nodes can:
 *   - Verify a peer is reachable before the local node is enrolled in the
 *     mesh and has any credentials (setup wizard reachability probe,
 *     bootstrap pre-flight).
 *   - Read the peer's advertised public URL to dial it back during
 *     enrollment.
 *
 * The route is INTENTIONALLY MINIMAL:
 *   - `ok`           → liveness marker (always `true` when the API is up)
 *   - `version`      → API/mesh version string (already public via other
 *                      diagnostics, useful for compatibility checks)
 *   - `advertisedHost` → The URL this node tells peers to dial. Derived
 *                      from public config (no secrets, no internal IP).
 *
 * It does NOT expose: nodeId, region, zone, roles, lifecycle state,
 * routing mode, consistency mode, startedAt, lastSeenAt, metadata, or
 * any operational topology info. Those live behind the authenticated
 * `GET /mesh/node/local` route.
 */
export const meshPingResultSchema = z.object({
    ok: z.literal(true),
    version: z.string().min(1),
    advertisedHost: z.string().min(1).nullable(),
});
export type MeshPingResult = z.infer<typeof meshPingResultSchema>;

export const meshPeerConnectionSchema = z.object({
    connectionId: z.uuid(),
    sourceNodeId: z.uuid(),
    targetNodeId: z.uuid(),
    state: meshLinkStateSchema,
    metrics: meshPeerLinkMetricsSchema,
    activePathRank: z.number().int().min(1),
    lastHeartbeatAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshPeerConnection = z.infer<typeof meshPeerConnectionSchema>;

export const meshPeersListResultSchema = z.object({
    items: z.array(meshPeerConnectionSchema),
});
export type MeshPeersListResult = z.infer<typeof meshPeersListResultSchema>;

export const meshPeerSessionStateSchema = z.enum(["connected", "reconnecting", "closed"]);
export type MeshPeerSessionState = z.infer<typeof meshPeerSessionStateSchema>;

export const meshPeerSessionSchema = z.object({
    sessionId: z.uuid(),
    peerNodeId: z.uuid().nullable(),
    endpointUrl: z.string().url(),
    state: meshPeerSessionStateSchema,
    reconnectAttempt: z.number().int().min(0),
    nextReconnectAt: z.string().nullable(),
    resumeToken: z.string().min(1),
    duplicateSuppressed: z.boolean().default(false),
    duplicateOfSessionId: z.uuid().nullable(),
    connectedAt: z.string().nullable(),
    disconnectedAt: z.string().nullable(),
    lastHeartbeatAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshPeerSession = z.infer<typeof meshPeerSessionSchema>;

export const meshPeerSessionsListResultSchema = z.object({
    items: z.array(meshPeerSessionSchema),
});
export type MeshPeerSessionsListResult = z.infer<typeof meshPeerSessionsListResultSchema>;

export const meshRemoteAuthSessionSchema = z.object({
    serverUrl: z.string().url(),
    sessionId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    userEmail: z.string().email().optional(),
    expiresAt: z.string().optional(),
    retrievedAt: z.string(),
    raw: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type MeshRemoteAuthSession = z.infer<typeof meshRemoteAuthSessionSchema>;

export const meshPeerConnectInputSchema = z.object({
    serverUrl: z.string().url().optional(),
    endpointUrl: z.string().url(),
    resumeToken: z.string().min(1).optional(),
    remoteAuthSession: meshRemoteAuthSessionSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MeshPeerConnectInput = z.infer<typeof meshPeerConnectInputSchema>;

export const meshPeerConnectResultSchema = z.object({
    connected: z.boolean(),
    deduplicated: z.boolean(),
    resumed: z.boolean(),
    session: meshPeerSessionSchema,
});
export type MeshPeerConnectResult = z.infer<typeof meshPeerConnectResultSchema>;

export const meshPeerDisconnectInputSchema = z.object({
    reason: z.string().min(1).optional(),
    allowReconnect: z.boolean().default(true),
});
export type MeshPeerDisconnectInput = z.infer<typeof meshPeerDisconnectInputSchema>;

export const meshPeerDisconnectResultSchema = z.object({
    disconnected: z.boolean(),
    session: meshPeerSessionSchema,
});
export type MeshPeerDisconnectResult = z.infer<typeof meshPeerDisconnectResultSchema>;

export const meshPeerHeartbeatInputSchema = z.object({
    peerNodeId: z.uuid().optional(),
    latencyMs: z.number().min(0),
    jitterMs: z.number().min(0),
    packetLossRatio: z.number().min(0).max(1),
    throughputMbps: z.number().min(0),
    reliabilityScore: z.number().min(0).max(1),
});
export type MeshPeerHeartbeatInput = z.infer<typeof meshPeerHeartbeatInputSchema>;

export const meshPeerHeartbeatResultSchema = z.object({
    acknowledged: z.boolean(),
    session: meshPeerSessionSchema,
    connection: meshPeerConnectionSchema,
});
export type MeshPeerHeartbeatResult = z.infer<typeof meshPeerHeartbeatResultSchema>;

export const meshMembershipSnapshotSchema = z.object({
    version: z.number().int().min(0),
    generatedAt: z.string(),
    localNode: meshNodeStateSchema,
    nodes: z.array(meshNodeStateSchema),
    connections: z.array(meshPeerConnectionSchema),
    sessions: z.array(meshPeerSessionSchema),
});
export type MeshMembershipSnapshot = z.infer<typeof meshMembershipSnapshotSchema>;

export const meshTopologyEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("node_upserted"),
        node: meshNodeStateSchema,
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("node_removed"),
        nodeId: z.uuid(),
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("edge_upserted"),
        edge: meshPeerConnectionSchema,
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("edge_removed"),
        connectionId: z.uuid(),
        sourceNodeId: z.uuid(),
        targetNodeId: z.uuid(),
        timestamp: z.string(),
    }),
]);
export type MeshTopologyEvent = z.infer<typeof meshTopologyEventSchema>;

export const meshRuntimeEventReasonSchema = z.enum([
    "bootstrap",
    "session_connected",
    "session_disconnected",
    "session_heartbeat",
    "membership_reconciled",
    "topology_event",
    "control_envelope",
]);
export type MeshRuntimeEventReason = z.infer<typeof meshRuntimeEventReasonSchema>;

export const meshRuntimeEventSchema = z.object({
    type: z.literal("mesh_state"),
    reason: meshRuntimeEventReasonSchema,
    localNode: meshNodeStateSchema,
    peers: z.array(meshPeerConnectionSchema),
    sessions: z.array(meshPeerSessionSchema),
    snapshot: meshMembershipSnapshotSchema,
    topologyEvent: meshTopologyEventSchema.nullable(),
    emittedAt: z.string(),
    revision: z.number().int().min(0),
});
export type MeshRuntimeEvent = z.infer<typeof meshRuntimeEventSchema>;
