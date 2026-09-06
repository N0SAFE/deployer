import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import type { ClusterNodeRow } from "@/config/drizzle/local/schema";
import type { EnvService } from "@/config/env/env.service";
import type { ClusterNodeRepository } from "../repositories/cluster-node.repository";
import type { SwarmClusterService } from "../services/swarm-cluster.service";
import {
    SwarmLeadershipService,
    type ClusterMetricsProvider,
    type LeadershipEventSink,
    type MasterChangedEvent,
} from "./swarm-leadership.service";

const activeSnapshot: ClusterSnapshot = {
    clusterId: "c1",
    clusterName: null,
    localNodeState: "active",
    controlAvailable: true,
    nodeCount: 3,
    managerCount: 3,
    localNode: {
        nodeId: "local-node",
        hostname: "local",
        swarmRole: "manager",
        platformRole: "both",
        isMaster: false,
        isIngress: false,
        availability: "active",
        capacity: { nanoCpus: null, memoryBytes: null },
        labels: {},
        lastHeartbeatAt: null,
    },
    master: null,
    membership: { nodeId: "local-node", state: "active", joinedAt: "2026-09-04T00:00:00Z" },
    joinTokens: null,
};

const rowFixture = (overrides: Partial<ClusterNodeRow> = {}): ClusterNodeRow =>
    ({
        id: 1,
        clusterId: "c1",
        localNodeState: "active",
        swarmRole: "manager",
        platformRole: "both",
        isMaster: false,
        isIngress: false,
        availability: "active",
        nodeCount: 3,
        managerCount: 3,
        masterNodeId: null,
        masterTerm: 0,
        joinTokenWorker: null,
        joinTokenManager: null,
        lastHeartbeatAt: null,
        updatedAt: "2026-09-04T00:00:00Z",
        ...overrides,
    });

const envDefaults = (key: string): unknown => {
    switch (key) {
        case "SWARM_ELECTION_EVAL_STABLE_MS": return 15000;
        case "SWARM_ELECTION_EVAL_VOLATILE_MS": return 5000;
        case "SWARM_ELECTION_COOLDOWN_MS": return 60000;
        case "SWARM_ELECTION_DELTA_MASTER": return 0.25;
        case "SWARM_HEARTBEAT_TTL_MS": return 30000;
        case "SWARM_MASTER_GRACE_MS": return 15000;
        case "SWARM_MAX_TERM_SKEW": return 2;
        case "SWARM_TAKEOVER_MIN_UPTIME_MS": return 120000;
        default: return undefined;
    }
};

describe("SwarmLeadershipService", () => {
    let service: SwarmLeadershipService;
    let clusterService: { getLocalClusterSnapshot: ReturnType<typeof vi.fn> };
    let repository: {
        find: ReturnType<typeof vi.fn>;
        claimMaster: ReturnType<typeof vi.fn>;
        touchMasterHeartbeat: ReturnType<typeof vi.fn>;
        recordMasterHistory: ReturnType<typeof vi.fn>;
        upsertFromSnapshot: ReturnType<typeof vi.fn>;
    };
    let provider: { getCandidateMetrics: ReturnType<typeof vi.fn> };
    let events: MasterChangedEvent[];
    let envService: { get: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        clusterService = { getLocalClusterSnapshot: vi.fn().mockResolvedValue(activeSnapshot) };
        repository = {
            find: vi.fn().mockReturnValue(rowFixture()),
            claimMaster: vi.fn().mockReturnValue(true),
            touchMasterHeartbeat: vi.fn(),
            recordMasterHistory: vi.fn(),
            upsertFromSnapshot: vi.fn(),
        };
        provider = {
            getCandidateMetrics: vi.fn().mockResolvedValue([
                { nodeId: "local-node", latency: 0, jitter: 0, memoryPressure: 0, cpuHeadroom: 1, stability: 1, isManager: true, isCurrentMaster: false },
                { nodeId: "peer-a", latency: 0.4, jitter: 0.1, memoryPressure: 0.5, cpuHeadroom: 0.6, stability: 0.9, isManager: true, isCurrentMaster: false },
            ]),
        };
        events = [];
        const sink: LeadershipEventSink = { notifyMasterChanged: (e) => events.push(e) };
        envService = { get: vi.fn(envDefaults) };

        service = new SwarmLeadershipService(
            clusterService as unknown as SwarmClusterService,
            repository as unknown as ClusterNodeRepository,
            envService as unknown as EnvService,
            provider as unknown as ClusterMetricsProvider,
            sink,
        );
    });

    it("elects the best candidate and records the CAS result + history + event", async () => {
        await service.evaluateNow();

        expect(repository.claimMaster).toHaveBeenCalledWith("local-node", 0, "better_candidate");
        expect(repository.recordMasterHistory).toHaveBeenCalledWith("local-node", 1, "better_candidate", null);
        expect(events.length).toBe(1);
        expect(events[0]).toMatchObject({ nodeId: "local-node", term: 1 });
    });

    it("keeps a healthy incumbent (no CAS, heartbeat refreshed)", async () => {
        repository.find.mockReturnValue(
            rowFixture({ masterNodeId: "local-node", masterTerm: 2, isMaster: true, lastHeartbeatAt: new Date().toISOString() }),
        );
        provider.getCandidateMetrics.mockResolvedValue([
            { nodeId: "local-node", latency: 0, jitter: 0, memoryPressure: 0, cpuHeadroom: 1, stability: 1, isManager: true, isCurrentMaster: true },
            { nodeId: "peer-a", latency: 0.9, jitter: 0.9, memoryPressure: 0.9, cpuHeadroom: 0.1, stability: 0.2, isManager: true, isCurrentMaster: false },
        ]);

        await service.evaluateNow();

        expect(repository.touchMasterHeartbeat).toHaveBeenCalled();
        expect(repository.claimMaster).not.toHaveBeenCalled();
    });

    it("takes over when the master heartbeat is stale", async () => {
        repository.find.mockReturnValue(
            rowFixture({ masterNodeId: "dead-peer", masterTerm: 4, isMaster: false, lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString() }),
        );

        await service.evaluateNow();

        expect(repository.claimMaster).toHaveBeenCalledWith("local-node", 4, "master_heartbeat_stale");
        expect(repository.recordMasterHistory).toHaveBeenCalledWith("local-node", 5, "master_heartbeat_stale", expect.any(Number));
    });

    it("pauses election on quorum loss", async () => {
        provider.getCandidateMetrics.mockResolvedValue([
            { nodeId: "local-node", latency: 0, jitter: 0, memoryPressure: 0, cpuHeadroom: 1, stability: 1, isManager: true, isCurrentMaster: false },
        ]);
        // nodeCount=3 (from snapshot), only 1 manager reachable → quorum lost.

        await service.evaluateNow();

        expect(repository.claimMaster).not.toHaveBeenCalled();
    });

    it("steps down when the local node lost leadership elsewhere", async () => {
        repository.find.mockReturnValue(
            rowFixture({ masterNodeId: "other-master", masterTerm: 3, isMaster: true, lastHeartbeatAt: new Date().toISOString() }),
        );

        await service.evaluateNow();

        expect(repository.claimMaster).not.toHaveBeenCalled();
        expect(repository.touchMasterHeartbeat).not.toHaveBeenCalled();
    });

    it("does nothing when the engine is not in an active cluster", async () => {
        clusterService.getLocalClusterSnapshot.mockResolvedValue({ ...activeSnapshot, localNodeState: "inactive" });

        await service.evaluateNow();

        expect(repository.claimMaster).not.toHaveBeenCalled();
    });
});