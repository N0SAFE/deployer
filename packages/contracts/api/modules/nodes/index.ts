import { oc } from "@orpc/contract";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

/**
 * Nodes contract — the fleet view of the mesh. Every operation is
 * node-scoped: servers = cluster nodes, allocations = per-node resource
 * budgets, admission requests = per-node capacity asks.
 *
 * Conceptually this is the "Nodes" section of the platform: projects and
 * services are mesh-wide, but server capacity, allocations and admission
 * are per node.
 */

export const fleetAllocationModeSchema = z.enum(["dedicated_full", "dedicated_slice", "shared_slice"]);
export const fleetAdmissionRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const fleetNodeMetricSchema = z.object({
    cpuUsage: z.number().min(0).max(1),
    memoryUsage: z.number().min(0).max(1),
    activeStreams: z.number().int().min(0),
    queueDepth: z.number().int().min(0),
    reportedAt: z.string(),
});

export const fleetServerSummarySchema = z.object({
    nodeId: z.uuid(),
    serverUrl: z.string(),
    displayName: z.string().nullable(),
    status: z.enum(["active", "suspect", "draining", "revoked"]),
    healthy: z.boolean(),
    lastSeenAt: z.string().nullable(),
    maxCpuMillicores: z.number().int().min(0).nullable(),
    maxMemoryMb: z.number().int().min(0).nullable(),
    metrics: fleetNodeMetricSchema.nullable(),
    allocationSummary: z.object({
        services: z.number().int().min(0),
        cpuMillicores: z.number().int().min(0),
        memoryMb: z.number().int().min(0),
    }),
});

export const fleetServerAllocationSchema = z.object({
    id: z.uuid(),
    serverNodeId: z.uuid(),
    serverUrl: z.string().nullable(),
    allocationMode: fleetAllocationModeSchema,
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
    maxServices: z.number().int().min(0).nullable(),
    isEnabled: z.boolean(),
    updatedAt: z.string(),
});

const listFleetAllocationsQuerySchema = z.object({
    serverNodeId: z.uuid().optional(),
});

const upsertFleetAllocationInputSchema = z.object({
    serverNodeId: z.uuid(),
    allocationMode: fleetAllocationModeSchema,
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
    maxServices: z.number().int().min(0).nullable().optional(),
    isEnabled: z.boolean().default(true),
});

const deleteFleetAllocationInputSchema = z.object({
    serverNodeId: z.uuid(),
});

const fleetAdmissionCheckInputSchema = z.object({
    requestedCpuMillicores: z.number().int().min(0),
    requestedMemoryMb: z.number().int().min(0),
    requestedServices: z.number().int().min(0).default(1),
    serverNodeId: z.uuid().optional(),
});

const createFleetAdmissionRequestInputSchema = z.object({
    requestedCpuMillicores: z.number().int().min(0),
    requestedMemoryMb: z.number().int().min(0),
    requestedServices: z.number().int().min(0).default(1),
    requestedServerNodeId: z.uuid().optional(),
    requesterNote: z.string().max(1024).nullable().optional(),
});

const listFleetAdmissionRequestsQuerySchema = z.object({
    status: fleetAdmissionRequestStatusSchema.optional(),
});

const resolveFleetAdmissionRequestInputSchema = z.object({
    requestId: z.uuid(),
    decision: z.enum(["approved", "rejected", "cancelled"]),
    reviewerNote: z.string().max(1024).nullable().optional(),
    decisionServerNodeId: z.uuid().nullable().optional(),
});

const fleetAdmissionCandidateSchema = z.object({
    allocationId: z.uuid(),
    serverNodeId: z.uuid(),
    serverUrl: z.string().nullable(),
    allocationMode: fleetAllocationModeSchema,
    availableCpuMillicores: z.number().int().min(0),
    availableMemoryMb: z.number().int().min(0),
    maxServices: z.number().int().min(0).nullable(),
});

const fleetAdmissionCheckResultSchema = z.object({
    allowed: z.boolean(),
    reason: z.string().nullable(),
    evaluatedAt: z.string(),
    candidates: z.array(fleetAdmissionCandidateSchema),
});

