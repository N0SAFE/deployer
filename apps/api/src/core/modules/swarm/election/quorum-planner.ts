/**
 * QuorumPlanner — odd manager-count sizing + quorum-intactness for the
 * platform master election (docs/swarm-orchestration/02 §5, 03 §4).
 *
 * Pure functions; all robustness is unit-testable without a daemon.
 */

export interface QuorumPlan {
    /** Number of swarm managers the cluster should keep. */
    managerCount: number;
    /** Hot standby slots (managers that are not the master). */
    hotStandbys: number;
    /** True when electing a master is safe given the manager count. */
    canElect: boolean;
    /** Human explanation for `canElect === false`. */
    reason: string | null;
}

/**
 * Force an odd manager count: `Q = min(quorumMax, nodeCount)`, then if even,
 * drop to `Q - 1` (never elect into an even quorum unless nodeCount < 2).
 * A single node is treated as odd (quorum of 1).
 */
export function planQuorum(nodeCount: number, quorumMax: number): QuorumPlan {
    const nodes = Math.max(0, Math.floor(nodeCount));
    const max = Math.max(1, Math.floor(quorumMax));

    if (nodes === 0) {
        return {
            managerCount: 0,
            hotStandbys: 0,
            canElect: false,
            reason: "no nodes in the cluster",
        };
    }

    let managerCount = Math.min(max, nodes);
    if (managerCount % 2 === 0 && managerCount > 1) {
        managerCount -= 1;
    }

    return {
        managerCount,
        hotStandbys: Math.max(0, managerCount - 1),
        canElect: true,
        reason: null,
    };
}

/**
 * Raft quorum intactness: reachable managers must be > half of the total
 * manager count (`reachableManagers >= floor(total / 2) + 1`).
 */
export function isQuorumIntact(reachableManagers: number, totalManagers: number): boolean {
    const reachable = Math.max(0, Math.floor(reachableManagers));
    const total = Math.max(0, Math.floor(totalManagers));
    if (total === 0) {
        return reachable >= 1;
    }
    return reachable >= Math.floor(total / 2) + 1;
}