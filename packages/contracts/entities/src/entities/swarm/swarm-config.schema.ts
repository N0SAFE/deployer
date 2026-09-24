import z from "zod/v4";

/**
 * Swarm participation — how THIS node takes part in the Docker Swarm cluster
 * and the role policy it enforces on itself.
 *
 * Decided at setup time (the wizard surfaces it) and persisted on the local
 * `node_config` row (JSON) so it survives restarts without env injection.
 *
 * Mode (HOW this node participates):
 *   "create" — this node initializes a NEW cluster ("founding node").
 *   "join"   — this node joins an EXISTING cluster (token + control-plane addrs).
 *
 * There is deliberately NO "off": the deployer ALWAYS runs its supervised
 * workloads on Swarm, so participation is not an optional feature — only the
 * way this node enters the cluster is.
 *
 * Policy (WHAT role this node holds — the fleet topology the UI explains):
 *   "auto"     — MIXED manager + worker. The node holds control-plane duties
 *                AND keeps scheduling workloads. Best for small clusters
 *                (2-3 nodes) where no server can be dedicated to control-plane.
 *   "manager"  — DEDICATED MASTER. A manager that does NOT run workload tasks
 *                (drained) — reserved for larger fleets with a dedicated node.
 *   "worker"   — PURE WORKER. Runs workloads only; control-plane lives
 *                elsewhere. Only meaningful with mode="join".
 */

export const swarmNodePolicySchema = z.enum(["auto", "manager", "worker"]);
export type SwarmNodePolicy = z.infer<typeof swarmNodePolicySchema>;

export const swarmParticipationModeSchema = z.enum(["create", "join"]);
export type SwarmParticipationMode = z.infer<typeof swarmParticipationModeSchema>;

/**
 * Coherence invariants of a participation config — the SINGLE definition,
 * reused by the input schemas (early 400), the service (defensive clamp of
 * legacy/env values) and the UI (disable impossible choices).
 *
 *  - `create` + `worker` is IMPOSSIBLE. The founding node is the one that
 *    runs `swarm init`, so it IS the initial manager; demoting it to worker
 *    would leave the brand-new cluster with no manager at all (no quorum, no
 *    service scheduling authority).
 *  - `join` requires the cluster's control-plane address(es): without them
 *    the node cannot reach the cluster to join it.
 */
export function swarmParticipationIssues(input: {
    mode: SwarmParticipationMode;
    policy: SwarmNodePolicy;
    joinAddrs?: readonly string[] | undefined;
}): Array<{ path: string; message: string }> {
    const issues: Array<{ path: string; message: string }> = [];
    if (input.mode === "create" && input.policy === "worker") {
        issues.push({
            path: "policy",
            message:
                "A founding node must be a manager (auto or manager) — it creates the cluster, so it cannot be worker-only.",
        });
    }
    if (input.mode === "join" && (input.joinAddrs ?? []).length === 0) {
        issues.push({
            path: "joinAddrs",
            message: "Joining a cluster requires at least one control-plane address (host:port).",
        });
    }
    return issues;
}

/** Shared shape of all participation fields (mode/policy/addresses/token). */
const swarmParticipationFields = {
    advertiseAddr: z.string().trim().optional().nullable(),
    /** Join token (mode="join"). Never echoed back in views. */
    joinToken: z.string().trim().optional().nullable(),
    /** Control-plane reachable addresses, "host:port" each (mode="join"). */
    joinAddrs: z.array(z.string().min(1)).optional().default([]),
} as const;

/**
 * Selection for a node that FOUNDS a cluster. The mode is implied (this node
 * creates the swarm and therefore becomes its first manager), so only the role
 * policy is asked — see `swarmParticipationIssues` for why `worker` is
 * impossible here.
 */
export const swarmFoundingSelectionSchema = z
    .object({
        mode: z.literal("create").default("create"),
        policy: swarmNodePolicySchema,
        ...swarmParticipationFields,
    })
    .superRefine((data, ctx) => {
        for (const issue of swarmParticipationIssues(data)) {
            ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
        }
    });
export type SwarmFoundingSelection = z.infer<typeof swarmFoundingSelectionSchema>;

/**
 * Selection for a node that JOINS an existing cluster. The mode is implied by
 * the join itself (a joining node never founds its own swarm), so only the
 * cluster ROLE is chosen: worker (pure capacity), auto (mixed manager) or
 * manager (dedicated control plane).
 */
export const swarmJoinSelectionSchema = z.object({
    policy: swarmNodePolicySchema.default("worker"),
    joinToken: z.string().trim().optional().nullable(),
});
export type SwarmJoinSelection = z.infer<typeof swarmJoinSelectionSchema>;

/** Operator-facing PARTIAL input (cluster config UI updates). */
export const swarmParticipationInputSchema = z.object({
    mode: swarmParticipationModeSchema.optional(),
    policy: swarmNodePolicySchema.optional(),
    ...swarmParticipationFields,
});
export type SwarmParticipationInput = z.infer<typeof swarmParticipationInputSchema>;

/** Persisted shape (node_config.swarmConfig). */
export const swarmParticipationSchema = z.object({
    mode: swarmParticipationModeSchema.default("create"),
    policy: swarmNodePolicySchema.default("auto"),
    advertiseAddr: z.string().nullable().default(null),
    joinToken: z.string().nullable().default(null),
    joinAddrs: z.array(z.string().min(1)).default([]),
});
export type SwarmParticipationConfig = z.infer<typeof swarmParticipationSchema>;

/** Describe one policy for the UI (why/when to pick it). */
export const swarmPolicyDocumentSchema = z.object({
    policy: swarmNodePolicySchema,
    name: z.string().min(1),
    description: z.string().min(1),
    bestFor: z.string().min(1),
    role: z.enum(["manager", "worker"]),
    schedulesWorkloads: z.boolean(),
    recommended: z.boolean().default(false),
});
export type SwarmPolicyDocument = z.infer<typeof swarmPolicyDocumentSchema>;

/** Live engine state + effective participation — what the UI shows. */
export const swarmConfigViewSchema = z.object({
    /** Persisted + env-merged participation resolve. */
    participation: swarmParticipationSchema,
    /** True when node_config says setup completed. */
    setupDone: z.boolean(),
    /** Local engine swarm state ("active" | "inactive" | "pending" | "locked"). */
    engineState: z.string(),
    /** Local node swarm role (manager | worker | none). */
    role: z.string(),
    /** Local node availability (active | pause | drain). */
    availability: z.string(),
    /** Cluster size when active, else 0. */
    nodeCount: z.number().int().min(0),
    managerCount: z.number().int().min(0),
    /** Present only when engine is an active manager: share to onboard peers. */
    joinTokens: z
        .object({ worker: z.string(), manager: z.string() })
        .nullable()
        .default(null),
    /** Human-readable explanation of the current resolve (drives UX). */
    resolveNote: z.string(),
    /** Policy documents for the configuration UI. */
    policies: z.array(swarmPolicyDocumentSchema).default([]),
});
export type SwarmConfigView = z.infer<typeof swarmConfigViewSchema>;