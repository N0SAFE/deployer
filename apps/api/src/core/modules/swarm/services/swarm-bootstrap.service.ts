/**
 * SwarmBootstrapService — converges the local engine into Swarm mode when the
 * main platform app boots (i.e. AFTER the setup gate has completed).
 *
 * Design (see docs/swarm-orchestration/01-single-node-unified-mode.md):
 * every node — including a single-node dev/prod host — converges to a real
 * Swarm cluster (`docker swarm init` for the first node, `swarm join` for
 * later ones), so the API runs ONE code path for every fleet size. This
 * service fires on `onApplicationBootstrap` of the main AppModule (which only
 * exists after setup), so the cluster bootstrap never interferes with the
 * first-run wizard.
 *
 * Failure is best-effort by design: a node without an engine in swarm mode
 * (edge/NAT, engine constraints) logs a warning and keeps the platform up —
 * the hard gate lives in executors (`SwarmClusterService.assertClusterReady`),
 * which the swarm runtime runner uses before deploying.
 */

import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { SwarmInitOptions } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.service";
import { ClusterNodeRepository } from "../repositories/cluster-node.repository";
import { PlatformStackService } from "./platform-stack.service";
import { SwarmClusterService } from "./swarm-cluster.service";

@Injectable()
export class SwarmBootstrapService implements OnApplicationBootstrap {
    private readonly logger = new Logger(SwarmBootstrapService.name);

    constructor(
        private readonly clusterService: SwarmClusterService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
        private readonly envService: EnvService,
        /** API-driven platform stack (SW-070/071): the API deploys its own
         *  ingress + overlay as swarm services — no CLI scripts. */
        private readonly platformStackService: PlatformStackService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        if (!this.envService.get("SWARM_ENABLED")) {
            this.logger.log("Swarm convergence disabled (SWARM_ENABLED=false) — supervisor mode");
            return;
        }

        const options: SwarmInitOptions = {};
        const advertiseAddr = this.envService.get("SWARM_ADVERTISE_ADDR");
        if (advertiseAddr) {
            options.AdvertiseAddr = advertiseAddr;
        }

        try {
            const snapshot = await this.clusterService.ensureCluster(options);
            const node = snapshot.localNode;
            this.logger.log(
                `Swarm converged — state=${snapshot.localNodeState}, role=${node.swarmRole}, ` +
                    `nodes=${String(snapshot.nodeCount)}, managers=${String(snapshot.managerCount)}, ` +
                    `master=${snapshot.master?.nodeId ?? "none"}`,
            );

            // SW-012/011: persist the node snapshot + join tokens (local SQLite,
            // never `.env`) so the cluster state survives restarts and tokens
            // are available for onboarding peers without env injection.
            try {
                const row = this.clusterNodeRepository.upsertFromSnapshot(snapshot);
                this.logger.log(`Cluster node state persisted (swarmRole=${row.swarmRole ?? "n/a"})`);
            } catch (persistError: unknown) {
                this.logger.warn(
                    `Cluster node state persistence skipped: ${
                        persistError instanceof Error ? persistError.message : String(persistError)
                    }`,
                );
            }

            // SW-070/071: deploy the platform's own swarm stack (traefik
            // ingress + overlay) through the SDK — the API owns swarm.
            try {
                await this.platformStackService.ensurePlatformStack();
            } catch (stackError: unknown) {
                this.logger.warn(
                    `Platform swarm stack ensure skipped: ${
                        stackError instanceof Error ? stackError.message : String(stackError)
                    }`,
                );
            }
        } catch (error: unknown) {
            // Best-effort: never crash platform boot because swarm is unavailable.
            this.logger.warn(
                `Swarm bootstrap skipped — engine is not in an active cluster: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}