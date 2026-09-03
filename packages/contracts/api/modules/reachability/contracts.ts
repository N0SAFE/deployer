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
    publicUrl: z.string().url("Must be a valid URL"),
});

const reachabilityCheckInputSchema = z.object({
    url: z.string().url("Must be a valid URL"),
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
 * Tunnel reachability config. The tunnel is only authoritative when enabled AND
 * bound to a provider app (`providerId`) whose credentials are active —
 * the flag alone no longer grants domain creation.
 */
export const nodeTunnelHealthSchema = z.object({
    status: z.enum(["healthy", "degraded", "down", "inactive", "unknown"]).nullable(),
    checkedAt: z.string().nullable(),
    connections: z.number().int().min(0),
    tunnelId: z.string().nullable(),
    error: z.string().nullable(),
});

export const nodeTunnelConfigSchema = z.object({
    enabled: z.boolean().default(false),
    /** DNS provider app that owns the tunnel (dns_providers.id). */
    providerId: z.string().nullable().default(null),
    /** Cloudflare tunnel id — created automatically when enabled. */
    tunnelId: z.string().nullable().default(null),
    /** Public hostname the tunnel exposes. */
    hostname: z.string().nullable().default(null),
    /** Live tunnel health — re-checked at runtime, never from the DB alone. */
    health: nodeTunnelHealthSchema.nullable().default(null),
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
    tunnel: nodeTunnelConfigSchema,
    updatedAt: z.string(),
});

const nodeNetworkConfigUpdateSchema = z.object({
    /** Target node — defaults to the current node when omitted. */
    nodeId: z.string().optional(),
    /** Set/clear the manual address. Passing null clears it. */
    publicAddress: z.string().nullable().optional(),
    /** Enable/disable tunnel mode. Enabling auto-creates the tunnel. */
    tunnel: z.object({
        enabled: z.boolean(),
        /** Required when enabling without an existing tunnel yet. */
        providerId: z.string().min(1).optional(),
        /** Optional public hostname — auto-suggested from the provider's zone when omitted. */
        hostname: z.string().min(1).optional(),
    }).optional(),
});

const nodeNetworkConfigListOutputSchema = z.object({
    configs: z.array(nodeNetworkConfigSchema),
});

const nodeNetworkGateSchema = z.object({
    allowed: z.boolean(),
    reason: z.string().nullable(),
    publicAddress: z.string().nullable(),
    addressKind: z.enum(["ip", "hostname"]).nullable(),
    tunnel: nodeTunnelConfigSchema,
});

// ─── Contract Builders ────────────────────────────────────────────────────

const checkOps = standard.zod(reachabilityCheckResultSchema, "reachabilityCheck");
const configOps = standard.zod(reachabilityConfigSchema, "reachabilityConfig");
const domainCheckOps = standard.zod(domainReachabilityResultSchema, "domainReachability");
const publicIpOps = standard.zod(publicIpOutputSchema, "publicIp");
const nodeNetworkOps = standard.zod(nodeNetworkConfigSchema, "nodeNetwork");
const nodeGateOps = standard.zod(nodeNetworkGateSchema, "nodeNetworkGate");

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
    .input(z.object({ nodeId: z.string().optional() }))
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
};

export type ReachabilityContract = typeof reachabilityContract;
