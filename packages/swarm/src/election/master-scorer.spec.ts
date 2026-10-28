import { describe, expect, it } from "vitest";
import {
    DEFAULT_MASTER_SCORER_WEIGHTS,
    isEligibleAsMaster,
    scoreCandidate,
    selectMasterWinner,
    type MasterCandidateMetrics,
} from "./master-scorer";

const manager = (overrides: Partial<MasterCandidateMetrics> = {}): MasterCandidateMetrics => ({
    nodeId: "n-" + Math.random().toString(36).slice(2, 8),
    latency: 0.1,
    jitter: 0.05,
    memoryPressure: 0.3,
    cpuHeadroom: 0.8,
    stability: 1,
    isManager: true,
    isCurrentMaster: false,
    ...overrides,
});

describe("isEligibleAsMaster", () => {
    it("rejects non-managers", () => {
        expect(isEligibleAsMaster(manager({ isManager: false }))).toBe(false);
    });

    it("rejects saturated-latency candidates", () => {
        expect(isEligibleAsMaster(manager({ latency: 1 }))).toBe(false);
    });

    it("accepts a healthy manager", () => {
        expect(isEligibleAsMaster(manager())).toBe(true);
    });
});

describe("scoreCandidate", () => {
    it("prefers lower latency with default weights", () => {
        const fast = scoreCandidate(manager({ latency: 0.05 }));
        const slow = scoreCandidate(manager({ latency: 0.9 }));
        expect(fast).toBeLessThan(slow);
    });

    it("gives the incumbent a hysteresis bonus", () => {
        const incumbent = scoreCandidate(manager({ isCurrentMaster: true }));
        const challenger = scoreCandidate(manager({ isCurrentMaster: false }));
        expect(incumbent).toBeLessThan(challenger);
    });

    it("clamps out-of-range metrics", () => {
        const score = scoreCandidate(manager({ latency: 5, stability: -2, cpuHeadroom: 3 }));
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeLessThanOrEqual(
            Object.values(DEFAULT_MASTER_SCORER_WEIGHTS).reduce((a, b) => a + b, 0),
        );
    });

    it("weights are deterministic", () => {
        const a = manager({ nodeId: "x1", latency: 0.2 });
        const b = manager({ nodeId: "x1", latency: 0.2 });
        expect(scoreCandidate(a)).toBe(scoreCandidate(b));
    });
});

describe("selectMasterWinner", () => {
    it("returns null when no candidate is eligible", () => {
        expect(selectMasterWinner([manager({ isManager: false })])).toBeNull();
        expect(selectMasterWinner([])).toBeNull();
    });

    it("picks the lowest-scoring eligible candidate", () => {
        const winner = selectMasterWinner([
            manager({ nodeId: "slow", latency: 0.9 }),
            manager({ nodeId: "fast", latency: 0.05 }),
        ]);
        expect(winner?.nodeId).toBe("fast");
    });

    it("breaks ties deterministically by nodeId", () => {
        const winner = selectMasterWinner([
            manager({ nodeId: "b-node", latency: 0.1, jitter: 0.1 }),
            manager({ nodeId: "a-node", latency: 0.1, jitter: 0.1 }),
        ]);
        expect(winner?.nodeId).toBe("a-node");
    });

    it("keeps the incumbent when otherwise marginal", () => {
        const winner = selectMasterWinner([
            manager({ nodeId: "incumbent", isCurrentMaster: true, latency: 0.3 }),
            manager({ nodeId: "challenger", isCurrentMaster: false, latency: 0.28 }),
        ]);
        expect(winner?.nodeId).toBe("incumbent");
    });
});