import { oc } from "@orpc/contract";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    clusterMasterSchema,
    clusterNodeSchema,
    clusterSnapshotSchema,
} from "@repo/contracts-entities";

// ─── Cluster contract module (SW-003) ───────────────────────────────────────
// Admin/ops surface for the Swarm cluster: local snapshot, fleet inventory,
// master state/history, and node role/ingress label management.
// Reuses the canonical `entities/swarm` schemas — no re-declaration (SSOT).

// ─── Outputs (reuse canonical schemas where they fit) ───────────────────────

export const clusterSnapshotContractOutput = clusterSnapshotSchema;

export const clusterMasterViewSchema = clusterMasterSchema.extend({
    state: z.enum(["healthy", "suspect", "unreachable"]),
}).nullable();
export type ClusterMasterView = z.infer<typeof clusterMasterViewSchema>;

export const clusterNodeInventoryRowSchema = clusterNodeSchema.extend({
    hostname: z.string().default(""),
    isLeader: z.boolean().default(false),
    state: z.enum(["active", "down"]).default("active"),
    lastSeenAt: z.string().nullable().default(null),
});
export type ClusterNodeInventoryRow = z.infer<typeof clusterNodeInventoryRowSchema>;

export const clusterNodeLabelUpdateInputSchema = z.object({
    nodeId: z.string().min(1),
    platformRole: z.enum(["both", "control", "worker"]).optional(),
    ingress: z.boolean().optional(),
});
export type ClusterNodeLabelUpdateInput = z.infer<typeof clusterNodeLabelUpdateInputSchema>;

// ─── Builders ───────────────────────────────────────────────────────────────

const snapshotOps = standard.zod(clusterSnapshotContractOutput, "clusterSnapshot");
const inventoryOps = standard.zod(z.array(clusterNodeInventoryRowSchema), "clusterNodeInventory");
const masterOps = standard.zod(clusterMasterViewSchema, "clusterMasterView");
const nodeLabelOps = standard.zod(clusterNodeSchema, "clusterNodeLabelUpdate");

// ─── Contracts ──────────────────────────────────────────────────────────────

export const clusterGetSnapshotContract = snapshotOps
    .list()
    .path("/snapshot")
    .input(z.object({}))
    .output(clusterSnapshotContractOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const clusterListNodesContract = inventoryOps
    .list()
    .path("/nodes")
    .input(z.object({ includeDown: z.boolean().optional().default(false) }))
    .output(z.array(clusterNodeInventoryRowSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const clusterGetMasterContract = masterOps
    .list()
    .path("/master")
    .input(z.object({}))
    .output(clusterMasterViewSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const clusterUpdateNodeContract = nodeLabelOps
    .update({ idFieldName: "nodeId", idSchema: z.string().min(1) })
    .input((b) =>
        b
            .params((p) => p`/nodes/${p("nodeId", z.string().min(1))}/labels`)
            .body(
                z.object({
                    platformRole: clusterNodeLabelUpdateInputSchema.shape.platformRole,
                    ingress: clusterNodeLabelUpdateInputSchema.shape.ingress,
                }),
            ),
    )
    .output(clusterNodeSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const clusterContract = oc.tag("Cluster").prefix("/cluster").router({
    getSnapshot: clusterGetSnapshotContract,
    listNodes: clusterListNodesContract,
    getMaster: clusterGetMasterContract,
    updateNode: clusterUpdateNodeContract,
});

export type ClusterContract = typeof clusterContract;