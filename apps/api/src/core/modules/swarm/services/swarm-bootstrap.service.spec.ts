import { Test, type TestingModule } from "@nestjs/testing";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.service";
import { ClusterNodeRepository } from "../repositories/cluster-node.repository";
import { PlatformStackService } from "./platform-stack.service";
import { SwarmBootstrapService } from "./swarm-bootstrap.service";
import { SwarmClusterService } from "./swarm-cluster.service";

const snapshotFixture: ClusterSnapshot = {
    clusterId: "abc123",
    clusterName: null,
    localNodeState: "active",
    controlAvailable: true,
    nodeCount: 1,
    managerCount: 1,
    localNode: {
        nodeId: "n1",
        hostname: "node-1",
        swarmRole: "manager",
        platformRole: "both",
        isMaster: true,
        isIngress: false,
        availability: "active",
        capacity: { nanoCpus: null, memoryBytes: null },
        labels: {},
        lastHeartbeatAt: null,
    },
    master: {
        nodeId: "n1",
        term: 1,
        electedAt: "2026-09-04T00:00:00Z",
        heartbeatAt: "2026-09-04T00:00:00Z",
        reason: "single_node",
    },
    membership: {
        nodeId: "n1",
        state: "active",
        joinedAt: "2026-09-04T00:00:00Z",
    },
    joinTokens: { worker: "worker-token", manager: "manager-token" },
};

describe("SwarmBootstrapService", () => {
    let service: SwarmBootstrapService;
    let clusterService: { ensureCluster: ReturnType<typeof vi.fn>; assertClusterReady: ReturnType<typeof vi.fn> };
    let clusterNodeRepository: { upsertFromSnapshot: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> };
    let platformStackService: { ensurePlatformStack: ReturnType<typeof vi.fn> };
    let envService: { get: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        clusterService = {
            ensureCluster: vi.fn(),
            assertClusterReady: vi.fn(),
        };
        clusterNodeRepository = {
            upsertFromSnapshot: vi.fn(),
            find: vi.fn(),
        };
        platformStackService = {
            ensurePlatformStack: vi.fn().mockResolvedValue(undefined),
        };
        envService = {
            get: vi.fn((key: string) => {
                if (key === "SWARM_ENABLED") return true;
                if (key === "SWARM_ADVERTISE_ADDR") return undefined;
                return undefined;
            }),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                SwarmBootstrapService,
                { provide: SwarmClusterService, useValue: clusterService },
                { provide: ClusterNodeRepository, useValue: clusterNodeRepository },
                { provide: PlatformStackService, useValue: platformStackService },
                { provide: EnvService, useValue: envService },
            ],
        }).compile();

        service = moduleRef.get(SwarmBootstrapService);
    });

    it("skips convergence when SWARM_ENABLED=false", async () => {
        envService.get.mockImplementation((key: string) => (key === "SWARM_ENABLED" ? false : undefined));
        await service.onApplicationBootstrap();
        expect(clusterService.ensureCluster).not.toHaveBeenCalled();
        expect(clusterNodeRepository.upsertFromSnapshot).not.toHaveBeenCalled();
    });

    it("converges to an active cluster and uses SWARM_ADVERTISE_ADDR when set", async () => {
        envService.get.mockImplementation((key: string) => {
            if (key === "SWARM_ENABLED") return true;
            if (key === "SWARM_ADVERTISE_ADDR") return "10.0.0.1";
            return undefined;
        });
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockReturnValue({ swarmRole: "manager" });

        await service.onApplicationBootstrap();

        expect(clusterService.ensureCluster).toHaveBeenCalledTimes(1);
        expect(clusterService.ensureCluster).toHaveBeenCalledWith({ AdvertiseAddr: "10.0.0.1" });
    });

    it("passes an empty options object when no advertise address is configured", async () => {
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockReturnValue({ swarmRole: "manager" });
        await service.onApplicationBootstrap();
        expect(clusterService.ensureCluster).toHaveBeenCalledWith({});
    });

    it("persists the cluster snapshot (SW-012) and join tokens (SW-011) after converging", async () => {
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockReturnValue({ swarmRole: "manager" });

        await service.onApplicationBootstrap();

        expect(clusterNodeRepository.upsertFromSnapshot).toHaveBeenCalledTimes(1);
        expect(clusterNodeRepository.upsertFromSnapshot).toHaveBeenCalledWith(snapshotFixture);
    });

    it("deploys the platform swarm stack after converge (API-driven, no CLI)", async () => {
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockReturnValue({ swarmRole: "manager" });

        await service.onApplicationBootstrap();

        expect(platformStackService.ensurePlatformStack).toHaveBeenCalledTimes(1);
    });

    it("never throws when the platform stack ensure fails (best-effort)", async () => {
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockReturnValue({ swarmRole: "manager" });
        platformStackService.ensurePlatformStack.mockRejectedValue(new Error("engine busy"));

        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it("never throws when persistence fails (best-effort persistence)", async () => {
        clusterService.ensureCluster.mockResolvedValue(snapshotFixture);
        clusterNodeRepository.upsertFromSnapshot.mockImplementation(() => {
            throw new Error("db unavailable");
        });
        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it("never throws when the engine is not swarm-capable (best-effort)", async () => {
        clusterService.ensureCluster.mockRejectedValue(new Error("docker swarm unavailable"));
        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
        expect(clusterNodeRepository.upsertFromSnapshot).not.toHaveBeenCalled();
    });

    it("never throws when the readiness probe itself fails", async () => {
        clusterService.ensureCluster.mockRejectedValue(new Error("engine unreachable"));
        await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
});