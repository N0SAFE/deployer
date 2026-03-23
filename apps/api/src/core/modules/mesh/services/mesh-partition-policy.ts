import type { MeshNodeLifecycleState, MeshPartitionConsistencyMode } from "@repo/api-contracts/common/mesh";

// ---------------------------------------------------------------------------
// T107 — Partition / Failover Policy
//
// Pure (non-NestJS) domain logic for resolving the effective availability of
// a mesh node depending on its configured consistency mode (AP / CP / hybrid),
// the number of currently reachable peers, and the cluster-wide quorum size.
//
// AP  (Availability)  — writes always succeed; reads may be stale.
// CP  (Consistency)   — writes blocked when quorum is not met; prefers correctness.
// hybrid              — writes degrade when quorum is not met but never hard-block;
//                       the node moves to "degraded" lifecycle state instead.
// ---------------------------------------------------------------------------

export interface PartitionPolicyInput {
    /** Consistency mode from the local node state. */
    consistencyMode: MeshPartitionConsistencyMode;
    /** Number of peer sessions currently in "connected" state. */
    activePeerCount: number;
    /** Minimum number of reachable peers required to consider quorum met. */
    quorumSize: number;
}

export interface PartitionPolicyResult {
    /** Effective lifecycle state the local node should expose. */
    effectiveLifecycleState: MeshNodeLifecycleState;
    /** True when activePeerCount >= quorumSize. */
    quorumMet: boolean;
    /** True when the node is permitted to service write requests. */
    canWrite: boolean;
    /** True when the node is permitted to service read requests. */
    canRead: boolean;
    /** Machine-readable reason for the decision. */
    reason: string;
    /** Number of connected peers that fed this decision. */
    activePeerCount: number;
}

/**
 * MeshPartitionPolicy
 *
 * Pure utility class — no NestJS DI, no I/O.  Instantiate directly or call
 * the static `evaluate` / `getConfiguredQuorumSize` helpers.
 */
export class MeshPartitionPolicy {
    /**
     * Reads `MESH_QUORUM_SIZE` from the environment (default: 1) and
     * `MESH_QUORUM_MODE` (default: "hybrid").  Only the modes declared in
     * `MeshPartitionConsistencyMode` ("ap" | "cp" | "hybrid") are supported;
     * unknown values fall back to "hybrid".
     */
    static getConfiguredQuorumSize(): number {
        const raw = process.env.MESH_QUORUM_SIZE;
        const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
    }

    static getConfiguredConsistencyMode(): MeshPartitionConsistencyMode {
        const raw = process.env.MESH_QUORUM_MODE;
        if (raw === "ap" || raw === "cp" || raw === "hybrid") {
            return raw;
        }
        return "hybrid";
    }

    /**
     * Core decision function.
     *
     * @param input.consistencyMode  — node's own configured mode (from `MeshNodeState`)
     * @param input.activePeerCount  — number of currently connected peers
     * @param input.quorumSize       — minimum peers for quorum
     */
    static evaluate(input: PartitionPolicyInput): PartitionPolicyResult {
        const { activePeerCount, quorumSize } = input;

        // Consistency mode: prefer env override when explicitly set, fall back to
        // whatever was passed in (e.g., from the local node's persisted state).
        const envMode = process.env.MESH_QUORUM_MODE;
        const consistencyMode: MeshPartitionConsistencyMode =
            envMode === "ap" || envMode === "cp" || envMode === "hybrid"
                ? envMode
                : input.consistencyMode;

        const quorumMet = activePeerCount >= quorumSize;

        if (consistencyMode === "ap") {
            // Always available — never block writes regardless of peer count.
            return {
                effectiveLifecycleState: "healthy",
                quorumMet,
                canWrite: true,
                canRead: true,
                reason: "ap_always_available",
                activePeerCount,
            };
        }

        if (consistencyMode === "cp") {
            if (quorumMet) {
                return {
                    effectiveLifecycleState: "healthy",
                    quorumMet: true,
                    canWrite: true,
                    canRead: true,
                    reason: "cp_quorum_met",
                    activePeerCount,
                };
            }

            // CP + quorum lost → hard-block writes, set isolated state.
            return {
                effectiveLifecycleState: "isolated",
                quorumMet: false,
                canWrite: false,
                canRead: true,
                reason: "cp_quorum_lost",
                activePeerCount,
            };
        }

        // hybrid mode
        if (quorumMet) {
            return {
                effectiveLifecycleState: "healthy",
                quorumMet: true,
                canWrite: true,
                canRead: true,
                reason: "hybrid_quorum_met",
                activePeerCount,
            };
        }

        // hybrid + quorum lost → degrade (still serve, flag staleness).
        return {
            effectiveLifecycleState: "degraded",
            quorumMet: false,
            canWrite: true,
            canRead: true,
            reason: "hybrid_degraded_no_quorum",
            activePeerCount,
        };
    }
}
