import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import { SwarmFleetService } from "@/core/modules/swarm/services/swarm-fleet.service";
import { ClusterNodeRepository } from "@/core/modules/swarm/repositories/cluster-node.repository";
import { ClusterNodeInventoryRepository } from "@/core/modules/swarm/repositories/cluster-node-inventory.repository";
import { ClusterService } from "./cluster.service";

const snapshot: ClusterSnapshot = {
    clusterId: "c1",
    clusterName: null,
    localNodeState: "active",
    controlAvailable: true,
    nodeCount: 2,
    managerCount: 1,
    localNode: {
        nodeId: "n1",
        hostname: "h1",
        swarmRole: "manager",
        platformRole: "both",
        isMaster: true,
        isIngress: false,
        availability: "active",
        capacity: { nanoCpus: null, memoryBytes: null },
        labels: {},
        lastHeartbeatAt: null,
    },
    master: null,
    membership: { nodeId: "n1", state: "active", joinedAt: "2026-09-04T00:00:00Z" },
    joinTokens: null,
};

const inventoryRow = {
    nodeId: "n1",
    hostname: "h1",
    swarmRole: "manager",
    platformRole: "both",
    isLeader: true,
    isIngress: false,
    availability: "active",
    nanoCpus: 4_000_000_000,
    memoryBytes: 8_589_934_592,
    labels: {},
    state: "active",
    lastSeenAt: "2026-09-04T00:00:00Z",
    updatedAt: "2026-09-04T00:00:00Z",
};

const nodeRow = {
    id: 1,
    clusterId: "c1",
    localNodeState: "active",
    swarmRole: "manager",
    platformRole: "both",
    isMaster: true,
    isIngress: false,
    availability: "active",
    nodeCount: 2,
    managerCount: 1,
    masterNodeId: "n1",
    masterTerm: 3,
    joinTokenWorker: null,
    joinTokenManager: null,
    lastHeartbeatAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

describe("ClusterService", () => {
    let service: ClusterService;
    let swarm: {
        getLocalClusterSnapshot: ReturnType<typeof vi.fn>;
        listSwarmNodes: ReturnType<typeof vi.fn>;
        inspectSwarmNode: ReturnType<typeof vi.fn>;
        updateSwarmNodeLabels: ReturnType<typeof vi.fn>;
    };
    let fleet: {
        listServices: ReturnType<typeof vi.fn>;
        listTasks: ReturnType<typeof vi.fn>;
        getNodeResources: ReturnType<typeof vi.fn>;
    };
    let nodeRepo: { find: ReturnType<typeof vi.fn> };
    let inventoryRepo: {
        list: ReturnType<typeof vi.fn>;
        upsertAllFromEngine: ReturnType<typeof vi.fn>;
        upsertFromEngine: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        swarm = {
            getLocalClusterSnapshot: vi.fn().mockResolvedValue(snapshot),
            listSwarmNodes: vi.fn().mockResolvedValue([]),
            inspectSwarmNode: vi.fn().mockResolvedValue({
                ID: "n1",
                Version: { Index: 4 },
                Spec: { Name: "n1", Labels: {}, Role: "manager", Availability: "active" },
                Description: { Hostname: "h1", Resources: { NanoCPUs: 4_000_000_000, MemoryBytes: 8_589_934_592 } },
                ManagerStatus: { Leader: true, Reachability: "reachable" },
            }),
            updateSwarmNodeLabels: vi.fn().mockResolvedValue(undefined),
        };
        fleet = {
            listServices: vi.fn().mockResolvedValue([]),
            listTasks: vi.fn().mockResolvedValue([]),
            getNodeResources: vi.fn().mockResolvedValue({
                nodeId: "n1",
                services: [],
                tasks: [],
            }),
        };
        nodeRepo = { find: vi.fn().mockReturnValue(nodeRow) };
        inventoryRepo = {
            list: vi.fn().mockReturnValue([inventoryRow]),
            upsertAllFromEngine: vi.fn().mockReturnValue(1),
            upsertFromEngine: vi.fn().mockImplementation((row) => ({ nodeId: row.nodeId })),
        };
        service = new ClusterService(
            swarm as unknown as SwarmClusterService,
            fleet as unknown as SwarmFleetService,
            nodeRepo as unknown as ClusterNodeRepository,
            inventoryRepo as unknown as ClusterNodeInventoryRepository,
        );
    });

    it("getSnapshot delegates to the swarm cluster service", async () => {
        await expect(service.getSnapshot()).resolves.toEqual(snapshot);
    });

    it("listNodes maps inventory rows into contract rows", async () => {
        const nodes = await service.listNodes(false);
        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toMatchObject({
            nodeId: "n1",
            hostname: "h1",
            swarmRole: "manager",
            isMaster: true,
            isIngress: false,
            state: "active",
            capacity: { nanoCpus: 4_000_000_000, memoryBytes: 8_589_934_592 },
        });
    });

    it("listNodes falls back to a live sweep when the table is empty", async () => {
        inventoryRepo.list.mockReturnValueOnce([]).mockReturnValue([inventoryRow]);
        swarm.listSwarmNodes.mockResolvedValue([{ ID: "n1", Version: { Index: 1 }, Spec: { Name: "n1", Labels: {}, Role: "worker", Availability: "active" }, Description: { Hostname: "h1" }, ManagerStatus: null }]);

        const nodes = await service.listNodes(true);

        expect(inventoryRepo.upsertAllFromEngine).toHaveBeenCalledTimes(1);
        expect(nodes).toHaveLength(1);
    });

    it("getMaster returns the persisted elected master with healthy state", async () => {
        const master = await service.getMaster();
        expect(master).toMatchObject({ nodeId: "n1", term: 3, state: "healthy" });
    });

    it("getMaster returns null when no master is elected", async () => {
        nodeRepo.find.mockReturnValue({ ...nodeRow, masterNodeId: null });
        await expect(service.getMaster()).resolves.toBeNull();
    });

    it("updateNodeLabels applies ingress + role and persists", async () => {
        const result = await service.updateNodeLabels("n1", { ingress: true, platformRole: "control" });

        expect(swarm.updateSwarmNodeLabels).toHaveBeenCalledWith(
            "n1",
            4,
            expect.objectContaining({ "deployer.ingress": "true" }),
        );
        expect(inventoryRepo.upsertFromEngine).toHaveBeenCalledWith(
            expect.objectContaining({ nodeId: "n1", platformRole: "control", isIngress: true }),
        );
        expect(result.platformRole).toBe("control");
        expect(result.isIngress).toBe(true);
    });

    it("updateNodeLabels removes the ingress label when set to false", async () => {
        await service.updateNodeLabels("n1", { ingress: false });

        expect(swarm.updateSwarmNodeLabels).toHaveBeenCalledWith(
            "n1",
            4,
            expect.not.objectContaining({ "deployer.ingress": "true" }),
        );
    });
});