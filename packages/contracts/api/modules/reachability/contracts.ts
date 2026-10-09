import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    edgeOptionsSchema,
    edgeProviderDescriptorSchema,
    edgeProviderIdSchema,
    edgeStatusSchema,
    ingressLanesSchema,
    joinEntryPointSummarySchema,
    routeVisibilitySchema,
} from "@repo/contracts-entities/entities/ingress/index";
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

// ─── Ingress lanes (local · private · public) and the mesh under them ──────

/**
 * The public edge: every edge provider this API can run the public lane on (the
 * catalog the UI renders its picker and forms from), and the active one's status.
 */
export const publicEdgeViewSchema = z.object({
    providers: z.array(edgeProviderDescriptorSchema),
    /** Null when there is no public lane. */
    active: z
        .object({
            /** The provider the lane names — reported even when it is not registered here. */
            providerId: z.string(),
            provider: edgeProviderDescriptorSchema.nullable(),
            status: edgeStatusSchema,
        })
        .nullable(),
});

/** One mesh member as the Network pages show it. */
export const meshMemberViewSchema = z.object({
    memberId: z.string(),
    name: z.string(),
    kind: z.enum(["node", "operator"]),
    address: z.string(),
    state: z.enum(["active", "left"]),
    /** True for the member answering this request (the node the API runs on). */
    self: z.boolean(),
    /** Facts the member published about itself (swarm node id, platform node id…). */
    labels: z.record(z.string(), z.string()),
    /** Addresses peers may try to reach it on (LAN, declared, STUN-reflexive). */
    endpoints: z.array(z.object({ kind: z.string(), address: z.string() })),
    /** `self` for the node answering; `direct` when a WireGuard handshake is fresh. */
    link: z.object({
        path: z.enum(["self", "direct", "trying", "relay", "passive"]),
        endpoint: z.string().nullable(),
        latestHandshakeAt: z.string().nullable(),
    }),
});

/** One node door (loopback, LAN or mesh-address listener in front of Traefik). */
export const meshDoorViewSchema = z.object({
    lane: z.enum(["local", "private", "lan"]),
    container: z.string(),
    bindAddress: z.string(),
    port: z.number().int(),
    state: z.enum(["running", "absent", "failed"]),
    detail: z.string().nullable(),
});

export const ingressStateSchema = z.object({
    lanes: ingressLanesSchema,
    /** Plain answers derived server-side from the lanes. */
    exposure: z.object({
        reachableOffMachine: z.boolean(),
        reachableFromInternet: z.boolean(),
        opensInboundPorts: z.boolean(),
        usesProviderAccount: z.boolean(),
        reachableOnLan: z.boolean(),
    }),
    /** The wildcard base of each lane: apps answer on `<label>.<domain>` (null when the lane is off). */
    domains: z.object({
        local: z.string(),
        private: z.string().nullable(),
        public: z.string().nullable(),
    }),
    /** Where the console answers on each lane (null when the lane is off or the console is not on it). */
    consoleUrls: z.object({
        local: z.string(),
        private: z.string().nullable(),
        public: z.string().nullable(),
    }),
    edge: publicEdgeViewSchema,
    /** DNS records the lanes need, as last converged (`manual` = no provider owns the zone). */
    dns: z.array(
        z.object({
            lane: z.enum(["public", "private"]),
            name: z.string(),
            type: z.enum(["A", "CNAME"]),
            contents: z.array(z.string()),
            status: z.enum(["synced", "manual", "error"]),
            detail: z.string().nullable(),
        }),
    ),
    /** The mesh as seen by the agent on the node serving this request. */
    mesh: z.object({
        available: z.boolean(),
        clusterId: z.string().nullable(),
        cidr: z.string().nullable(),
        address: z.string().nullable(),
        listenPort: z.number().int().nullable(),
        interfaceUp: z.boolean(),
        members: z.array(meshMemberViewSchema),
        doors: z.array(meshDoorViewSchema),
        lastGossipAt: z.string().nullable(),
        lastError: z.string().nullable(),
    }),
    /**
     * How a node that is NOT a member yet reaches one. Separate from `exposure`:
     * exposure describes who can reach the RUNNING stack, this describes the
     * routes that exist to JOIN it at all.
     */
    entryPoints: joinEntryPointSummarySchema,
});

