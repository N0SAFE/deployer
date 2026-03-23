import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { DatabaseService } from "@/core/modules/database/services/database.service";
import {
    clusterNodeMetrics,
    clusterNodes,
    clusterOrgAdmissionRequests,
    clusterOrgServerAllocations,
    organization,
} from "@/config/drizzle/schema";

interface UpsertAllocationInput {
    actorUserId: string | null;
    organizationId: string;
    serverNodeId: string;
    allocationMode: "dedicated_full" | "dedicated_slice" | "shared_slice";
    cpuMillicores: number;
    memoryMb: number;
    maxServices: number | null;
    isEnabled: boolean;
};

interface CreateAdmissionRequestInput {
    organizationId: string;
    requesterUserId: string | null;
    requestedCpuMillicores: number;
    requestedMemoryMb: number;
    requestedServices: number;
    requestedServerNodeId?: string;
    requesterNote?: string | null;
};

interface ResolveAdmissionRequestInput {
    requestId: string;
    decision: "approved" | "rejected" | "cancelled";
    reviewerUserId: string | null;
    reviewerNote?: string | null;
    decisionServerNodeId?: string | null;
};

@Injectable()
export class SystemFleetRepository {
    constructor(private readonly databaseService: DatabaseService) {}

    async listServers() {
        const db = this.databaseService.db;

        const servers = await db
            .select({
                clusterId: clusterNodes.clusterId,
                nodeId: clusterNodes.nodeId,
                serverUrl: clusterNodes.serverUrl,
                displayName: clusterNodes.displayName,
                status: clusterNodes.status,
                healthy: clusterNodes.healthy,
                lastSeenAt: clusterNodes.lastSeenAt,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
            })
            .from(clusterNodes)
            .orderBy(desc(clusterNodes.updatedAt));

        const nodeIds = servers.map((server) => server.nodeId);
        if (nodeIds.length === 0) {
            return [];
        }

        const metricsRows = await db
            .select({
                nodeId: clusterNodeMetrics.nodeId,
                metrics: clusterNodeMetrics.metrics,
                reportedAt: clusterNodeMetrics.reportedAt,
            })
            .from(clusterNodeMetrics)
            .where(inArray(clusterNodeMetrics.nodeId, nodeIds))
            .orderBy(desc(clusterNodeMetrics.reportedAt));

        const allocations = await db
            .select({
                serverNodeId: clusterOrgServerAllocations.serverNodeId,
                cpuMillicores: clusterOrgServerAllocations.cpuMillicores,
                memoryMb: clusterOrgServerAllocations.memoryMb,
                organizationId: clusterOrgServerAllocations.organizationId,
            })
            .from(clusterOrgServerAllocations)
            .where(inArray(clusterOrgServerAllocations.serverNodeId, nodeIds));

        const latestMetricsByNode = new Map<string, (typeof metricsRows)[number]>();
        for (const row of metricsRows) {
            if (!latestMetricsByNode.has(row.nodeId)) {
                latestMetricsByNode.set(row.nodeId, row);
            }
        }

        const allocationSummaryByNode = new Map<
            string,
            { organizations: Set<string>; cpuMillicores: number; memoryMb: number }
        >();

        for (const allocation of allocations) {
            const current = allocationSummaryByNode.get(allocation.serverNodeId) ?? {
                organizations: new Set<string>(),
                cpuMillicores: 0,
                memoryMb: 0,
            };

            current.organizations.add(allocation.organizationId);
            current.cpuMillicores += allocation.cpuMillicores;
            current.memoryMb += allocation.memoryMb;
            allocationSummaryByNode.set(allocation.serverNodeId, current);
        }

        return servers.map((server) => {
            const latestMetric = latestMetricsByNode.get(server.nodeId);
            const summary = allocationSummaryByNode.get(server.nodeId);

            return {
                ...server,
                metrics: latestMetric
                    ? {
                          cpuUsage: latestMetric.metrics.cpuUsage,
                          memoryUsage: latestMetric.metrics.memoryUsage,
                          activeStreams: latestMetric.metrics.activeStreams,
                          queueDepth: latestMetric.metrics.queueDepth,
                          reportedAt: latestMetric.reportedAt,
                      }
                    : null,
                allocationSummary: {
                    organizations: summary?.organizations.size ?? 0,
                    cpuMillicores: summary?.cpuMillicores ?? 0,
                    memoryMb: summary?.memoryMb ?? 0,
                },
            };
        });
    }

    async getServerNode(serverNodeId: string) {
        const db = this.databaseService.db;
        return db
            .select({
                nodeId: clusterNodes.nodeId,
                clusterId: clusterNodes.clusterId,
                maxCpuMillicores: clusterNodes.maxCpuMillicores,
                maxMemoryMb: clusterNodes.maxMemoryMb,
            })
            .from(clusterNodes)
            .where(eq(clusterNodes.nodeId, serverNodeId))
            .limit(1)
            .then((rows) => rows[0] ?? null);
    }

