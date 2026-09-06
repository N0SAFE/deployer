import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import {
  clusterNodes,
  clusterServerAllocations,
  clusterAdmissionRequests,
  clusterNodeMetrics,
} from "@/config/drizzle/global/schema";

/**
 * FleetRepository — the data-access layer for the cluster fleet model
 * (cluster_nodes, cluster_server_allocations,
 * cluster_org_admission_requests, cluster_node_metrics).
 *
 * Extracted from FleetService, which mixed ~16 raw Drizzle queries with
 * business logic. All query construction lives here; FleetService owns
 * aggregation, feasibility checks and view mapping.
 */
@Injectable()
export class FleetRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    private get db() {
        return this.databaseService.db;
    }

    // ── Servers ────────────────────────────────────────────────────

    /** Nodes joined with their latest metrics row (one row per node). */
    listServersWithMetrics() {
        return this.db
            .select({
                nodeId: clusterNodes.nodeId,
                serverUrl: clusterNodes.serverUrl,
                displayName: clusterNodes.displayName,
                status: clusterNodes.status,
                healthy: clusterNodes.healthy,
                lastSeenAt: clusterNodes.lastSeenAt,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
                cpuUsage: clusterNodeMetrics.metrics,
                reportedAt: clusterNodeMetrics.reportedAt,
            })
            .from(clusterNodes)
            .leftJoin(clusterNodeMetrics, eq(clusterNodeMetrics.nodeId, clusterNodes.nodeId))
            .orderBy(asc(clusterNodes.displayName ?? clusterNodes.serverUrl));
    }

    /** All enabled allocations (used to aggregate per-server summaries). */
    listEnabledAllocations() {
        return this.db
            .select({
                serverNodeId: clusterServerAllocations.serverNodeId,
                cpuMillicores: clusterServerAllocations.cpuMillicores,
                memoryMb: clusterServerAllocations.memoryMb,
            })
            .from(clusterServerAllocations)
            .where(eq(clusterServerAllocations.isEnabled, true));
    }

    /** Update node capacity. Returns the updated row or null when missing. */
    async updateServerCapacity(nodeId: string, maxCpuMillicores: number | null, maxMemoryMb: number | null) {
        const [row] = await this.db
            .update(clusterNodes)
            .set({ maxCpuMillicores, maxMemoryMb, updatedAt: new Date() })
            .where(eq(clusterNodes.nodeId, nodeId))
            .returning();
        return row ?? null;
    }

    // ── Allocations ────────────────────────────────────────────────

    /** Allocations joined with server URL, optional filters. */
    listAllocationsWithNames(filters: { serverNodeId?: string }) {
        const conditions = [
            filters.serverNodeId ? eq(clusterServerAllocations.serverNodeId, filters.serverNodeId) : undefined,
        ].filter(Boolean);

        return this.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterServerAllocations.updatedAt));
    }

    /** All enabled allocations (server-scoped view). */
    listAllocations() {
        return this.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .orderBy(desc(clusterServerAllocations.updatedAt));
    }

    /** Enabled allocations (feasibility candidates), optional server filter. */
    findEnabledAllocations(serverNodeId?: string) {
        const conditions = [
            eq(clusterServerAllocations.isEnabled, true),
            serverNodeId ? eq(clusterServerAllocations.serverNodeId, serverNodeId) : undefined,
        ].filter(Boolean);

        return this.db
            .select({
                allocation: clusterServerAllocations,
                serverUrl: clusterNodes.serverUrl,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
            })
            .from(clusterServerAllocations)
            .leftJoin(clusterNodes, eq(clusterNodes.nodeId, clusterServerAllocations.serverNodeId))
            .where(conditions.length > 0 ? and(...conditions) : undefined);
    }

    /** Find an allocation for a server (for upsert). */
    findAllocation(serverNodeId: string) {
        return this.db
            .select()
            .from(clusterServerAllocations)
            .where(eq(clusterServerAllocations.serverNodeId, serverNodeId))
            .limit(1);
    }

    updateAllocation(id: string, values: {
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices: number | null;
        isEnabled: boolean;
    }) {
        return this.db
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
    }

    insertAllocation(values: {
        serverNodeId: string;
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices: number | null;
        isEnabled: boolean;
    }) {
        return this.db
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
    }

    deleteAllocation(serverNodeId: string) {
        return this.db
            .delete(clusterServerAllocations)
            .where(eq(clusterServerAllocations.serverNodeId, serverNodeId));
    }

    // ── Admission requests ─────────────────────────────────────────

    insertAdmissionRequest(values: {
        requestedServerNodeId: string | null;
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        requesterUserId: string;
        requesterNote: string | null;
    }) {
        return this.db
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
    }

    /** Admission requests (mesh-wide), optional status filter. */
    listAdmissionRequests(status?: string) {
        const conditions = [
            status ? eq(clusterAdmissionRequests.status, status as never) : undefined,
        ].filter(Boolean);

        return this.db
            .select({
                request: clusterAdmissionRequests,
            })
            .from(clusterAdmissionRequests)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterAdmissionRequests.createdAt));
    }

    /** Apply a review decision. Returns the updated row or null. */
    async updateAdmissionRequestDecision(requestId: string, decision: string, reviewerNote: string | null, decisionServerNodeId: string | null) {
        const [row] = await this.db
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
    }
}
