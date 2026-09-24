/**
 * SwarmJoinGrantService — the FLEET's answer to "may this joining node become
 * a manager?".
 *
 * RESPONSIBILITY
 * --------------
 * A node joining a fleet asks for a role in its setup wizard. It cannot grant
 * that to itself: promoting a node into the Raft quorum is a cluster-wide
 * decision with real consequences (quorum size, election weight, blast radius
 * if the node dies). So the MESH — the node that already owns the cluster —
 * decides, and hands back both the join tokens and the granted role.
 *
 * THE DECISION (in order)
 * -----------------------
 *   1. No converged swarm on this node → no grant. The joiner must not be told
 *      to join a cluster that does not exist yet.
 *   2. The node explicitly asked for "worker" → grant worker. It opted out of
 *      control-plane duty; there is nothing to weigh.
 *   3. The node asked for "manager" or "auto" (may be master or worker) → it is
 *      a CANDIDATE. It is admitted to quorum only while the fleet benefits:
 *        - fewer managers than the target quorum size, AND
 *        - the fleet still has an EVEN number of managers.
 *
 * WHY ODD-COUNT / EVEN-MANAGER RULE
 * ---------------------------------
 * Raft tolerates `floor((n-1)/2)` manager failures while still forming a
 * majority, so an even manager count buys no extra fault tolerance while
 * raising the cost of losing one:
 *
 *   1 manager  → 0 failures tolerated
 *   2 managers → 0
 *   3 managers → 1
 *   4 managers → 1
 *   5 managers → 2
 *
 * Admitting a candidate onto an EVEN count moves it to ODD (2→3: +1 tolerated
 * failure). Admitting onto an ODD count moves it to EVEN (3→4: no extra
 * tolerance). That is the governing rule.
 *
 * WHY THE FOUNDING COUNT IS AN EXCEPTION
 * --------------------------------------
 * A cluster is founded by exactly ONE manager. A strict parity rule would then
 * decline EVERY joiner forever (1 is odd → "would become even"), so the fleet
 * could never reach a real quorum and its fault tolerance would stay 0 for
 * good. The parity rule therefore only starts governing once the fleet has left
 * the founding state (managerCount >= 2). Below that, the TARGET governs:
 * admitting is the only way to reach it.
 *
 * THE PROMOTION CAVEAT: because a joiner is admitted only onto an even count,
 * a fleet that declines a candidate stays odd and will keep declining until an
 * existing worker is promoted (`docker node promote`). That out-of-band move is
 * an operator action, documented here rather than silently assumed.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { MeshSwarmJoinGrant, SwarmNodePolicy } from "@repo/contracts-entities";
import { SWARM_JOIN_CONFIG, type SwarmJoinConfig } from "../swarm-config";
import { SwarmClusterService } from "./swarm-cluster.service";

/** Default target quorum size when the operator has not pinned one. */
const DEFAULT_QUORUM_TARGET = 3;

@Injectable()
export class SwarmJoinGrantService {
    private readonly logger = new Logger(SwarmJoinGrantService.name);

    constructor(
        private readonly clusterService: SwarmClusterService,
        /**
         * Quorum target + the addresses a joiner may reach this cluster on,
         * supplied as DATA by the app.
         *
         * The package does not read the environment: which variables name the
         * control-plane address is an app convention, and an app with different
         * variables must be able to run the same grant logic.
         */
        @Inject(SWARM_JOIN_CONFIG) private readonly config: SwarmJoinConfig,
    ) {}

    /**
     * Decide the role to grant a joining node, or null when there is no
     * converged swarm to join.
     *
     * Never throws: a fleet that cannot produce a grant simply leaves the
     * joiner converging later (its supervisors degrade with a clear reason)
     * instead of failing its whole setup.
     */
    async buildGrant(requested: SwarmNodePolicy | undefined): Promise<MeshSwarmJoinGrant | null> {
        try {
            const snapshot = await this.clusterService.getLocalClusterSnapshot();
            if (snapshot.localNodeState !== "active") {
                this.logger.log(
                    `No swarm join grant — this node's engine is ${snapshot.localNodeState} (not an active cluster)`,
                );
                return null;
            }

            const tokens = await this.clusterService.getJoinTokens();
            if (tokens === null) {
                this.logger.warn("No swarm join grant — the cluster reports no join tokens");
                return null;
            }

            const target = this.quorumTarget();
            const { role, reason } = this.decideRole({
                requested,
                managerCount: snapshot.managerCount,
                target,
            });

            const controlPlaneAddrs = await this.resolveControlPlaneAddrs();
            if (controlPlaneAddrs.length === 0) {
                this.logger.warn(
                    "No swarm join grant — no control-plane address could be resolved for the joiner",
                );
                return null;
            }

            this.logger.log(
                `Swarm join grant: role=${role} (requested=${requested ?? "auto"}, managers=${String(snapshot.managerCount)}/${String(target)}) — ${reason}`,
            );

            return {
                workerToken: tokens.worker,
                // The manager token is only meaningful when the role is manager;
                // withholding it enforces the decision at the engine level
                // rather than trusting the joiner to obey the role field.
                managerToken: role === "manager" ? tokens.manager : null,
                controlPlaneAddrs,
                role,
                reason,
            };
        } catch (error: unknown) {
            this.logger.warn(
                `Swarm join grant unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
        }
    }

    /**
     * Pure role decision — separated from IO so the policy is directly testable.
     */
    decideRole(input: {
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
     * Quorum target from the supplied config.
     *
     * Normalization: an even cap is rounded UP, not down. A cap of 2 means "at
     * most 2 managers"; rounding down to 1 would silently halve the operator's
     * intended cap, whereas 3 respects their intent AND yields a Raft-usable odd
     * quorum.
     *
     * A cap of 1 is REFUSED (clamped to the default): a 1-manager target is not
     * a quorum — it tolerates zero failures and, combined with the target gate,
     * would freeze the fleet at its founding manager forever. That is a
     * configuration mistake, so it warns rather than silently degrading.
     */
    private quorumTarget(): number {
        const configured = this.config.quorumMax;
        if (configured === 1) {
            this.logger.warn(
                `SWARM_QUORUM_MAX=1 is not a quorum (0 failures tolerated) — using the default of ${String(DEFAULT_QUORUM_TARGET)} so the fleet can grow`,
            );
            return DEFAULT_QUORUM_TARGET;
        }
        const target = configured > 0 ? configured : DEFAULT_QUORUM_TARGET;
        // Odd quorums only: an even target is unreachable by an odd-count rule.
        return target % 2 === 0 ? target + 1 : target;
    }

    /**
     * Addresses the joining node can reach this cluster's control plane on.
     *
     * The candidates are ordered by the app (an explicit swarm address, then an
     * overlay IP, then the node's public URL); the first usable one wins and the
     * manager port is appended when absent.
     */
    private async resolveControlPlaneAddrs(): Promise<string[]> {
        return this.config.controlPlaneCandidates
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value !== "")
            .map((value) => {
                // Already "host:port" — keep verbatim.
                if (/:\d+$/.test(value)) return value;
                // URLs and bare hosts both become "host:2377" (the manager port).
                try {
                    const url = new URL(value);
                    return `${url.hostname}:2377`;
                } catch {
                    return `${value.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}:2377`;
                }
            });
    }
}