export type IngressState = z.output<typeof ingressStateSchema>;

/** One member as the Network pages show it. */
export type MeshMemberView = z.output<typeof meshMemberViewSchema>;

/** One node door as the Network pages show it. */
export type MeshDoorView = z.output<typeof meshDoorViewSchema>;

export type PublicEdgeView = z.output<typeof publicEdgeViewSchema>;

export const updateIngressInputSchema = z.object({
    entryPort: z.number().int().min(1).max(65_535).optional(),
    private: z
        .object({
            enabled: z.boolean(),
            domain: z.string().min(3).max(253).optional(),
            /** Also bind the private lane on the node's LAN address (same-network joins). */
            exposeOnLan: z.boolean().optional(),
        })
        .optional(),
    /**
     * Null turns the public lane off (and tears the previous edge down). Otherwise
     * `provider` names a registered edge provider and `options` are its options, as
     * its descriptor lists them. A provider that opens inbound ports requires
     * `acknowledgedInboundPorts: true`.
     */
    public: z
        .object({
            provider: edgeProviderIdSchema,
            domain: z.string().min(3).max(253),
            acknowledgedInboundPorts: z.boolean().optional(),
            options: edgeOptionsSchema.optional(),
        })
        .nullable()
        .optional(),
    consoleVisibility: routeVisibilitySchema.optional(),
});

export type UpdateIngressInput = z.output<typeof updateIngressInputSchema>;

const revokeMeshMemberInputSchema = z.object({
    memberId: z.string().min(1),
    /** Why — recorded in the signed revocation every member keeps. */
    reason: z.string().min(1).max(512),
});

// ─── Contract Builders ────────────────────────────────────────────────────

const checkOps = standard.zod(reachabilityCheckResultSchema, "reachabilityCheck");
const configOps = standard.zod(reachabilityConfigSchema, "reachabilityConfig");
const domainCheckOps = standard.zod(domainReachabilityResultSchema, "domainReachability");
const publicIpOps = standard.zod(publicIpOutputSchema, "publicIp");
const nodeNetworkOps = standard.zod(nodeNetworkConfigSchema, "nodeNetwork");
const nodeGateOps = standard.zod(nodeNetworkGateSchema, "nodeNetworkGate");
const ingressOps = standard.zod(ingressStateSchema, "ingress");

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

// ─── Ingress lane contracts ───────────────────────────────────────────────

/** Read the stack's lanes, exposure, console URLs, tunnel and mesh status. */
export const getIngressContract = ingressOps
    .read()
    .path("/reachability/ingress")
    .input(z.object({}))
    .output(ingressStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/**
 * Change the lanes.
 *
 * POST, not PUT: the lanes are a SINGLETON (one per stack), and the standard
 * `update()` builder generates an `:id` path param that does not exist here.
 * Only the fields sent change; the rest keep their current value.
 */
export const updateIngressContract = ingressOps
    .create()
    .path("/reachability/ingress")
    .input((b) => b.body(updateIngressInputSchema))
    .output(ingressStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/**
 * Tear the public edge down: delete what its provider created (a tunnel, its
 * routing), remove its DNS records, and turn the public lane off.
 *
 * Destructive on the provider side, which is why switching providers through
 * `updateIngress` is the everyday path and this is the explicit "remove it all".
 */
export const teardownPublicEdgeContract = ingressOps
    .delete()
    .path("/reachability/ingress/public-edge")
    .input(z.object({}))
    .output(ingressStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/**
 * Revoke a mesh member (a dead or retired node, a lost operator laptop).
 *
 * Every member drops it on the next gossip round; its WireGuard key stops being
 * accepted anywhere. It cannot re-join without a new admission.
 */
export const revokeMeshMemberContract = ingressOps
    .create()
    .path("/reachability/mesh/revocations")
    .input((b) => b.body(revokeMeshMemberInputSchema))
    .output(ingressStateSchema)
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
    checkDomainGate: checkDomainGateContract,
    getPublicAccessPoint: getPublicAccessPointContract,
    watchPublicAccessPoint: watchPublicAccessPointContract,
    getIngress: getIngressContract,
    updateIngress: updateIngressContract,
    teardownPublicEdge: teardownPublicEdgeContract,
    revokeMeshMember: revokeMeshMemberContract,
};

export type ReachabilityContract = typeof reachabilityContract;
