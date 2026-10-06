import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

// ─── Schemas ──────────────────────────────────────────────────────────────

export const reachabilityCheckResultSchema = z.object({
    url: z.string(),
    reachable: z.boolean(),
    latencyMs: z.number(),
    statusCode: z.number().optional(),
    resolvedIp: z.string().optional(),
    error: z.string().optional(),
});

export const reachabilityConfigSchema = z.object({
    publicUrl: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    lastStatus: z.string().nullable(),
    reachable: z.boolean().nullable(),
});

const reachabilityConfigUpdateSchema = z.object({
    publicUrl: z.url("Must be a valid URL"),
});

const reachabilityCheckInputSchema = z.object({
    url: z.url("Must be a valid URL"),
});

// ─── Domain check schemas ─────────────────────────────────────────────────

export const domainReachabilityResultSchema = z.object({
    domain: z.string(),
    expectedIp: z.string().optional(),
    resolvedIps: z.array(z.string()),
    httpReachable: z.boolean(),
    httpStatusCode: z.number().optional(),
    dnsMatch: z.boolean().nullable(),
    error: z.string().optional(),
});

const domainReachabilityInputSchema = z.object({
    domain: z.string().min(1),
    expectedIp: z.string().optional(),
});

const publicIpOutputSchema = z.object({
    ip: z.string().nullable(),
});

// ─── Node Network Config (public IP + tunnel) ──────────────────────────────

/**
 * Live health of the stack's tunnel, as Cloudflare reports it.
 *
 * Health is a property of the STACK tunnel, so this no longer takes a nodeId:
 * every node's connectors share one tunnel, and its connection count is the
 * platform's, not a node's.
 */
export const nodeTunnelHealthSchema = z.object({
    status: z.enum(["healthy", "degraded", "down", "inactive", "unknown"]).nullable(),
    checkedAt: z.string().nullable(),
    connections: z.number().int().min(0),
    tunnelId: z.string().nullable(),
    error: z.string().nullable(),
});

/**
 * Per-node network config. `nodeId` links to the mesh node
 * (cluster_nodes.nodeId / node_config.nodeId). Stored in the global DB.
 */
export const nodeNetworkConfigSchema = z.object({
    nodeId: z.string(),
    /** Manually-configured globally reachable address (IP/hostname/origin). */
    publicAddress: z.string().nullable(),
    addressKind: z.enum(["ip", "hostname"]).nullable(),
    updatedAt: z.string(),
});

const nodeNetworkConfigUpdateSchema = z.object({
    /** Target node — defaults to the current node when omitted. */
    nodeId: z.string().optional(),
    /** Set/clear the manual address. Passing null clears it. */
    publicAddress: z.string().nullable().optional(),
});

const nodeNetworkConfigListOutputSchema = z.object({
    configs: z.array(nodeNetworkConfigSchema),
});

const nodeNetworkGateSchema = z.object({
    allowed: z.boolean(),
    reason: z.string().nullable(),
    publicAddress: z.string().nullable(),
    addressKind: z.enum(["ip", "hostname"]).nullable(),

});

// ─── Stack edge (mode + the ONE tunnel the whole stack shares) ─────────────

/**
 * How the internet reaches the stack's ingress.
 *
 *   `direct` — DNS points at each node; Traefik PUBLISHES :80/:443.
 *   `tunnel` — a supervised connector dials out; Traefik publishes nothing.
 */
export const stackEdgeModeSchema = z.enum(["direct", "tunnel"]);

/**
 * The stack's single tunnel.
 *
 * One per STACK, not one per node: Cloudflare allows up to 25 connectors on a
 * tunnel and balances across them, so HA comes from connector replicas. The
 * token is deliberately absent from this schema — it is a credential and never
 * travels back to a client.
 */
