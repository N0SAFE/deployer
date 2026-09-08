import { oc } from "@orpc/contract";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    clusterMasterSchema,
    clusterNodeSchema,
    clusterSnapshotSchema,
    swarmNodeResourcesSchema,
    swarmServiceRuntimeSchema,
    swarmTaskRuntimeSchema,
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

// ─── Fleet runtime views (services / tasks / node resources) ────────────────
// The live swarm workload surface: services are mesh-wide, tasks carry a
// scheduling slot and node, node resources aggregate both + local engine
// artifacts. All shapes are canonical `entities/swarm` runtime schemas.

export const clusterListTasksQuerySchema = z.object({
    serviceId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
});
export type ClusterListTasksQuery = z.infer<typeof clusterListTasksQuerySchema>;

export const clusterGetNodeResourcesQuerySchema = z.object({
    nodeId: z.string().min(1),
});
export type ClusterGetNodeResourcesQuery = z.infer<typeof clusterGetNodeResourcesQuerySchema>;

// ─── Builders ───────────────────────────────────────────────────────────────

const snapshotOps = standard.zod(clusterSnapshotContractOutput, "clusterSnapshot");
const inventoryOps = standard.zod(z.array(clusterNodeInventoryRowSchema), "clusterNodeInventory");
const masterOps = standard.zod(clusterMasterViewSchema, "clusterMasterView");
const nodeLabelOps = standard.zod(clusterNodeSchema, "clusterNodeLabelUpdate");
const servicesOps = standard.zod(swarmServiceRuntimeSchema, "swarmServiceRuntime");
const tasksOps = standard.zod(swarmTaskRuntimeSchema, "swarmTaskRuntime");
const nodeResourcesOps = standard.zod(swarmNodeResourcesSchema, "swarmNodeResources");

// ─── Contracts ──────────────────────────────────────────────────────────────

export const clusterGetSnapshotContract = snapshotOps
    .list()
    .path("/snapshot")
    .input(z.object({}))
    .output(clusterSnapshotContractOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// NOTE: `includeDown` stays a plain `z.boolean()`. The API wires the ORPC
// Smart Coercion plugin with the zod/v4 JSON-schema converter, so REST query
// strings (`?includeDown=true|false`) are coerced to real booleans before
// validation. Do NOT re-wrap in a string union — that defeats coercion.
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

/** Mesh-wide swarm services (global vs replicated + desired/running). */
export const clusterListServicesContract = servicesOps
    .list()
    .path("/services")
    .input(z.object({}))
    .output(z.array(swarmServiceRuntimeSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Swarm tasks, optionally filtered by service or node. */
export const clusterListTasksContract = tasksOps
    .list()
    .path("/tasks")
    .input((b) => b.query(clusterListTasksQuerySchema))
    .output(z.array(swarmTaskRuntimeSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Per-node aggregation: swarm services/tasks + local engine artifacts. */
export const clusterGetNodeResourcesContract = nodeResourcesOps
    .list()
    .path("/node-resources")
    .input((b) => b.query(clusterGetNodeResourcesQuerySchema))
    .output((b) => b.body(swarmNodeResourcesSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const clusterStreamSnapshotContract = snapshotOps
    .list()
    .path("/snapshot/stream")
    .input(z.object({}))
    .output((b) => b.observable(clusterSnapshotContractOutput))
    .build();

export const clusterStreamNodeResourcesContract = nodeResourcesOps
    .list()
    .path("/node-resources/stream")
    .input((b) => b.query(clusterGetNodeResourcesQuerySchema))
    .output((b) => b.observable(swarmNodeResourcesSchema))
    .build();

export const clusterContract = oc.tag("Cluster").prefix("/cluster").router({
    getSnapshot: clusterGetSnapshotContract,
    streamSnapshot: clusterStreamSnapshotContract,
    listNodes: clusterListNodesContract,
    getMaster: clusterGetMasterContract,
    updateNode: clusterUpdateNodeContract,
    listServices: clusterListServicesContract,
    listTasks: clusterListTasksContract,
    getNodeResources: clusterGetNodeResourcesContract,
    streamNodeResources: clusterStreamNodeResourcesContract,
});

export type ClusterContract = typeof clusterContract;