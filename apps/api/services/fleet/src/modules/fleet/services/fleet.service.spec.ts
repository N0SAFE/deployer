import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { FleetService } from "./fleet.service";
import type { FleetRepository } from "../repositories/fleet.repository";

/**
 * FleetService had no spec despite being the backing service for the `nodes.*`
 * ORPC contract, and despite P1-7 fixing a fabricated-zero return in
 * `setServerCapacity` — a fix with no regression guard until now.
 *
 * The repository is a plain fake rather than a NestJS testing module: this
 * service has a single dependency and does no DI-scoped work, so a module
 * would only add indirection.
 */

const iso = (value: string) => new Date(value);

function mkServerRow(overrides: Record<string, unknown> = {}) {
    return {
        nodeId: "node-1",
        serverUrl: "http://node-1:3012",
        displayName: "Node One",
        status: "active",
        healthy: true,
        lastSeenAt: iso("2026-09-17T10:00:00.000Z"),
        swarmNodeId: "swarm-1",
        maxCpuMillicores: 4000,
        maxMemoryMb: 8192,
        cpuUsage: null,
        reportedAt: null,
        ...overrides,
    };
}

function mkAllocationRow(overrides: Record<string, unknown> = {}) {
    return {
        nodeId: "node-1",
        serverUrl: "http://node-1:3012",
        maxCpuMillicores: 4000,
        maxMemoryMb: 8192,
        allocation: {
            id: "alloc-1",
            serverNodeId: "node-1",
            allocationMode: "shared",
            cpuMillicores: 1000,
            memoryMb: 2048,
            maxServices: 10,
            isEnabled: true,
            updatedAt: iso("2026-09-17T10:00:00.000Z"),
        },
        ...overrides,
    };
}

