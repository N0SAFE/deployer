import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import {
  clusterNodes,
  clusterServerAllocations,
  clusterAdmissionRequests,
} from "@/config/drizzle/global/schema";
import { FleetRepository } from "../repositories/fleet.repository";

type ServerRow = typeof clusterNodes.$inferSelect;
type AllocationRow = typeof clusterServerAllocations.$inferSelect;
type AdmissionRequestRow = typeof clusterAdmissionRequests.$inferSelect;

/**
 * Fleet Service — business logic over the cluster fleet data model
 * (cluster_nodes, cluster_org_server_allocations,
 * cluster_org_admission_requests).
 *
 * All data access is delegated to FleetRepository; this class owns
 * aggregation, capacity feasibility and view mapping. Backs the
 * `core.fleet.*` ORPC contract.
 */
@Injectable()
export class FleetService {
    constructor(private readonly fleetRepository: FleetRepository) {}

    // ── Servers ────────────────────────────────────────────────────
    async listServers() {
        const rows = await this.fleetRepository.listServersWithMetrics();

        const items = rows.map((row) => {
            const metrics = row.cpuUsage;
            return {
                nodeId: row.nodeId,
                serverUrl: row.serverUrl,
                displayName: row.displayName,
                status: row.status,
                healthy: row.healthy,
                lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
                maxCpuMillicores: row.maxCpuMillicores,
                maxMemoryMb: row.maxMemoryMb,
                metrics: metrics
                    ? {
                        cpuUsage: metrics.cpuUsage ?? 0,
                        memoryUsage: metrics.memoryUsage ?? 0,
                        activeStreams: metrics.activeStreams ?? 0,
                        queueDepth: metrics.queueDepth ?? 0,
                        reportedAt: row.reportedAt ? row.reportedAt.toISOString() : new Date().toISOString(),
                    }
                    : null,
                allocationSummary: { services: 0, cpuMillicores: 0, memoryMb: 0 },
            };
        });

        // Aggregate allocation summary per server.
        const allocations = await this.fleetRepository.listEnabledAllocations();
        const summaryByServer = new Map<string, { services: number; cpuMillicores: number; memoryMb: number }>();
        for (const allocation of allocations) {
            const current = summaryByServer.get(allocation.serverNodeId) ?? { services: 0, cpuMillicores: 0, memoryMb: 0 };
            current.services += 1;
            current.cpuMillicores += allocation.cpuMillicores ?? 0;
            current.memoryMb += allocation.memoryMb ?? 0;
            summaryByServer.set(allocation.serverNodeId, current);
        }

        for (const item of items) {
            item.allocationSummary = summaryByServer.get(item.nodeId) ?? { services: 0, cpuMillicores: 0, memoryMb: 0 };
        }

        return { items };
    }

    async setServerCapacity(input: { serverNodeId: string; maxCpuMillicores: number | null; maxMemoryMb: number | null }) {
        const row = await this.fleetRepository.updateServerCapacity(
            input.serverNodeId,
            input.maxCpuMillicores,
            input.maxMemoryMb,
        );
        if (!row) {
            throw new NotFoundException(`Cluster node ${input.serverNodeId} not found`);
        }
        return this.toServerSummary(row, null, { services: 0, cpuMillicores: 0, memoryMb: 0 });
    }

    // ── Allocations ────────────────────────────────────────────────
    async listAllocations(query: { serverNodeId?: string }) {
        const rows = await this.fleetRepository.listAllocationsWithNames(query);
        return {
            items: rows.map((row) => this.toAllocation(row.allocation, row.serverUrl)),
        };
    }

    async listMyAllocations() {
        const rows = await this.fleetRepository.listAllocations();
        return {
            items: rows.map((row) => this.toAllocation(row.allocation, row.serverUrl)),
        };
    }

    async checkMyAdmission(userId: string, input: {
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        serverNodeId?: string;
    }) {
        const rows = await this.fleetRepository.findEnabledAllocations(input.serverNodeId);

        const candidates = rows.map((row) => ({
            allocationId: row.allocation.id,
            serverNodeId: row.allocation.serverNodeId,
            serverUrl: row.serverUrl,
            allocationMode: row.allocation.allocationMode,
            availableCpuMillicores: Math.max(0, (row.maxCpuMillicores ?? 0) - (row.allocation.cpuMillicores ?? 0)),
            availableMemoryMb: Math.max(0, (row.maxMemoryMb ?? 0) - (row.allocation.memoryMb ?? 0)),
            maxServices: row.allocation.maxServices,
        }));

        const feasible = candidates.find(
            (candidate) =>
                candidate.availableCpuMillicores >= input.requestedCpuMillicores &&
                candidate.availableMemoryMb >= input.requestedMemoryMb &&
                (input.requestedServices <= 0 || candidate.maxServices == null || candidate.maxServices >= input.requestedServices),
        );

        return {
            allowed: feasible != null,
            reason: feasible
                ? null
                : candidates.length === 0
                  ? "No enabled allocation for the requested node"
                  : "No allocation has enough remaining capacity for the requested resources",
            evaluatedAt: new Date().toISOString(),
            candidates,
        };
    }

