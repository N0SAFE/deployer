import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshPartitionPolicy } from "./mesh-partition-policy";
import type { PartitionPolicyInput } from "./mesh-partition-policy";

describe("MeshPartitionPolicy", () => {
    const originalQuorumSize = process.env.MESH_QUORUM_SIZE;
    const originalQuorumMode = process.env.MESH_QUORUM_MODE;

    afterEach(() => {
        if (originalQuorumSize === undefined) {
            delete process.env.MESH_QUORUM_SIZE;
        } else {
            process.env.MESH_QUORUM_SIZE = originalQuorumSize;
        }
        if (originalQuorumMode === undefined) {
            delete process.env.MESH_QUORUM_MODE;
        } else {
            process.env.MESH_QUORUM_MODE = originalQuorumMode;
        }
    });

    // ------------------------------------------------------------------
    // getConfiguredQuorumSize
    // ------------------------------------------------------------------
    describe("getConfiguredQuorumSize", () => {
        it("defaults to 1 when MESH_QUORUM_SIZE is not set", () => {
            delete process.env.MESH_QUORUM_SIZE;
            expect(MeshPartitionPolicy.getConfiguredQuorumSize()).toBe(1);
        });

        it("parses MESH_QUORUM_SIZE=3 as 3", () => {
            process.env.MESH_QUORUM_SIZE = "3";
            expect(MeshPartitionPolicy.getConfiguredQuorumSize()).toBe(3);
        });

        it("accepts MESH_QUORUM_SIZE=0 (single-node no-quorum mode)", () => {
            process.env.MESH_QUORUM_SIZE = "0";
            expect(MeshPartitionPolicy.getConfiguredQuorumSize()).toBe(0);
        });

        it("falls back to 1 for invalid non-numeric value", () => {
            process.env.MESH_QUORUM_SIZE = "bad";
            expect(MeshPartitionPolicy.getConfiguredQuorumSize()).toBe(1);
        });
    });

    // ------------------------------------------------------------------
    // getConfiguredConsistencyMode
    // ------------------------------------------------------------------
    describe("getConfiguredConsistencyMode", () => {
        it("defaults to 'hybrid' when MESH_QUORUM_MODE is not set", () => {
            delete process.env.MESH_QUORUM_MODE;
            expect(MeshPartitionPolicy.getConfiguredConsistencyMode()).toBe("hybrid");
        });

        it("returns 'ap' when MESH_QUORUM_MODE=ap", () => {
            process.env.MESH_QUORUM_MODE = "ap";
            expect(MeshPartitionPolicy.getConfiguredConsistencyMode()).toBe("ap");
        });

        it("returns 'cp' when MESH_QUORUM_MODE=cp", () => {
            process.env.MESH_QUORUM_MODE = "cp";
            expect(MeshPartitionPolicy.getConfiguredConsistencyMode()).toBe("cp");
        });

        it("falls back to 'hybrid' for an unknown mode string", () => {
            process.env.MESH_QUORUM_MODE = "eventual";
            expect(MeshPartitionPolicy.getConfiguredConsistencyMode()).toBe("hybrid");
        });
    });

    // ------------------------------------------------------------------
    // evaluate — AP mode
    // ------------------------------------------------------------------
    describe("evaluate — AP mode", () => {
        const base: PartitionPolicyInput = { consistencyMode: "ap", activePeerCount: 0, quorumSize: 3 };

        it("healthy state even with zero peers", () => {
            delete process.env.MESH_QUORUM_MODE;
            const result = MeshPartitionPolicy.evaluate(base);
            expect(result.effectiveLifecycleState).toBe("healthy");
        });

        it("canWrite = true regardless of peer count", () => {
            delete process.env.MESH_QUORUM_MODE;
            expect(MeshPartitionPolicy.evaluate(base).canWrite).toBe(true);
            expect(MeshPartitionPolicy.evaluate({ ...base, activePeerCount: 5 }).canWrite).toBe(true);
        });

        it("canRead = true", () => {
            delete process.env.MESH_QUORUM_MODE;
            expect(MeshPartitionPolicy.evaluate(base).canRead).toBe(true);
        });

        it("reason is 'ap_always_available'", () => {
            delete process.env.MESH_QUORUM_MODE;
            expect(MeshPartitionPolicy.evaluate(base).reason).toBe("ap_always_available");
        });

        it("quorumMet reflects actual peer count vs quorumSize", () => {
            delete process.env.MESH_QUORUM_MODE;
            expect(MeshPartitionPolicy.evaluate({ ...base, activePeerCount: 0, quorumSize: 1 }).quorumMet).toBe(false);
            expect(MeshPartitionPolicy.evaluate({ ...base, activePeerCount: 1, quorumSize: 1 }).quorumMet).toBe(true);
        });
    });

    // ------------------------------------------------------------------
    // evaluate — CP mode
    // ------------------------------------------------------------------
    describe("evaluate — CP mode", () => {
        beforeEach(() => {
            process.env.MESH_QUORUM_MODE = "cp";
        });

        it("healthy + canWrite when quorum met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 2, quorumSize: 2 };
            const result = MeshPartitionPolicy.evaluate(input);
            expect(result.effectiveLifecycleState).toBe("healthy");
            expect(result.canWrite).toBe(true);
        });

        it("isolated + canWrite=false when quorum not met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 1, quorumSize: 2 };
            const result = MeshPartitionPolicy.evaluate(input);
            expect(result.effectiveLifecycleState).toBe("isolated");
            expect(result.canWrite).toBe(false);
        });

        it("canRead is always true in CP mode", () => {
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 0, quorumSize: 3 };
            expect(MeshPartitionPolicy.evaluate(input).canRead).toBe(true);
        });

        it("reason is 'cp_quorum_met' when quorum met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 3, quorumSize: 2 };
            expect(MeshPartitionPolicy.evaluate(input).reason).toBe("cp_quorum_met");
        });

        it("reason is 'cp_quorum_lost' when quorum not met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 0, quorumSize: 1 };
            expect(MeshPartitionPolicy.evaluate(input).reason).toBe("cp_quorum_lost");
        });

        it("quorumSize=0 means quorum always met (single-node standalone)", () => {
            process.env.MESH_QUORUM_SIZE = "0";
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 0, quorumSize: 0 };
            const result = MeshPartitionPolicy.evaluate(input);
            expect(result.quorumMet).toBe(true);
            expect(result.canWrite).toBe(true);
        });
    });

    // ------------------------------------------------------------------
    // evaluate — hybrid mode
    // ------------------------------------------------------------------
    describe("evaluate — hybrid mode", () => {
        beforeEach(() => {
            process.env.MESH_QUORUM_MODE = "hybrid";
        });

        it("healthy + canWrite when quorum met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "hybrid", activePeerCount: 2, quorumSize: 2 };
            const result = MeshPartitionPolicy.evaluate(input);
            expect(result.effectiveLifecycleState).toBe("healthy");
            expect(result.canWrite).toBe(true);
        });

        it("degraded + canWrite=true when quorum not met (soft degrade, not hard block)", () => {
            const input: PartitionPolicyInput = { consistencyMode: "hybrid", activePeerCount: 0, quorumSize: 2 };
            const result = MeshPartitionPolicy.evaluate(input);
            expect(result.effectiveLifecycleState).toBe("degraded");
            expect(result.canWrite).toBe(true);
        });

        it("canRead = true even when degraded", () => {
            const input: PartitionPolicyInput = { consistencyMode: "hybrid", activePeerCount: 0, quorumSize: 1 };
            expect(MeshPartitionPolicy.evaluate(input).canRead).toBe(true);
        });

        it("reason is 'hybrid_quorum_met' when quorum met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "hybrid", activePeerCount: 1, quorumSize: 1 };
            expect(MeshPartitionPolicy.evaluate(input).reason).toBe("hybrid_quorum_met");
        });

        it("reason is 'hybrid_degraded_no_quorum' when quorum not met", () => {
            const input: PartitionPolicyInput = { consistencyMode: "hybrid", activePeerCount: 0, quorumSize: 1 };
            expect(MeshPartitionPolicy.evaluate(input).reason).toBe("hybrid_degraded_no_quorum");
        });
    });

    // ------------------------------------------------------------------
    // evaluate — env override beats input consistencyMode
    // ------------------------------------------------------------------
    describe("evaluate — env mode overrides input consistencyMode", () => {
        it("MESH_QUORUM_MODE=cp overrides node consistencyMode='ap'", () => {
            process.env.MESH_QUORUM_MODE = "cp";
            const input: PartitionPolicyInput = { consistencyMode: "ap", activePeerCount: 0, quorumSize: 2 };
            const result = MeshPartitionPolicy.evaluate(input);
            // CP kicks in → quorum not met → isolated + no write
            expect(result.effectiveLifecycleState).toBe("isolated");
            expect(result.canWrite).toBe(false);
        });

        it("MESH_QUORUM_MODE=ap overrides node consistencyMode='cp'", () => {
            process.env.MESH_QUORUM_MODE = "ap";
            const input: PartitionPolicyInput = { consistencyMode: "cp", activePeerCount: 0, quorumSize: 5 };
            const result = MeshPartitionPolicy.evaluate(input);
            // AP kicks in → always writable
            expect(result.canWrite).toBe(true);
            expect(result.effectiveLifecycleState).toBe("healthy");
        });

        it("activePeerCount is always reflected in the result", () => {
            delete process.env.MESH_QUORUM_MODE;
            const result = MeshPartitionPolicy.evaluate({
                consistencyMode: "ap",
                activePeerCount: 7,
                quorumSize: 3,
            });
            expect(result.activePeerCount).toBe(7);
        });
    });
});
