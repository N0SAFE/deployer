import { and, asc, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import type { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";
import { attempt } from "../../../core/effects";
import {
  clusterNodes,
  clusterServerAllocations,
  clusterAdmissionRequests,
  clusterNodeMetrics,
} from "@deployer/nest-schema/global/fleet/cluster";

/**
 * FleetRepository — the data-access layer for the cluster fleet model
 * (cluster_nodes, cluster_server_allocations,
 * cluster_org_admission_requests, cluster_node_metrics).
 *
 * Extracted from FleetService, which mixed ~16 raw Drizzle queries with
 * business logic. All query construction lives here; FleetService owns
 * aggregation, feasibility checks and view mapping.
 *
 * Each method is lifted into an Effect that fails with whatever the driver raised (an
 * infrastructure failure the boundary answers as internal). The query builders return rows when awaited.
 */
export function makeFleetRepository(database: GlobalDatabaseService) {
    return {
        listServersWithMetrics: () => attempt(async () => {
        return database.db
            .select({
                nodeId: clusterNodes.nodeId,
                serverUrl: clusterNodes.serverUrl,
                displayName: clusterNodes.displayName,
                status: clusterNodes.status,
                healthy: clusterNodes.healthy,
                lastSeenAt: clusterNodes.lastSeenAt,
                swarmNodeId: clusterNodes.swarmNodeId,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
                cpuUsage: clusterNodeMetrics.metrics,
                reportedAt: clusterNodeMetrics.reportedAt,
            })
            .from(clusterNodes)
            .leftJoin(clusterNodeMetrics, eq(clusterNodeMetrics.nodeId, clusterNodes.nodeId))
            .orderBy(asc(clusterNodes.displayName ?? clusterNodes.serverUrl));
    }),

        listEnabledAllocations: () => attempt(async () => {
        return database.db
            .select({
                serverNodeId: clusterServerAllocations.serverNodeId,
                cpuMillicores: clusterServerAllocations.cpuMillicores,
                memoryMb: clusterServerAllocations.memoryMb,
            })
            .from(clusterServerAllocations)
            .where(eq(clusterServerAllocations.isEnabled, true));
    }),

        updateServerCapacity: (nodeId: string, maxCpuMillicores: number | null, maxMemoryMb: number | null) => attempt(async () => {
        const [row] = await database.db
            .update(clusterNodes)
            .set({ maxCpuMillicores, maxMemoryMb, updatedAt: new Date() })
            .where(eq(clusterNodes.nodeId, nodeId))
            .returning();
        return row ?? null;
    }),

        listAllocationsWithNames: (filters: { serverNodeId?: string }) => attempt(async () => {
        const conditions = [
            filters.serverNodeId ? eq(clusterServerAllocations.serverNodeId, filters.serverNodeId) : undefined,
        ].filter(Boolean);

        return database.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterServerAllocations.updatedAt));
    }),

        listAllocations: () => attempt(async () => {
        return database.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .orderBy(desc(clusterServerAllocations.updatedAt));
    }),

        findEnabledAllocations: (serverNodeId?: string) => attempt(async () => {
        const conditions = [
            eq(clusterServerAllocations.isEnabled, true),
            serverNodeId ? eq(clusterServerAllocations.serverNodeId, serverNodeId) : undefined,
        ].filter(Boolean);

        return database.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .where(conditions.length > 0 ? and(...conditions) : undefined);
    }),

        findAllocation: (serverNodeId: string) => attempt(async () => {
        return database.db
            .select()
            .from(clusterServerAllocations)
            .where(eq(clusterServerAllocations.serverNodeId, serverNodeId))
            .limit(1);
    }),

        updateAllocation: (id: string, values: {
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices: number | null;
        isEnabled: boolean;
    }) => attempt(async () => {
        return database.db
            .update(clusterServerAllocations)
            .set({
                allocationMode: values.allocationMode as never,
                cpuMillicores: values.cpuMillicores,
                memoryMb: values.memoryMb,
                maxServices: values.maxServices,
                isEnabled: values.isEnabled,
                updatedAt: new Date(),
            })
            .where(eq(clusterServerAllocations.id, id))
            .returning();
    }),

        insertAllocation: (values: {
        serverNodeId: string;
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices: number | null;
        isEnabled: boolean;
    }) => attempt(async () => {
        return database.db
            .insert(clusterServerAllocations)
            .values({
                serverNodeId: values.serverNodeId,
                allocationMode: values.allocationMode as never,
                cpuMillicores: values.cpuMillicores,
                memoryMb: values.memoryMb,
                maxServices: values.maxServices,
                isEnabled: values.isEnabled,
            })
            .returning();
    }),

        deleteAllocation: (serverNodeId: string) => attempt(async () => {
        return database.db
            .delete(clusterServerAllocations)
            .where(eq(clusterServerAllocations.serverNodeId, serverNodeId));
    }),

        insertAdmissionRequest: (values: {
        requestedServerNodeId: string | null;
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        requesterUserId: string;
        requesterNote: string | null;
    }) => attempt(async () => {
        return database.db
            .insert(clusterAdmissionRequests)
            .values({
                status: "pending",
                requestedServerNodeId: values.requestedServerNodeId,
                requestedCpuMillicores: values.requestedCpuMillicores,
                requestedMemoryMb: values.requestedMemoryMb,
                requestedServices: values.requestedServices,
                requesterUserId: values.requesterUserId,
                requesterNote: values.requesterNote,
            })
            .returning();
    }),

        listAdmissionRequests: (status?: string) => attempt(async () => {
        const conditions = [
            status ? eq(clusterAdmissionRequests.status, status as never) : undefined,
        ].filter(Boolean);

        return database.db
            .select({
                request: clusterAdmissionRequests,
            })
            .from(clusterAdmissionRequests)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterAdmissionRequests.createdAt));
    }),

        updateAdmissionRequestDecision: (requestId: string, decision: string, reviewerNote: string | null, decisionServerNodeId: string | null) => attempt(async () => {
        const [row] = await database.db
            .update(clusterAdmissionRequests)
            .set({
                status: decision as never,
                reviewerNote,
                decisionServerNodeId,
                reviewedByUserId: null,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(clusterAdmissionRequests.id, requestId))
            .returning();
        return row ?? null;
    }),
    };
}

export type FleetRepositoryShape = ReturnType<typeof makeFleetRepository>;

/** The database the fleet module reads and writes: the shared global one (a Nest provider). */
export class FleetDatabasePort extends Context.Service<FleetDatabasePort, GlobalDatabaseService>()(
    "fleet/FleetDatabasePort",
) {}

/** Tag and implementation together: the tag is the contract, `Live` the Drizzle implementation. */
export class FleetRepository extends Context.Service<FleetRepository, FleetRepositoryShape>()(
    "fleet/FleetRepository",
) {
    static readonly Live: Layer.Layer<FleetRepository, never, FleetDatabasePort> = Layer.effect(
        FleetRepository,
        Effect.gen(function* () {
            return makeFleetRepository(yield* FleetDatabasePort);
        }),
    );
}