    async setServerCapacity(input: {
        serverNodeId: string;
        maxCpuMillicores: number | null;
        maxMemoryMb: number | null;
    }) {
        const db = this.databaseService.db;
        await db
            .update(clusterNodes)
            .set({
                maxCpuMillicores: input.maxCpuMillicores,
                maxMemoryMb: input.maxMemoryMb,
                updatedAt: new Date(),
            })
            .where(eq(clusterNodes.nodeId, input.serverNodeId));
    }

    async listAllocations(input: { organizationId?: string; serverNodeId?: string }) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [];

        if (input.organizationId) {
            conditions.push(eq(clusterOrgServerAllocations.organizationId, input.organizationId));
        }

        if (input.serverNodeId) {
            conditions.push(eq(clusterOrgServerAllocations.serverNodeId, input.serverNodeId));
        }

        return db
            .select({
                id: clusterOrgServerAllocations.id,
                clusterId: clusterOrgServerAllocations.clusterId,
                organizationId: clusterOrgServerAllocations.organizationId,
                organizationName: organization.name,
                serverNodeId: clusterOrgServerAllocations.serverNodeId,
                serverUrl: clusterNodes.serverUrl,
                allocationMode: clusterOrgServerAllocations.allocationMode,
                cpuMillicores: clusterOrgServerAllocations.cpuMillicores,
                memoryMb: clusterOrgServerAllocations.memoryMb,
                maxServices: clusterOrgServerAllocations.maxServices,
                isEnabled: clusterOrgServerAllocations.isEnabled,
                updatedAt: clusterOrgServerAllocations.updatedAt,
            })
            .from(clusterOrgServerAllocations)
            .innerJoin(organization, eq(clusterOrgServerAllocations.organizationId, organization.id))
            .leftJoin(clusterNodes, eq(clusterOrgServerAllocations.serverNodeId, clusterNodes.nodeId))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterOrgServerAllocations.updatedAt));
    }

    async upsertAllocation(input: UpsertAllocationInput) {
        const db = this.databaseService.db;

        const server = await db
            .select({
                clusterId: clusterNodes.clusterId,
                nodeId: clusterNodes.nodeId,
            })
            .from(clusterNodes)
            .where(eq(clusterNodes.nodeId, input.serverNodeId))
            .limit(1)
            .then((rows) => rows[0] ?? null);

        if (!server) {
            throw new Error("Server node is not registered in cluster_nodes");
        }

        await db
            .insert(clusterOrgServerAllocations)
            .values({
                clusterId: server.clusterId,
                organizationId: input.organizationId,
                serverNodeId: input.serverNodeId,
                allocationMode: input.allocationMode,
                cpuMillicores: input.cpuMillicores,
                memoryMb: input.memoryMb,
                maxServices: input.maxServices,
                isEnabled: input.isEnabled,
                createdByUserId: input.actorUserId,
            })
            .onConflictDoUpdate({
                target: [
                    clusterOrgServerAllocations.clusterId,
                    clusterOrgServerAllocations.organizationId,
                    clusterOrgServerAllocations.serverNodeId,
                ],
                set: {
                    allocationMode: input.allocationMode,
                    cpuMillicores: input.cpuMillicores,
                    memoryMb: input.memoryMb,
                    maxServices: input.maxServices,
                    isEnabled: input.isEnabled,
                    updatedAt: new Date(),
                },
            });

        const rows = await this.listAllocations({
            organizationId: input.organizationId,
            serverNodeId: input.serverNodeId,
        });

        return rows[0] ?? null;
    }

    async deleteAllocation(input: { organizationId: string; serverNodeId: string }) {
        const db = this.databaseService.db;
        const server = await db
            .select({
                clusterId: clusterNodes.clusterId,
                nodeId: clusterNodes.nodeId,
            })
            .from(clusterNodes)
            .where(eq(clusterNodes.nodeId, input.serverNodeId))
            .limit(1)
            .then((rows) => rows[0] ?? null);

        if (!server) {
            return { deleted: false };
        }

        const deleted = await db
            .delete(clusterOrgServerAllocations)
            .where(
                and(
                    eq(clusterOrgServerAllocations.clusterId, server.clusterId),
                    eq(clusterOrgServerAllocations.organizationId, input.organizationId),
                    eq(clusterOrgServerAllocations.serverNodeId, input.serverNodeId),
                ),
            )
            .returning({ id: clusterOrgServerAllocations.id });

        return { deleted: deleted.length > 0 };
    }

    async createAdmissionRequest(input: CreateAdmissionRequestInput) {
        const db = this.databaseService.db;

        const scopeAllocations = await this.listAllocations({
            organizationId: input.organizationId,
            serverNodeId: input.requestedServerNodeId,
        });

        const scopeClusterId = scopeAllocations[0]?.clusterId;
        if (!scopeClusterId) {
            throw new Error("Cannot create admission request without at least one allocation scope");
        }

        const [created] = await db
            .insert(clusterOrgAdmissionRequests)
            .values({
            clusterId: scopeClusterId,
            organizationId: input.organizationId,
            status: "pending",
            requestedServerNodeId: input.requestedServerNodeId,
            requestedCpuMillicores: input.requestedCpuMillicores,
            requestedMemoryMb: input.requestedMemoryMb,
            requestedServices: input.requestedServices,
            requesterUserId: input.requesterUserId,
            requesterNote: input.requesterNote ?? null,
            })
            .returning({ id: clusterOrgAdmissionRequests.id });

        if (!created) {
            return null;
        }

        const [latest] = await this.listAdmissionRequestsById(created.id);
        return latest ?? null;
    }

    private async listAdmissionRequestsById(id: string) {
        const db = this.databaseService.db;
        return db
            .select({
                id: clusterOrgAdmissionRequests.id,
                clusterId: clusterOrgAdmissionRequests.clusterId,
                organizationId: clusterOrgAdmissionRequests.organizationId,
                organizationName: organization.name,
                status: clusterOrgAdmissionRequests.status,
                requestedServerNodeId: clusterOrgAdmissionRequests.requestedServerNodeId,
                decisionServerNodeId: clusterOrgAdmissionRequests.decisionServerNodeId,
                requestedCpuMillicores: clusterOrgAdmissionRequests.requestedCpuMillicores,
                requestedMemoryMb: clusterOrgAdmissionRequests.requestedMemoryMb,
                requestedServices: clusterOrgAdmissionRequests.requestedServices,
                requesterUserId: clusterOrgAdmissionRequests.requesterUserId,
                requesterNote: clusterOrgAdmissionRequests.requesterNote,
                reviewedByUserId: clusterOrgAdmissionRequests.reviewedByUserId,
                reviewerNote: clusterOrgAdmissionRequests.reviewerNote,
                reviewedAt: clusterOrgAdmissionRequests.reviewedAt,
                createdAt: clusterOrgAdmissionRequests.createdAt,
                updatedAt: clusterOrgAdmissionRequests.updatedAt,
            })
            .from(clusterOrgAdmissionRequests)
            .innerJoin(organization, eq(clusterOrgAdmissionRequests.organizationId, organization.id))
            .where(eq(clusterOrgAdmissionRequests.id, id))
            .limit(1);
    }

    async listAdmissionRequests(input: {
        organizationId?: string;
        status?: "pending" | "approved" | "rejected" | "cancelled";
    }) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [];

        if (input.organizationId) {
            conditions.push(eq(clusterOrgAdmissionRequests.organizationId, input.organizationId));
        }

        if (input.status) {
            conditions.push(eq(clusterOrgAdmissionRequests.status, input.status));
        }

        return db
            .select({
                id: clusterOrgAdmissionRequests.id,
                clusterId: clusterOrgAdmissionRequests.clusterId,
                organizationId: clusterOrgAdmissionRequests.organizationId,
                organizationName: organization.name,
                status: clusterOrgAdmissionRequests.status,
                requestedServerNodeId: clusterOrgAdmissionRequests.requestedServerNodeId,
                decisionServerNodeId: clusterOrgAdmissionRequests.decisionServerNodeId,
                requestedCpuMillicores: clusterOrgAdmissionRequests.requestedCpuMillicores,
                requestedMemoryMb: clusterOrgAdmissionRequests.requestedMemoryMb,
                requestedServices: clusterOrgAdmissionRequests.requestedServices,
                requesterUserId: clusterOrgAdmissionRequests.requesterUserId,
                requesterNote: clusterOrgAdmissionRequests.requesterNote,
                reviewedByUserId: clusterOrgAdmissionRequests.reviewedByUserId,
                reviewerNote: clusterOrgAdmissionRequests.reviewerNote,
                reviewedAt: clusterOrgAdmissionRequests.reviewedAt,
                createdAt: clusterOrgAdmissionRequests.createdAt,
                updatedAt: clusterOrgAdmissionRequests.updatedAt,
            })
            .from(clusterOrgAdmissionRequests)
            .innerJoin(organization, eq(clusterOrgAdmissionRequests.organizationId, organization.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(clusterOrgAdmissionRequests.updatedAt));
    }

    async resolveAdmissionRequest(input: ResolveAdmissionRequestInput) {
        const db = this.databaseService.db;

        await db
            .update(clusterOrgAdmissionRequests)
            .set({
                status: input.decision,
                reviewedByUserId: input.reviewerUserId,
                reviewerNote: input.reviewerNote ?? null,
                decisionServerNodeId: input.decisionServerNodeId ?? null,
                reviewedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(clusterOrgAdmissionRequests.id, input.requestId));

        const [updated] = await db
            .select({ id: clusterOrgAdmissionRequests.id })
            .from(clusterOrgAdmissionRequests)
            .where(eq(clusterOrgAdmissionRequests.id, input.requestId))
            .limit(1);

        if (!updated) {
            return null;
        }

        const [resolved] = await this.listAdmissionRequestsById(input.requestId);

        return resolved ?? null;
    }
}