describe("FleetService", () => {
    let service: FleetService;
    let repo: {
        listServersWithMetrics: ReturnType<typeof vi.fn>;
        listEnabledAllocations: ReturnType<typeof vi.fn>;
        updateServerCapacity: ReturnType<typeof vi.fn>;
        listAllocationsWithNames: ReturnType<typeof vi.fn>;
        listAllocations: ReturnType<typeof vi.fn>;
        findEnabledAllocations: ReturnType<typeof vi.fn>;
        insertAdmissionRequest: ReturnType<typeof vi.fn>;
        listAdmissionRequests: ReturnType<typeof vi.fn>;
        updateAdmissionRequestDecision: ReturnType<typeof vi.fn>;
        findAllocation: ReturnType<typeof vi.fn>;
        updateAllocation: ReturnType<typeof vi.fn>;
        insertAllocation: ReturnType<typeof vi.fn>;
        deleteAllocation: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        repo = {
            listServersWithMetrics: vi.fn().mockResolvedValue([]),
            listEnabledAllocations: vi.fn().mockResolvedValue([]),
            updateServerCapacity: vi.fn().mockResolvedValue(null),
            listAllocationsWithNames: vi.fn().mockResolvedValue([]),
            listAllocations: vi.fn().mockResolvedValue([]),
            findEnabledAllocations: vi.fn().mockResolvedValue([]),
            insertAdmissionRequest: vi.fn().mockResolvedValue([]),
            listAdmissionRequests: vi.fn().mockResolvedValue([]),
            updateAdmissionRequestDecision: vi.fn().mockResolvedValue(null),
            findAllocation: vi.fn().mockResolvedValue([]),
            updateAllocation: vi.fn().mockResolvedValue([]),
            insertAllocation: vi.fn().mockResolvedValue([]),
            deleteAllocation: vi.fn().mockResolvedValue({ rowCount: 0 }),
        };
        service = new FleetService(repo as unknown as FleetRepository);
    });

    describe("listServers — allocation aggregation", () => {
        it("sums enabled allocations per server instead of reporting zeros", async () => {
            repo.listServersWithMetrics.mockResolvedValue([mkServerRow()]);
            repo.listEnabledAllocations.mockResolvedValue([
                { serverNodeId: "node-1", cpuMillicores: 500, memoryMb: 256 },
                { serverNodeId: "node-1", cpuMillicores: 250, memoryMb: 128 },
            ]);

            const { items } = await service.listServers();

            expect(items).toHaveLength(1);
            expect(items[0]?.allocationSummary).toEqual({
                services: 2,
                cpuMillicores: 750,
                memoryMb: 384,
            });
        });

        it("attributes allocations only to their own server", async () => {
            repo.listServersWithMetrics.mockResolvedValue([
                mkServerRow({ nodeId: "node-1" }),
                mkServerRow({ nodeId: "node-2" }),
            ]);
            repo.listEnabledAllocations.mockResolvedValue([
                { serverNodeId: "node-2", cpuMillicores: 900, memoryMb: 512 },
            ]);

            const { items } = await service.listServers();

            const one = items.find((i: { nodeId: string }) => i.nodeId === "node-1");
            const two = items.find((i: { nodeId: string }) => i.nodeId === "node-2");
            expect(one?.allocationSummary).toEqual({ services: 0, cpuMillicores: 0, memoryMb: 0 });
            expect(two?.allocationSummary).toEqual({ services: 1, cpuMillicores: 900, memoryMb: 512 });
        });

        it("treats null allocation amounts as zero", async () => {
            repo.listServersWithMetrics.mockResolvedValue([mkServerRow()]);
            repo.listEnabledAllocations.mockResolvedValue([
                { serverNodeId: "node-1", cpuMillicores: null, memoryMb: null },
            ]);

            const { items } = await service.listServers();

            expect(items[0]?.allocationSummary).toEqual({ services: 1, cpuMillicores: 0, memoryMb: 0 });
        });

        it("reports metrics as null when none were reported", async () => {
            repo.listServersWithMetrics.mockResolvedValue([mkServerRow({ cpuUsage: null })]);

            const { items } = await service.listServers();

            expect(items[0]?.metrics).toBeNull();
            expect(items[0]?.lastSeenAt).toBe("2026-09-17T10:00:00.000Z");
        });

        it("defaults missing metric fields to zero rather than undefined", async () => {
            repo.listServersWithMetrics.mockResolvedValue([
                mkServerRow({ cpuUsage: { cpuUsage: 12 }, reportedAt: iso("2026-09-17T11:00:00.000Z") }),
            ]);

            const { items } = await service.listServers();

            expect(items[0]?.metrics).toEqual({
                cpuUsage: 12,
                memoryUsage: 0,
                activeStreams: 0,
                queueDepth: 0,
                reportedAt: "2026-09-17T11:00:00.000Z",
            });
        });
    });

    describe("setServerCapacity — P1-7 regression", () => {
        it("returns the aggregated allocation summary, not zeros", async () => {
            repo.updateServerCapacity.mockResolvedValue(mkServerRow());
            repo.listEnabledAllocations.mockResolvedValue([
                { serverNodeId: "node-1", cpuMillicores: 400, memoryMb: 256 },
                { serverNodeId: "node-1", cpuMillicores: 600, memoryMb: 512 },
                { serverNodeId: "other", cpuMillicores: 9999, memoryMb: 9999 },
            ]);

            const summary = await service.setServerCapacity({
                serverNodeId: "node-1",
                maxCpuMillicores: 8000,
                maxMemoryMb: 16384,
            });

            // The other server's allocation must not leak into this summary —
            // the pre-P1-7 code returned a hardcoded zero object here.
            expect(summary.allocationSummary).toEqual({
                services: 2,
                cpuMillicores: 1000,
                memoryMb: 768,
            });
            expect(summary.nodeId).toBe("node-1");
        });

        it("throws NotFound when the server does not exist", async () => {
            repo.updateServerCapacity.mockResolvedValue(null);

            await expect(
                service.setServerCapacity({ serverNodeId: "ghost", maxCpuMillicores: 1, maxMemoryMb: 1 }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("checkMyAdmission — feasibility", () => {
        const request = { requestedCpuMillicores: 500, requestedMemoryMb: 512, requestedServices: 1 };

        it("allows when an allocation has room", async () => {
            repo.findEnabledAllocations.mockResolvedValue([mkAllocationRow()]);

            const result = await service.checkMyAdmission("user-1", request);

            expect(result.allowed).toBe(true);
            expect(result.reason).toBeNull();
        });

        it("denies with a node-specific reason when there are no enabled allocations", async () => {
            repo.findEnabledAllocations.mockResolvedValue([]);

            const result = await service.checkMyAdmission("user-1", request);

            expect(result.allowed).toBe(false);
            expect(result.reason).toBe("No enabled allocation for the requested node");
        });

        it("denies with a capacity-specific reason when allocations exist but are full", async () => {
            repo.findEnabledAllocations.mockResolvedValue([
                mkAllocationRow({
                    maxCpuMillicores: 1000,
                    maxMemoryMb: 2048,
                    allocation: { ...mkAllocationRow().allocation, cpuMillicores: 1000, memoryMb: 2048 },
                }),
            ]);

            const result = await service.checkMyAdmission("user-1", request);

            expect(result.allowed).toBe(false);
            expect(result.reason).toBe(
                "No allocation has enough remaining capacity for the requested resources",
            );
        });

        it("clamps negative availability to zero rather than going negative", async () => {
            repo.findEnabledAllocations.mockResolvedValue([
                mkAllocationRow({
                    maxCpuMillicores: 1000,
                    maxMemoryMb: 2048,
                    allocation: { ...mkAllocationRow().allocation, cpuMillicores: 9999, memoryMb: 9999 },
                }),
            ]);

            const result = await service.checkMyAdmission("user-1", request);

            expect(result.candidates[0]?.availableCpuMillicores).toBe(0);
            expect(result.candidates[0]?.availableMemoryMb).toBe(0);
        });

        it("ignores the services limit when the request asks for none", async () => {
            repo.findEnabledAllocations.mockResolvedValue([
                mkAllocationRow({ allocation: { ...mkAllocationRow().allocation, maxServices: 0 } }),
            ]);

            const result = await service.checkMyAdmission("user-1", {
                ...request,
                requestedServices: 0,
            });

            expect(result.allowed).toBe(true);
        });

        it("enforces the services limit when the request asks for several", async () => {
            repo.findEnabledAllocations.mockResolvedValue([
                mkAllocationRow({ allocation: { ...mkAllocationRow().allocation, maxServices: 2 } }),
            ]);

            const result = await service.checkMyAdmission("user-1", {
                ...request,
                requestedServices: 5,
            });

            expect(result.allowed).toBe(false);
        });

        it("treats an unlimited allocation as satisfying any service count", async () => {
            repo.findEnabledAllocations.mockResolvedValue([
                mkAllocationRow({ allocation: { ...mkAllocationRow().allocation, maxServices: null } }),
            ]);

            const result = await service.checkMyAdmission("user-1", {
                ...request,
                requestedServices: 999,
            });

            expect(result.allowed).toBe(true);
        });
    });

    describe("admission request writes", () => {
        it("throws BadRequest when the insert returns no row", async () => {
            repo.insertAdmissionRequest.mockResolvedValue([]);

            await expect(
                service.createMyAdmissionRequest("user-1", {
                    requestedCpuMillicores: 1,
                    requestedMemoryMb: 1,
                    requestedServices: 1,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it("throws NotFound when resolving an unknown request", async () => {
            repo.updateAdmissionRequestDecision.mockResolvedValue(null);

            await expect(
                service.resolveAdmissionRequest({ requestId: "missing", decision: "approved" }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe("upsertAllocation", () => {
        it("updates the existing allocation instead of inserting a duplicate", async () => {
            repo.findAllocation.mockResolvedValue([{ id: "alloc-1" }]);
            repo.updateAllocation.mockResolvedValue([
                {
                    id: "alloc-1",
                    serverNodeId: "node-1",
                    allocationMode: "dedicated",
                    cpuMillicores: 2000,
                    memoryMb: 4096,
                    maxServices: 5,
                    isEnabled: true,
                    updatedAt: iso("2026-09-17T12:00:00.000Z"),
                },
            ]);

            const result = await service.upsertAllocation({
                serverNodeId: "node-1",
                allocationMode: "dedicated",
                cpuMillicores: 2000,
                memoryMb: 4096,
                maxServices: 5,
            });

            expect(repo.insertAllocation).not.toHaveBeenCalled();
            expect(result.cpuMillicores).toBe(2000);
        });

        it("inserts when no allocation exists yet", async () => {
            repo.findAllocation.mockResolvedValue([]);
            repo.insertAllocation.mockResolvedValue([
                {
                    id: "alloc-new",
                    serverNodeId: "node-1",
                    allocationMode: "shared",
                    cpuMillicores: 100,
                    memoryMb: 100,
                    maxServices: null,
                    isEnabled: true,
                    updatedAt: iso("2026-09-17T12:00:00.000Z"),
                },
            ]);

            await service.upsertAllocation({
                serverNodeId: "node-1",
                allocationMode: "shared",
                cpuMillicores: 100,
                memoryMb: 100,
            });

            expect(repo.updateAllocation).not.toHaveBeenCalled();
            expect(repo.insertAllocation).toHaveBeenCalledOnce();
        });

        it("throws BadRequest when neither update nor insert returns a row", async () => {
            repo.findAllocation.mockResolvedValue([]);
            repo.insertAllocation.mockResolvedValue([]);

            await expect(
                service.upsertAllocation({
                    serverNodeId: "node-1",
                    allocationMode: "shared",
                    cpuMillicores: 1,
                    memoryMb: 1,
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe("deleteAllocation", () => {
        it("reports deleted=true only when a row was removed", async () => {
            repo.deleteAllocation.mockResolvedValue({ rowCount: 1 });
            await expect(service.deleteAllocation({ serverNodeId: "node-1" })).resolves.toEqual({
                deleted: true,
            });

            repo.deleteAllocation.mockResolvedValue({ rowCount: 0 });
            await expect(service.deleteAllocation({ serverNodeId: "node-1" })).resolves.toEqual({
                deleted: false,
            });
        });

        it("treats a null rowCount as not deleted", async () => {
            repo.deleteAllocation.mockResolvedValue({ rowCount: null });

            await expect(service.deleteAllocation({ serverNodeId: "node-1" })).resolves.toEqual({
                deleted: false,
            });
        });
    });
});
