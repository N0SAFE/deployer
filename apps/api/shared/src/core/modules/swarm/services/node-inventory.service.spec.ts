import { Effect } from "effect";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ClusterNodeInventoryRepositoryShape } from "@deployer/node-state";
import type { SwarmClusterShape } from "@deployer/swarm"

import { NodeInventoryService } from "./node-inventory.service";

import type { GlobalClusterNodesRepository } from "../repositories/global-cluster-nodes.repository";

const activeSnapshot = {
    localNodeState: "active",
    nodeCount: 2,
    managerCount: 1,
    localNode: { nodeId: "n1", swarmRole: "manager" },
} as never;

const engineNode = (id: string) => ({
    ID: id,
    Version: { Index: 1 },
    Spec: { Name: id, Labels: {}, Role: "worker", Availability: "active" },
    Description: { Hostname: `host-${id}` },
    // `toEngineNodeRow` reads `Status.State`; without it every sync threw.
    Status: { State: "ready" },
    ManagerStatus: null,
});

describe("NodeInventoryService", () => {
    let service: NodeInventoryService;
    // Kept as the mock shape so per-test assertions keep their `vi.fn()` typing; the
    // value is asserted to `SwarmClusterShape` at the single construction site.
    let clusterService: { getLocalClusterSnapshot: ReturnType<typeof vi.fn>; listSwarmNodes: ReturnType<typeof vi.fn> };
    let repository: {
        upsertFromEngine: ReturnType<typeof vi.fn>;
        markMissingNodeDown: ReturnType<typeof vi.fn>;
        list: ReturnType<typeof vi.fn>;
    };
    let globalClusterNodes: { enrollLocalNode: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        clusterService = {
            getLocalClusterSnapshot: vi.fn().mockReturnValue(Effect.succeed(activeSnapshot)),
            listSwarmNodes: vi.fn().mockReturnValue(Effect.succeed([engineNode("n1"), engineNode("n2")])),
            // `SwarmClusterShape` exposes 14 members; this unit only drives the two the
            // inventory reads, so the stub is asserted to the interface here.
        };
        repository = {
            upsertFromEngine: vi.fn().mockImplementation((row) => Effect.succeed({ nodeId: row.nodeId })),
            markMissingNodeDown: vi.fn().mockReturnValue(Effect.succeed(0)),
            list: vi.fn().mockReturnValue(Effect.succeed([])),
        };
        globalClusterNodes = {
            enrollLocalNode: vi.fn().mockResolvedValue(true),
        };
        service = new NodeInventoryService(
            clusterService as never,
            repository as never,
            globalClusterNodes as unknown as GlobalClusterNodesRepository,
        );
    });

    it("enrolls the local node globally at init + on every sync (FK fix)", async () => {
        service.onModuleInit();
        await service.syncOnce();

        expect(globalClusterNodes.enrollLocalNode).toHaveBeenCalledTimes(2);
    });

    it("persists every engine node and marks vanished nodes down", async () => {
        const count = await service.syncOnce();

        expect(count).toBe(2);
        expect(repository.upsertFromEngine).toHaveBeenCalledTimes(2);
        expect(repository.upsertFromEngine).toHaveBeenCalledWith(
            expect.objectContaining({ nodeId: "n1", hostname: "host-n1" }),
        );
        expect(repository.markMissingNodeDown).toHaveBeenCalledWith(["n1", "n2"]);
    });

    it("returns 0 when the engine is not in an active cluster", async () => {
        clusterService.getLocalClusterSnapshot.mockReturnValue(Effect.succeed({
            localNodeState: "inactive",
        }));

        const count = await service.syncOnce();

        expect(count).toBe(0);
        expect(clusterService.listSwarmNodes).not.toHaveBeenCalled();
        expect(repository.upsertFromEngine).not.toHaveBeenCalled();
    });

    it("never throws when the engine probe fails", async () => {
        clusterService.listSwarmNodes.mockReturnValue(Effect.fail(new Error("engine unreachable")));

        await expect(service.syncOnce()).rejects.toThrow("engine unreachable");
    });

    it("marks previously-seen nodes down (drift)", async () => {
        repository.markMissingNodeDown.mockReturnValue(Effect.succeed(1));

        const count = await service.syncOnce();

        expect(count).toBe(2);
        expect(repository.markMissingNodeDown).toHaveBeenCalled();
    });
});