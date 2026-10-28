import type { SwarmNodePolicy } from "@deployer/contracts-entities";

/** Default target quorum size when the operator has not pinned one. */
export const DEFAULT_QUORUM_TARGET = 3;

/**
 * The role to grant a joining node. Pure, so the policy is directly testable: Raft tolerates
 * `floor((n-1)/2)` manager failures, so an even manager count buys no extra tolerance, and a joiner is
 * admitted to quorum only while the fleet is below its target and (once past the founding state of one
 * manager, where parity would decline every joiner forever) at an even count.
 */
export function decideRole(input: {
    requested: SwarmNodePolicy | undefined;
    managerCount: number;
    target: number;
}): { role: "manager" | "worker"; reason: string } {
    const { requested, managerCount, target } = input;

    if (requested === "worker") {
        return {
            role: "worker",
            reason: "the node asked for worker-only, so the fleet grants no control-plane duty",
        };
    }

    if (managerCount === 0) {
        // Defensive: an active cluster always has a manager, but a joiner
        // must never be told "you cannot be a manager" when there is none.
        return {
            role: "worker",
            reason: `the cluster reports no managers — the fleet admits this node as capacity first`,
        };
    }

    if (managerCount >= target) {
        return {
            role: "worker",
            reason: `the fleet already has its target of ${String(target)} managers (${String(managerCount)} present)`,
        };
    }

    // FOUNDING-COUNT EXCEPTION (see the header): a cluster starts with ONE
    // manager. Applying parity here would decline every joiner forever, so
    // the fleet could never reach its quorum target and fault tolerance
    // would stay 0. Growth must be possible before parity starts governing;
    // 1 → 2 is tolerated precisely BECAUSE it is the step that makes a real
    // quorum reachable (a later joiner or a promotion takes it to 3).
    if (managerCount === 1) {
        return {
            role: "manager",
            reason:
                "the fleet has its founding manager only (1 = ODD), so this joiner is admitted to grow towards the " +
                `${String(target)}-manager quorum target — without it the fleet could never leave the single-manager state`,
        };
    }

    if (managerCount % 2 === 0) {
        return {
            role: "manager",
            reason: `managers=${String(managerCount)} is EVEN and below the target of ${String(target)}, so admitting one more moves the quorum to ODD (${String(managerCount + 1)}) and strictly increases fault tolerance`,
        };
    }

    return {
        role: "worker",
        reason: `managers=${String(managerCount)} is already ODD; admitting one more would make it EVEN (${String(managerCount + 1)}) — no gain in fault tolerance. Promote an existing worker to reach the even count that admits a joiner.`,
    };
}

/**
 * The quorum target from the configured cap. An even cap is rounded UP (a cap of 2 means "at most 2";
 * rounding down to 1 would halve the intent, 3 respects it and yields a Raft-usable odd quorum). A cap
 * of 1 is refused: a one-manager target tolerates zero failures and would freeze the fleet at its
 * founding manager, so it falls back to the default and says so in `warning`.
 */
export function quorumTarget(configured: number): { readonly target: number; readonly warning: string | null } {
	if (configured === 1) {
		return {
			target: DEFAULT_QUORUM_TARGET,
			warning: `SWARM_QUORUM_MAX=1 is not a quorum (0 failures tolerated) — using the default of ${String(DEFAULT_QUORUM_TARGET)} so the fleet can grow`,
		};
	}
	const target = configured > 0 ? configured : DEFAULT_QUORUM_TARGET;
	return { target: target % 2 === 0 ? target + 1 : target, warning: null };
}
