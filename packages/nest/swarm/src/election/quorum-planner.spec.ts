import { describe, expect, it } from "vitest";
import { isQuorumIntact, planQuorum } from "./quorum-planner";

describe("planQuorum", () => {
    it("forbids election with zero nodes", () => {
        const plan = planQuorum(0, 3);
        expect(plan.canElect).toBe(false);
        expect(plan.reason).toContain("no nodes");
    });

    it("sizes a single node as quorum of 1", () => {
        const plan = planQuorum(1, 3);
        expect(plan.managerCount).toBe(1);
        expect(plan.hotStandbys).toBe(0);
        expect(plan.canElect).toBe(true);
    });

    it("clamps to quorumMax", () => {
        const plan = planQuorum(9, 3);
        expect(plan.managerCount).toBe(3);
        expect(plan.hotStandbys).toBe(2);
    });

    it("forces odd manager counts", () => {
        expect(planQuorum(2, 3).managerCount).toBe(1); // 2 → min(3,2)=2 → even → 1
        expect(planQuorum(4, 5).managerCount).toBe(3); // 4 → even → 3
        expect(planQuorum(3, 5).managerCount).toBe(3);
    });

    it("handles nodeCount below quorumMax without going negative", () => {
        const plan = planQuorum(1, 1);
        expect(plan.managerCount).toBe(1);
    });
});

describe("isQuorumIntact", () => {
    it("requires > half of managers reachable", () => {
        expect(isQuorumIntact(2, 3)).toBe(true);
        expect(isQuorumIntact(1, 3)).toBe(false); // floor(3/2)+1 = 2
    });

    it("single manager is always intact when reachable", () => {
        expect(isQuorumIntact(1, 1)).toBe(true);
        expect(isQuorumIntact(0, 1)).toBe(false);
    });

    it("treats zero total as intact only when something is reachable", () => {
        expect(isQuorumIntact(1, 0)).toBe(true);
        expect(isQuorumIntact(0, 0)).toBe(false);
    });

    it("four-manager cluster needs 3 reachable", () => {
        expect(isQuorumIntact(3, 4)).toBe(true);
        expect(isQuorumIntact(2, 4)).toBe(false);
    });
});