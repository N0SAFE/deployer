import { FleetInvalid, FleetNotFound } from "../../../core/fleet.errors";
import {
  clusterNodes,
  clusterServerAllocations,
  clusterAdmissionRequests,
} from "@deployer/nest-schema/global/fleet/cluster";
import { serviceOver, type Over } from "@deployer/effect-core";
import { Context, Effect } from "effect";

import type { FleetRepositoryShape } from "../repositories/fleet.repository";
import { FleetRepository } from "../repositories/fleet.repository";

type ServerRow = typeof clusterNodes.$inferSelect;
type AllocationRow = typeof clusterServerAllocations.$inferSelect;
type AdmissionRequestRow = typeof clusterAdmissionRequests.$inferSelect;

/**
 * Fleet Service — business logic over the cluster fleet data model
 * (cluster_nodes, cluster_server_allocations,
 * cluster_org_admission_requests).
 *
 * All data access is delegated to FleetRepository; this class owns
 * aggregation, capacity feasibility and view mapping. Backs the
 * `nodes.*` ORPC contract.
 */
/**
 * Fleet Service — business logic over the cluster fleet data model
 * (cluster_nodes, cluster_server_allocations, cluster_org_admission_requests).
 *
 * All data access is delegated to the repository; this owns aggregation, capacity feasibility and
 * view mapping. Backs the `nodes.*` ORPC contract. A use case fails with `FleetNotFound` or
 * `FleetInvalid` of its own, or with whatever the database raised.
 */
const toServerSummary = <M>(row: ServerRow, metrics: M, summary: { services: number; cpuMillicores: number; memoryMb: number }) => {
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
    };

const toAllocation = (row: AllocationRow, serverUrl: string | null) => {
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
    };

const toAdmissionRequest = (row: AdmissionRequestRow) => {
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
    };