const fleetAdmissionRequestSchema = z.object({
    id: z.uuid(),
    status: fleetAdmissionRequestStatusSchema,
    requestedServerNodeId: z.uuid().nullable(),
    decisionServerNodeId: z.uuid().nullable(),
    requestedCpuMillicores: z.number().int().min(0),
    requestedMemoryMb: z.number().int().min(0),
    requestedServices: z.number().int().min(0),
    requesterUserId: z.string().nullable(),
    requesterNote: z.string().nullable(),
    reviewedByUserId: z.string().nullable(),
    reviewerNote: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

const fleetServerSummaryOps = standard.zod(fleetServerSummarySchema, "fleetServerSummary");
const fleetServerAllocationOps = standard.zod(
    fleetServerAllocationSchema,
    "fleetServerAllocation",
);
const fleetAdmissionCheckOps = standard.zod(fleetAdmissionCheckResultSchema, "fleetAdmissionCheck");
const fleetAdmissionRequestOps = standard.zod(fleetAdmissionRequestSchema, "fleetAdmissionRequest");
const fleetAllocationDeleteResultSchema = z.object({ deleted: z.boolean() });
const fleetAllocationDeleteOps = standard.zod(
    fleetAllocationDeleteResultSchema,
    "fleetAllocationDelete",
);

export const fleetListServersContract = fleetServerSummaryOps
    .list()
    .path("/servers")
    .output((b) => b.body(z.object({ items: z.array(fleetServerSummarySchema) })))
    .build();

export const fleetListAllocationsContract = fleetServerAllocationOps
    .list()
    .path("/allocations")
    .input((b) => b.query(listFleetAllocationsQuerySchema))
    .output((b) => b.body(z.object({ items: z.array(fleetServerAllocationSchema) })))
    .build();

export const fleetListMyAllocationsContract = fleetServerAllocationOps
    .list()
    .path("/allocations/me")
    .output((b) => b.body(z.object({ items: z.array(fleetServerAllocationSchema) })))
    .build();

export const fleetUpsertAllocationContract = fleetServerAllocationOps
    .create()
    .path("/allocations/upsert")
    .input((b) => b.body(upsertFleetAllocationInputSchema))
    .output((b) => b.body(fleetServerAllocationSchema))
    .errors((e) => [
        // 404 unknown node/server; 409 allocation conflict.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const fleetDeleteAllocationContract = fleetAllocationDeleteOps
    .create()
    .path("/allocations/delete")
    .input((b) => b.body(deleteFleetAllocationInputSchema))
    .output((b) => b.body(fleetAllocationDeleteResultSchema))
    .errors((e) => [
        // 404 for unknown allocation.
        ...standardDomainErrorContracts(e),
    ])
    .build();

export const fleetCheckMyAdmissionContract = fleetAdmissionCheckOps
    .create()
    .path("/allocations/me/admission-check")
    .input((b) => b.body(fleetAdmissionCheckInputSchema))
    .output((b) => b.body(fleetAdmissionCheckResultSchema))
    .build();

export const fleetCreateMyAdmissionRequestContract = fleetAdmissionRequestOps
    .create()
    .path("/allocations/me/requests")
    .input((b) => b.body(createFleetAdmissionRequestInputSchema))
    .output((b) => b.body(fleetAdmissionRequestSchema))
    .build();

export const fleetListMyAdmissionRequestsContract = fleetAdmissionRequestOps
    .list()
    .path("/allocations/me/requests")
    .input((b) => b.query(z.object({ status: fleetAdmissionRequestStatusSchema.optional() })))
    .output((b) => b.body(z.object({ items: z.array(fleetAdmissionRequestSchema) })))
    .build();

export const fleetListAdmissionRequestsContract = fleetAdmissionRequestOps
    .list()
    .path("/allocations/requests")
    .input((b) => b.query(listFleetAdmissionRequestsQuerySchema))
    .output((b) => b.body(z.object({ items: z.array(fleetAdmissionRequestSchema) })))
    .build();

export const fleetResolveAdmissionRequestContract = fleetAdmissionRequestOps
    .create()
    .path("/allocations/requests/resolve")
    .input((b) => b.body(resolveFleetAdmissionRequestInputSchema))
    .output((b) => b.body(fleetAdmissionRequestSchema))
    .build();

export const fleetSetServerCapacityContract = fleetServerSummaryOps
    .create()
    .path("/servers/capacity")
    .input((b) =>
        b.body(
            z.object({
                serverNodeId: z.uuid(),
                maxCpuMillicores: z.number().int().min(1).nullable(),
                maxMemoryMb: z.number().int().min(1).nullable(),
            }),
        ),
    )
    .output((b) => b.body(fleetServerSummarySchema))
    .build();

export const nodesContract = oc.tag("Nodes").prefix("/nodes").router({
    listServers: fleetListServersContract,
    setServerCapacity: fleetSetServerCapacityContract,
    listAllocations: fleetListAllocationsContract,
    listMyAllocations: fleetListMyAllocationsContract,
    upsertAllocation: fleetUpsertAllocationContract,
    deleteAllocation: fleetDeleteAllocationContract,
    checkMyAdmission: fleetCheckMyAdmissionContract,
    createMyAdmissionRequest: fleetCreateMyAdmissionRequestContract,
    listMyAdmissionRequests: fleetListMyAdmissionRequestsContract,
    listAdmissionRequests: fleetListAdmissionRequestsContract,
    resolveAdmissionRequest: fleetResolveAdmissionRequestContract,
});

export type NodesContract = typeof nodesContract;
