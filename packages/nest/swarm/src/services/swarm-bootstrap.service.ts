/**
 * SwarmBootstrapService — converges the local engine into Swarm mode AFTER the
 * setup wizard has recorded how this node participates.
 *
 * WHY SETUP, NOT BOOT: the cluster decision belongs to the operator. Founding a
 * cluster is not something the API may do on its own initiative, because a node
 * that is about to JOIN a fleet must not first invent a cluster of its own —
 * `docker swarm init` cannot be undone without destroying the local Raft state.
 * So the engine stays untouched until setup writes `node_config.swarmConfig`
 * (the wizard ALWAYS writes it: `local` → create, `remote` → join), and this
 * service converges FROM that persisted decision: once at boot for an
 * already-set-up node, and once from the setup flow that just wrote it.
 *
 * `SwarmParticipationService.converge()` is idempotent and re-reads the
 * persisted config, so this is safe to call again from the cluster UI after an
 * operator changes the participation.
 *
 * LAYERING: Swarm orchestrates the WORKLOAD Deployer owns (user deployments via
 * the `runners/swarm` backend) AND Deployer's own platform infra, which the
 * supervisors express as global/replicated swarm services. With no active
 * cluster the supervisors DEFER (`pending`, never `degraded`) rather than
 * falling back to plain containers, and the app's boot re-converges them once
 * setup has created the cluster.
 */

import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { SwarmParticipationService } from "./swarm-participation.service";

@Injectable()
export class SwarmBootstrapService implements OnModuleInit {
    private readonly logger = new Logger(SwarmBootstrapService.name);

    constructor(private readonly participation: SwarmParticipationService) {}

    async onModuleInit(): Promise<void> {
        if (!this.participation.setupDone()) {
            // Pre-setup: never initialize swarm. The WIZARD decides how this
            // node enters the cluster (create vs join) and its role policy;
            // initializing here would leave a node that is about to join a
            // fleet owning a cluster it invented. The setup flow calls
            // `converge()` once that decision is persisted.
            this.logger.log(
                "Swarm convergence deferred until setup — the cluster entry mode (create vs join) and role policy are decided during setup",
            );
            return;
        }

        await this.converge("boot");
    }

    /**
     * Converge the cluster from the PERSISTED participation. Called by the
     * setup flow as its final step, and again on boot for an already-set-up
     * node. Never throws — a failed convergence degrades the supervisors, it
     * does not crash the platform.
     */
    async converge(trigger: "boot" | "setup"): Promise<void> {
        try {
            const snapshot = await this.participation.converge();
            const node = snapshot.localNode;
            this.logger.log(
                `Swarm converged (${trigger}) — state=${snapshot.localNodeState}, role=${node.swarmRole}, ` +
                    `availability=${node.availability}, nodes=${String(snapshot.nodeCount)}, ` +
                    `managers=${String(snapshot.managerCount)}, master=${snapshot.master?.nodeId ?? "none"}`,
            );
            this.logger.log(
                `🐝 Swarm active (policy=${this.participation.effectiveConfig().policy}) — every supervised platform service + Deployer workload is scheduled on Swarm`,
            );
        } catch (error: unknown) {
            this.logger.warn(
                `Swarm convergence (${trigger}) skipped — engine is not in an active cluster: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}
