import { oc } from "@orpc/contract";
import { standard } from "@repo/orpc-utils";
import z from "zod/v4";

export const fleetAllocationModeSchema = z.enum(["dedicated_full", "dedicated_slice", "shared_slice"]);
export const fleetAdmissionRequestStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const fleetNodeMetricSchema = z.object({
    cpuUsage: z.number().min(0).max(1),
    memoryUsage: z.number().min(0).max(1),
    activeStreams: z.number().int().min(0),
    queueDepth: z.number().int().min(0),
    reportedAt: z.date(),
});

export const fleetServerSummarySchema = z.object({
    nodeId: z.uuid(),
    serverUrl: z.string(),
    displayName: z.string().nullable(),
    status: z.enum(["active", "suspect", "draining", "revoked"]),
    healthy: z.boolean(),
    lastSeenAt: z.date().nullable(),
    maxCpuMillicores: z.number().int().min(0).nullable(),
    maxMemoryMb: z.number().int().min(0).nullable(),
    metrics: fleetNodeMetricSchema.nullable(),
    allocationSummary: z.object({
        organizations: z.number().int().min(0),
        cpuMillicores: z.number().int().min(0),
        memoryMb: z.number().int().min(0),
    }),
});

export const fleetOrgServerAllocationSchema = z.object({
    id: z.uuid(),
    organizationId: z.string(),
    organizationName: z.string().nullable(),
    serverNodeId: z.uuid(),
    serverUrl: z.string().nullable(),
    allocationMode: fleetAllocationModeSchema,
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
    maxServices: z.number().int().min(0).nullable(),
    isEnabled: z.boolean(),
    updatedAt: z.date(),
});

const listFleetAllocationsQuerySchema = z.object({
    organizationId: z.string().optional(),
    serverNodeId: z.uuid().optional(),
});

const upsertFleetAllocationInputSchema = z.object({
    organizationId: z.string(),
    serverNodeId: z.uuid(),
    allocationMode: fleetAllocationModeSchema,
    cpuMillicores: z.number().int().min(0),
    memoryMb: z.number().int().min(0),
    maxServices: z.number().int().min(0).nullable().optional(),
    isEnabled: z.boolean().default(true),
});

const deleteFleetAllocationInputSchema = z.object({
    organizationId: z.string(),
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
    organizationId: z.string().optional(),
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
    organizationId: z.string(),
    allowed: z.boolean(),
    reason: z.string().nullable(),
    evaluatedAt: z.date(),
    candidates: z.array(fleetAdmissionCandidateSchema),
});

const fleetAdmissionRequestSchema = z.object({
    id: z.uuid(),
    organizationId: z.string(),
    organizationName: z.string().nullable(),
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
    reviewedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

const fleetServerSummaryOps = standard.zod(fleetServerSummarySchema, "fleetServerSummary");
const fleetOrgServerAllocationOps = standard.zod(
    fleetOrgServerAllocationSchema,
    "fleetOrgServerAllocation",
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

export const fleetListAllocationsContract = fleetOrgServerAllocationOps
    .list()
    .path("/allocations")
    .input((b) => b.query(listFleetAllocationsQuerySchema))
    .output((b) => b.body(z.object({ items: z.array(fleetOrgServerAllocationSchema) })))
    .build();

export const fleetListMyAllocationsContract = fleetOrgServerAllocationOps
    .list()
    .path("/allocations/me")
    .output((b) => b.body(z.object({ items: z.array(fleetOrgServerAllocationSchema) })))
    .build();

export const fleetUpsertAllocationContract = fleetOrgServerAllocationOps
    .create()
    .path("/allocations/upsert")
    .input((b) => b.body(upsertFleetAllocationInputSchema))
    .output((b) => b.body(fleetOrgServerAllocationSchema))
    .build();

export const fleetDeleteAllocationContract = fleetAllocationDeleteOps
    .create()
    .path("/allocations/delete")
    .input((b) => b.body(deleteFleetAllocationInputSchema))
    .output((b) => b.body(fleetAllocationDeleteResultSchema))
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

export const fleetContract = oc.tag("Core Fleet").prefix("/fleet").router({
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

export type FleetContract = typeof fleetContract;