export const stackTunnelSchema = z.object({
    /** Cloudflare tunnel id, so it is reused/deleted rather than duplicated. */
    tunnelId: z.string().nullable(),
    /** DNS provider app owning the tunnel (`dns_providers.id`). */
    providerId: z.string().nullable(),
    /** Wildcard the tunnel routes (e.g. `*.example.com`), when set. */
    wildcard: z.string().nullable(),
    /** True when a run token is stored, i.e. a connector CAN be started. */
    provisioned: z.boolean(),
});

export const stackEdgeSchema = z.object({
    /** Effective mode (persisted operator choice, else the install default). */
    mode: stackEdgeModeSchema,
    /** The stack's tunnel. All-null fields mean none is provisioned yet. */
    tunnel: stackTunnelSchema,
    /**
     * Whether the ingress publishes a host port under the CURRENT mode. Derived
     * from `mode` so a client never has to re-implement the rule.
     */
    publishesEntryPort: z.boolean(),
    /** Cluster-wide public hostname every app shares, when known. */
    publicHostname: z.string().nullable(),
});

const setStackEdgeModeInputSchema = z.object({
    mode: stackEdgeModeSchema,
    /**
     * Required when switching to `tunnel` without a tunnel yet — the provider
     * app the tunnel is created on.
     */
    providerId: z.string().min(1).optional(),
    /** Wildcard to route; defaults to the configured DEPLOYER_TUNNEL_WILDCARD. */
    wildcard: z.string().min(1).optional(),
});

// ─── Contract Builders ────────────────────────────────────────────────────

const checkOps = standard.zod(reachabilityCheckResultSchema, "reachabilityCheck");
const configOps = standard.zod(reachabilityConfigSchema, "reachabilityConfig");
const domainCheckOps = standard.zod(domainReachabilityResultSchema, "domainReachability");
const publicIpOps = standard.zod(publicIpOutputSchema, "publicIp");
const nodeNetworkOps = standard.zod(nodeNetworkConfigSchema, "nodeNetwork");
const nodeGateOps = standard.zod(nodeNetworkGateSchema, "nodeNetworkGate");
const stackEdgeOps = standard.zod(stackEdgeSchema, "stackEdge");

// ─── Contracts ────────────────────────────────────────────────────────────

