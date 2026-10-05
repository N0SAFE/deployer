import { Test, type TestingModule } from "@nestjs/testing";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import { SWARM_BOOT_CONVERGENCE } from "../swarm-config";
import { SwarmBootstrapService } from "./swarm-bootstrap.service";
import { SwarmParticipationService } from "./swarm-participation.service";

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
    let participation: {
        converge: ReturnType<typeof vi.fn>;
        setupDone: ReturnType<typeof vi.fn>;
        effectiveConfig: ReturnType<typeof vi.fn>;
    };

    /** Build the service with an explicit boot-convergence policy. */
    async function makeService(convergeOnBoot: boolean): Promise<SwarmBootstrapService> {
        participation = {
            converge: vi.fn(),
            setupDone: vi.fn(),
            effectiveConfig: vi.fn(),
        };

        const moduleRef: TestingModule = await Test.createTestingModule({
            providers: [
                SwarmBootstrapService,
                { provide: SwarmParticipationService, useValue: participation },
                { provide: SWARM_BOOT_CONVERGENCE, useValue: convergeOnBoot },
            ],
        }).compile();

        return moduleRef.get(SwarmBootstrapService);
    }

    beforeEach(async () => {
        service = await makeService(true);
    });

    /**
     * An app that founds the cluster inside an OPERATOR-DRIVEN flow (setup) must
     * not touch the engine at startup: doing so founded a swarm on every restart
     * before anything was triggered, and then converged a SECOND time from the
     * trigger the operator's action produced.
     */
    it("does not touch the engine at boot when the app converges from its own flow", async () => {
        const deferred = await makeService(false);
        participation.setupDone.mockReturnValue(true);

        await deferred.onModuleInit();

        expect(participation.converge).not.toHaveBeenCalled();
    });

    it("DEFERS convergence before setup — the wizard decides create vs join", async () => {
        participation.setupDone.mockReturnValue(false);
        await service.onModuleInit();
        // Founding a cluster is the OPERATOR's decision. Initializing here
        // would leave a node that is about to JOIN a fleet owning a cluster it
        // invented, and `swarm init` cannot be undone without destroying the
        // local Raft state. The setup flow calls converge() once the
        // participation is persisted.
        expect(participation.converge).not.toHaveBeenCalled();
    });

    it("converges from the SETUP trigger even before setupDone flips", async () => {
        // The setup flow calls converge("setup") as its final step, AFTER
        // persisting swarmConfig but while the tracker is still running.
        participation.converge.mockResolvedValue(snapshotFixture);
        participation.effectiveConfig.mockReturnValue({
            mode: "create",
            policy: "auto",
            advertiseAddr: null,
            joinToken: null,
            joinAddrs: [],
        });
        await service.converge("setup");
        expect(participation.converge).toHaveBeenCalledTimes(1);
    });

    it("never crashes boot when convergence fails", async () => {
        participation.converge.mockRejectedValue(new Error("no docker engine"));
        await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it("converges after setup completes", async () => {
        participation.setupDone.mockReturnValue(true);
        participation.converge.mockResolvedValue(snapshotFixture);
        participation.effectiveConfig.mockReturnValue({
            mode: "create",
            policy: "auto",
            advertiseAddr: null,
            joinToken: null,
            joinAddrs: [],
        });

        await service.onModuleInit();

        expect(participation.converge).toHaveBeenCalledTimes(1);
    });

    it("never throws when convergence fails (best-effort)", async () => {
        participation.setupDone.mockReturnValue(true);
        participation.converge.mockRejectedValue(new Error("docker swarm unavailable"));
        await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
});