    async createMyAdmissionRequest(userId: string, input: {
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        requestedServerNodeId?: string;
        requesterNote?: string | null;
    }) {
        const [row] = await this.fleetRepository.insertAdmissionRequest({
            requestedServerNodeId: input.requestedServerNodeId ?? null,
            requestedCpuMillicores: input.requestedCpuMillicores,
            requestedMemoryMb: input.requestedMemoryMb,
            requestedServices: input.requestedServices,
            requesterUserId: userId,
            requesterNote: input.requesterNote ?? null,
        });
        if (!row) {
            throw new BadRequestException("Failed to create admission request");
        }
        return this.toAdmissionRequest(row);
    }

    async listMyAdmissionRequests(userId: string, query: { status?: string }) {
        const rows = await this.fleetRepository.listAdmissionRequests(query.status);
        return { items: rows.map((row) => this.toAdmissionRequest(row.request)) };
    }

    async upsertAllocation(input: {
        serverNodeId: string;
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices?: number | null;
        isEnabled?: boolean;
    }) {
        const [existing] = await this.fleetRepository.findAllocation(input.serverNodeId);

        const rows = existing
            ? await this.fleetRepository.updateAllocation(existing.id, {
                  allocationMode: input.allocationMode,
                  cpuMillicores: input.cpuMillicores,
                  memoryMb: input.memoryMb,
                  maxServices: input.maxServices ?? null,
                  isEnabled: input.isEnabled ?? true,
              })
            : await this.fleetRepository.insertAllocation({
                  serverNodeId: input.serverNodeId,
                  allocationMode: input.allocationMode,
                  cpuMillicores: input.cpuMillicores,
                  memoryMb: input.memoryMb,
                  maxServices: input.maxServices ?? null,
                  isEnabled: input.isEnabled ?? true,
              });

        const [row] = rows;
        if (!row) {
            throw new BadRequestException("Failed to upsert allocation");
        }
        return this.toAllocation(row, null);
    }

    async deleteAllocation(input: { serverNodeId: string }) {
        const deleted = await this.fleetRepository.deleteAllocation(input.serverNodeId);
        return { deleted: (deleted.rowCount ?? 0) > 0 };
    }

    // ── Admission requests ─────────────────────────────────────────
    async listAdmissionRequests(query: { status?: string }) {
        const rows = await this.fleetRepository.listAdmissionRequests(query.status);
        return { items: rows.map((row) => this.toAdmissionRequest(row.request)) };
    }

    async resolveAdmissionRequest(input: { requestId: string; decision: string; reviewerNote?: string | null; decisionServerNodeId?: string | null }) {
        const row = await this.fleetRepository.updateAdmissionRequestDecision(
            input.requestId,
            input.decision,
            input.reviewerNote ?? null,
            input.decisionServerNodeId ?? null,
        );
        if (!row) {
            throw new NotFoundException(`Admission request ${input.requestId} not found`);
        }
        return this.toAdmissionRequest(row);
    }

    // ── Helpers ────────────────────────────────────────────────────
    private toServerSummary<M>(row: ServerRow, metrics: M, summary: { services: number; cpuMillicores: number; memoryMb: number }) {
        return {
            nodeId: row.nodeId,
            serverUrl: row.serverUrl,
            displayName: row.displayName,
            status: row.status,
            healthy: row.healthy,
            lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
            maxCpuMillicores: row.maxCpuMillicores,
            maxMemoryMb: row.maxMemoryMb,
            metrics,
            allocationSummary: summary,
        };
    }

    private toAllocation(row: AllocationRow, serverUrl: string | null) {
        return {
            id: row.id,
            serverNodeId: row.serverNodeId,
            serverUrl,
            allocationMode: row.allocationMode,
            cpuMillicores: row.cpuMillicores ?? 0,
            memoryMb: row.memoryMb ?? 0,
            maxServices: row.maxServices,
            isEnabled: row.isEnabled,
            updatedAt: row.updatedAt.toISOString(),
        };
    }

    private toAdmissionRequest(row: AdmissionRequestRow) {
        return {
            id: row.id,
            status: row.status,
            requestedServerNodeId: row.requestedServerNodeId,
            decisionServerNodeId: row.decisionServerNodeId,
            requestedCpuMillicores: row.requestedCpuMillicores ?? 0,
            requestedMemoryMb: row.requestedMemoryMb ?? 0,
            requestedServices: row.requestedServices ?? 1,
            requesterUserId: row.requesterUserId,
            requesterNote: row.requesterNote,
            reviewedByUserId: row.reviewedByUserId,
            reviewerNote: row.reviewerNote,
            reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
}