function makeFleetService(fleetRepository: FleetRepositoryShape) {
    return {
        listServers: Effect.fn("FleetService.listServers")(function* () {
        const rows = yield* fleetRepository.listServersWithMetrics();

        const items = rows.map((row) => {
            const metrics = row.cpuUsage;
            return {
                nodeId: row.nodeId,
                serverUrl: row.serverUrl,
                displayName: row.displayName,
                status: row.status,
                healthy: row.healthy,
                lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
                swarmNodeId: row.swarmNodeId ?? null,
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
        const allocations = yield* fleetRepository.listEnabledAllocations();
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
    }),

        setServerCapacity: Effect.fn("FleetService.setServerCapacity")(function* (input: { serverNodeId: string; maxCpuMillicores: number | null; maxMemoryMb: number | null }) {
        const row = yield* fleetRepository.updateServerCapacity(
            input.serverNodeId,
            input.maxCpuMillicores,
            input.maxMemoryMb,
        );
        if (!row) {
            return yield* new FleetNotFound({ reason: `Cluster node ${input.serverNodeId} not found` });
        }
        const allocations = yield* fleetRepository.listEnabledAllocations();
        const allocationSummary = allocations.reduce(
            (summary, allocation) => {
                if (allocation.serverNodeId !== input.serverNodeId) return summary;
                summary.services += 1;
                summary.cpuMillicores += allocation.cpuMillicores ?? 0;
                summary.memoryMb += allocation.memoryMb ?? 0;
                return summary;
            },
            { services: 0, cpuMillicores: 0, memoryMb: 0 },
        );
        return toServerSummary(row, null, allocationSummary);
    }),

        listAllocations: Effect.fn("FleetService.listAllocations")(function* (query: { serverNodeId?: string }) {
        const rows = yield* fleetRepository.listAllocationsWithNames(query);
        return {
            items: rows.map((row) => toAllocation(row.allocation, row.serverUrl)),
        };
    }),

        listMyAllocations: Effect.fn("FleetService.listMyAllocations")(function* () {
        const rows = yield* fleetRepository.listAllocations();
        return {
            items: rows.map((row) => toAllocation(row.allocation, row.serverUrl)),
        };
    }),

        checkMyAdmission: Effect.fn("FleetService.checkMyAdmission")(function* (userId: string, input: {
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        serverNodeId?: string;
    }) {
        const rows = yield* fleetRepository.findEnabledAllocations(input.serverNodeId);

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
    }),

        createMyAdmissionRequest: Effect.fn("FleetService.createMyAdmissionRequest")(function* (userId: string, input: {
        requestedCpuMillicores: number;
        requestedMemoryMb: number;
        requestedServices: number;
        requestedServerNodeId?: string;
        requesterNote?: string | null;
    }) {
        const [row] = yield* fleetRepository.insertAdmissionRequest({
            requestedServerNodeId: input.requestedServerNodeId ?? null,
            requestedCpuMillicores: input.requestedCpuMillicores,
            requestedMemoryMb: input.requestedMemoryMb,
            requestedServices: input.requestedServices,
            requesterUserId: userId,
            requesterNote: input.requesterNote ?? null,
        });
        if (!row) {
            return yield* new FleetInvalid({ reason: "Failed to create admission request" });
        }
        return toAdmissionRequest(row);
    }),

        listMyAdmissionRequests: Effect.fn("FleetService.listMyAdmissionRequests")(function* (userId: string, query: { status?: string }) {
        const rows = yield* fleetRepository.listAdmissionRequests(query.status);
        return { items: rows.map((row) => toAdmissionRequest(row.request)) };
    }),

        upsertAllocation: Effect.fn("FleetService.upsertAllocation")(function* (input: {
        serverNodeId: string;
        allocationMode: string;
        cpuMillicores: number;
        memoryMb: number;
        maxServices?: number | null;
        isEnabled?: boolean;
    }) {
        const [existing] = yield* fleetRepository.findAllocation(input.serverNodeId);

        const rows = existing
            ? yield* fleetRepository.updateAllocation(existing.id, {
                  allocationMode: input.allocationMode,
                  cpuMillicores: input.cpuMillicores,
                  memoryMb: input.memoryMb,
                  maxServices: input.maxServices ?? null,
                  isEnabled: input.isEnabled ?? true,
              })
            : yield* fleetRepository.insertAllocation({
                  serverNodeId: input.serverNodeId,
                  allocationMode: input.allocationMode,
                  cpuMillicores: input.cpuMillicores,
                  memoryMb: input.memoryMb,
                  maxServices: input.maxServices ?? null,
                  isEnabled: input.isEnabled ?? true,
              });

        const [row] = rows;
        if (!row) {
            return yield* new FleetInvalid({ reason: "Failed to upsert allocation" });
        }
        return toAllocation(row, null);
    }),

        deleteAllocation: Effect.fn("FleetService.deleteAllocation")(function* (input: { serverNodeId: string }) {
        const deleted = yield* fleetRepository.deleteAllocation(input.serverNodeId);
        return { deleted: (deleted.rowCount ?? 0) > 0 };
    }),

        listAdmissionRequests: Effect.fn("FleetService.listAdmissionRequests")(function* (query: { status?: string }) {
        const rows = yield* fleetRepository.listAdmissionRequests(query.status);
        return { items: rows.map((row) => toAdmissionRequest(row.request)) };
    }),

        resolveAdmissionRequest: Effect.fn("FleetService.resolveAdmissionRequest")(function* (input: { requestId: string; decision: string; reviewerNote?: string | null; decisionServerNodeId?: string | null }) {
        const row = yield* fleetRepository.updateAdmissionRequestDecision(
            input.requestId,
            input.decision,
            input.reviewerNote ?? null,
            input.decisionServerNodeId ?? null,
        );
        if (!row) {
            return yield* new FleetNotFound({ reason: `Admission request ${input.requestId} not found` });
        }
        return toAdmissionRequest(row);
    }),
    };
}

export type FleetServiceShape = ReturnType<typeof makeFleetService>;

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class FleetService extends Context.Service<FleetService, Over<FleetServiceShape, FleetRepository>>()("fleet/FleetService") {
    /** The repository is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live = serviceOver(FleetRepository, makeFleetService);

}
