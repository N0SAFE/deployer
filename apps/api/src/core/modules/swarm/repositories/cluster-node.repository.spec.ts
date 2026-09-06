import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import { ConflictError } from "@repo/errors";
import type { LocalDatabaseService } from "@/core/modules/database/local/local-database.service";
import { ClusterNodeRepository } from "./cluster-node.repository";

const snapshotFixture: ClusterSnapshot = {
    clusterId: "cluster-abc",
    clusterName: null,
    localNodeState: "active",
    controlAvailable: true,
    nodeCount: 3,
    managerCount: 3,
    localNode: {
        nodeId: "n1",
        hostname: "node-1",
        swarmRole: "manager",
        platformRole: "both",
        isMaster: true,
        isIngress: true,
        availability: "active",
        capacity: { nanoCpus: 4_000_000_000, memoryBytes: 8_589_934_592 },
        labels: { "deployer.ingress": "true" },
        lastHeartbeatAt: "2026-09-04T00:00:00Z",
    },
    master: {
        nodeId: "n1",
        term: 4,
        electedAt: "2026-09-04T00:00:00Z",
        heartbeatAt: "2026-09-04T00:00:00Z",
        reason: "raft_leader",
    },
    membership: {
        nodeId: "n1",
        state: "active",
        joinedAt: "2026-09-04T00:00:00Z",
    },
    joinTokens: { worker: "worker-token-1", manager: "manager-token-1" },
};

describe("ClusterNodeRepository", () => {
    let repository: ClusterNodeRepository;
    let mockDb: {
        db: {
            insert: ReturnType<typeof vi.fn>;
            select: ReturnType<typeof vi.fn>;
            update: ReturnType<typeof vi.fn>;
        };
    };
    let mockRun: ReturnType<typeof vi.fn>;
    let mockAll: ReturnType<typeof vi.fn>;
    let insertedValues: Record<string, unknown> | null;
    let mockUpdateRun: ReturnType<typeof vi.fn>;
    let updatedValues: Record<string, unknown> | null;

    beforeEach(() => {
        mockRun = vi.fn();
        mockAll = vi.fn();
        mockUpdateRun = vi.fn();
        insertedValues = null;
        updatedValues = null;

        mockDb = {
            db: {
                insert: vi.fn(() => ({
                    values: vi.fn((values: Record<string, unknown>) => {
                        insertedValues = values;
                        return {
                            onConflictDoUpdate: vi.fn(() => ({
                                run: mockRun,
                            })),
                            run: mockRun,
                        };
                    }),
                })),
                select: vi.fn(() => ({
                    from: vi.fn(() => ({
                        limit: vi.fn(() => ({
                            all: mockAll,
                        })),
                    })),
                })),
                update: vi.fn(() => ({
                    set: vi.fn((values: Record<string, unknown>) => {
                        updatedValues = values;
                        return {
                            where: vi.fn(() => ({
                                run: mockUpdateRun,
                            })),
                        };
                    }),
                })),
            },
        };

        repository = new ClusterNodeRepository(mockDb as unknown as LocalDatabaseService);
    });

    it("returns null when the table does not exist yet", () => {
        mockAll.mockImplementation(() => {
            throw new Error("no such table: cluster_node");
        });
        expect(repository.find()).toBeNull();
    });

    it("returns the stored row when present", () => {
        mockAll.mockReturnValue([{ id: 1, swarmRole: "manager" }]);
        expect(repository.find()).toEqual({ id: 1, swarmRole: "manager" });
    });

    it("maps a ClusterSnapshot into the row (engine truth) and re-reads it", () => {
        mockAll.mockReturnValue([{ id: 1, swarmRole: "manager" }]);
        const row = repository.upsertFromSnapshot(snapshotFixture);

        expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
        expect(mockRun).toHaveBeenCalledTimes(1);
        expect(insertedValues).toMatchObject({
            id: 1,
            clusterId: "cluster-abc",
            localNodeState: "active",
            swarmRole: "manager",
            platformRole: "both",
            isMaster: true,
            isIngress: true,
            availability: "active",
            nodeCount: 3,
            managerCount: 3,
            masterNodeId: "n1",
            masterTerm: 4,
            joinTokenWorker: "worker-token-1",
            joinTokenManager: "manager-token-1",
        });
        expect(row).toEqual({ id: 1, swarmRole: "manager" });
    });

    it("falls back to the heartbeat timestamp when the node has none", () => {
        mockAll.mockReturnValue([{ id: 1 }]);
        repository.upsertFromSnapshot({
            ...snapshotFixture,
            localNode: { ...snapshotFixture.localNode, lastHeartbeatAt: null },
        });
        expect(typeof insertedValues?.lastHeartbeatAt).toBe("string");
        expect(typeof insertedValues?.updatedAt).toBe("string");
    });

    it("throws ConflictError when the upsert succeeds but the re-read returns nothing", () => {
        mockAll.mockReturnValue([]);
        expect(() => repository.upsertFromSnapshot(snapshotFixture)).toThrow(ConflictError);
    });

    describe("claimMaster (CAS)", () => {
        it("claims when the observed term matches and increments the term", () => {
            mockAll.mockReturnValue([{ id: 1, masterNodeId: null, masterTerm: 0 }]);
            const claimed = repository.claimMaster("n2", 0, "better_candidate");

            expect(claimed).toBe(true);
            expect(mockDb.db.update).toHaveBeenCalledTimes(1);
            expect(updatedValues).toMatchObject({
                masterNodeId: "n2",
                masterTerm: 1,
                isMaster: true,
            });
            expect(mockUpdateRun).toHaveBeenCalledTimes(1);
        });

        it("rejects when the observed term is stale (lost race)", () => {
            mockAll.mockReturnValue([{ id: 1, masterNodeId: "other", masterTerm: 5 }]);
            const claimed = repository.claimMaster("n2", 4, "better_candidate");

            expect(claimed).toBe(false);
            expect(mockDb.db.update).not.toHaveBeenCalled();
        });

        it("rejects when no row exists yet", () => {
            mockAll.mockReturnValue([]);
            expect(repository.claimMaster("n2", 0, "x")).toBe(false);
        });
    });

    it("touchMasterHeartbeat refreshes the heartbeat timestamp", () => {
        mockAll.mockReturnValue([{ id: 1 }]);
        repository.touchMasterHeartbeat();
        expect(mockDb.db.update).toHaveBeenCalledTimes(1);
        expect(typeof updatedValues?.lastHeartbeatAt).toBe("string");
        expect(mockUpdateRun).toHaveBeenCalledTimes(1);
    });

    it("recordMasterHistory appends an audit row", () => {
        repository.recordMasterHistory("n2", 3, "better_candidate", 1200);
        expect(mockDb.db.insert).toHaveBeenCalledTimes(1);
        expect(insertedValues).toMatchObject({
            nodeId: "n2",
            term: 3,
            reason: "better_candidate",
            durationMs: 1200,
        });
        expect(mockRun).toHaveBeenCalledTimes(1);
    });
});