export const checkReachabilityContract = checkOps
    .list()
    .path("/reachability/check")
    .input(reachabilityCheckInputSchema)
    .output(reachabilityCheckResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const getReachabilityConfigContract = configOps
    .read()
    .path("/reachability/config")
    .input(z.object({}))
    .output(reachabilityConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const updateReachabilityConfigContract = configOps
    .update()
    .path("/reachability/config")
    .input((b) => b.body(reachabilityConfigUpdateSchema))
    .output(reachabilityConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Domain reachability contracts ─────────────────────────────────────

export const checkDomainReachabilityContract = domainCheckOps
    .list()
    .path("/reachability/domain")
    .input(domainReachabilityInputSchema)
    .output(domainReachabilityResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const getPublicIpContract = publicIpOps
    .read()
    .path("/reachability/public-ip")
    .input(z.object({}))
    .output(publicIpOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Node network config contracts ─────────────────────────────────────

export const getNodeNetworkConfigContract = nodeNetworkOps
    .read()
    .path("/reachability/node-network")
    .input(z.object({ nodeId: z.string().optional() }))
    .output(nodeNetworkConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const updateNodeNetworkConfigContract = nodeNetworkOps
    .create()
    .path("/reachability/node-network")
    .input((b) => b.body(nodeNetworkConfigUpdateSchema))
    .output(nodeNetworkConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const listNodeNetworkConfigsContract = nodeNetworkOps
    .list()
    .path("/reachability/node-network/all")
    .input(z.object({}))
    .output(nodeNetworkConfigListOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const getTunnelHealthContract = nodeNetworkOps
    .read()
    .path("/reachability/tunnel-health")
    .input(z.object({}))
    .output(nodeTunnelHealthSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const checkDomainGateContract = nodeGateOps
    .read()
    .path("/reachability/domain-gate")
    .input(z.object({}))
    .output(nodeNetworkGateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Public Access Point (first-class, global relay) ─────────────────────

/**
 * The node's public access point — the single, checked answer to
 * "where is this node reachable, and is it actually up?". Populated by the
 * core PublicAccessPointService (from node-config + a live probe) and pushed
 * through the global relay observable so every feature sees the same state.
 */
export const publicAccessPointStateSchema = z.object({
    configured: z.boolean(),
    kind: z.enum(["ip", "hostname", "tunnel"]).nullable(),
    address: z.string().nullable(),
    publicUrl: z.string().nullable(),
    providerId: z.string().nullable(),
    tunnelEnabled: z.boolean(),
    reachable: z.boolean().nullable(),
    lastCheckedAt: z.string().nullable(),
    latencyMs: z.number().nullable(),
    statusCode: z.number().nullable(),
    error: z.string().nullable(),
});

const accessPointOps = standard.zod(publicAccessPointStateSchema, "publicAccessPoint");

export const getPublicAccessPointContract = accessPointOps
    .read()
    .path("/reachability/public-access-point")
    .input(z.object({}))
    .output(publicAccessPointStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const watchPublicAccessPointContract = accessPointOps
    .list()
    .path("/reachability/public-access-point/watch")
    .input(z.object({}))
    .output((b) => b.observable(publicAccessPointStateSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Stack edge contracts ─────────────────────────────────────────────────

/** Read the stack's edge: mode, tunnel, and whether the entry port is published. */
export const getStackEdgeContract = stackEdgeOps
    .read()
    .path("/reachability/stack-edge")
    .input(z.object({}))
    .output(stackEdgeSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/**
 * Switch the stack's edge mode.
 *
 * POST, not PUT: the edge is a SINGLETON resource (one per stack), and the
 * standard `update()` builder generates a `:id` path param — an id that does
 * not exist here. `create()` addresses the collection instead.
 *
 * Switching TO `tunnel` provisions the stack's tunnel when none exists (creating
 * it on `providerId` and storing its run token), so the connector supervisor has
 * something to start. Switching to `direct` leaves the tunnel in place but stops
 * using it — deleting it is a separate, explicit call so a mode flip is cheap to
 * reverse.
 */
export const setStackEdgeModeContract = stackEdgeOps
    .create()
    .path("/reachability/stack-edge/mode")
    .input((b) => b.body(setStackEdgeModeInputSchema))
    .output(stackEdgeSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/**
 * Delete the stack's tunnel on its provider and forget it locally.
 *
 * Destructive on the Cloudflare side (the tunnel and its routing rules are
 * removed), which is why it is not folded into the mode switch.
 */
export const clearStackEdgeTunnelContract = stackEdgeOps
    .delete()
    .path("/reachability/stack-edge/tunnel")
    .input(z.object({}))
    .output(stackEdgeSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const reachabilityContract = {
    check: checkReachabilityContract,
    getConfig: getReachabilityConfigContract,
    updateConfig: updateReachabilityConfigContract,
    checkDomain: checkDomainReachabilityContract,
    getPublicIp: getPublicIpContract,
    getNodeNetworkConfig: getNodeNetworkConfigContract,
    updateNodeNetworkConfig: updateNodeNetworkConfigContract,
    listNodeNetworkConfigs: listNodeNetworkConfigsContract,
    getTunnelHealth: getTunnelHealthContract,
    checkDomainGate: checkDomainGateContract,
    getPublicAccessPoint: getPublicAccessPointContract,
    watchPublicAccessPoint: watchPublicAccessPointContract,
    getStackEdge: getStackEdgeContract,
    setStackEdgeMode: setStackEdgeModeContract,
    clearStackEdgeTunnel: clearStackEdgeTunnelContract,
};

export type ReachabilityContract = typeof reachabilityContract;
