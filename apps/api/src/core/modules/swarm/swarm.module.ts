/**
 * CORE MODULE: Swarm (setup-safe)
 *
 * Provides the Swarm cluster primitives — bootstrap, cluster state, join
 * tokens, master election/leadership, fleet read-models — and NOTHING that
 * needs a post-setup resource. Every provider here is constructible BEFORE the
 * global Postgres exists, which is what lets the SETUP WIZARD drive swarm
 * convergence instead of depending on work that can only happen after setup.
 *
 * DEPENDENCIES (deliberately narrow)
 * ----------------------------------
 *   - `CoreDockerModule` (@Global) → DockerService (the engine client).
 *   - `NodeStateModule` (@Global)  → NodeConfigRepository + cluster-node repos,
 *                                    which read LOCAL SQLite (a file that
 *                                    exists from the first millisecond).
 *
 * It does NOT import `MeshCoreModule`. The only thing the swarm tree ever
 * needed from mesh was `SystemMeshConfigService`, and its sole consumer was
 * `GlobalClusterNodesRepository` — which needs the GLOBAL POSTGRES and so lives
 * in `SwarmInventoryModule` (loaded after setup). Removing that edge is what
 * breaks the former cycle:
 *
 *     MeshCoreModule → SetupModule → CoreInitializationModule → SwarmCoreModule
 *                                                              → MeshCoreModule
 *
 * The swarm execution backend (`runners/swarm`) builds on top of this and
 * schedules DEPLOYER-OWNED workloads; Deployer's own platform infra is
 * scheduled by the platform supervisors.
 */

import { Module } from "@nestjs/common";
import { NodeStateModule } from "@/core/modules/node-state/node-state.module";
import { SwarmLeadershipService } from "./election/swarm-leadership.service";
import { SwarmBootstrapService } from "./services/swarm-bootstrap.service";
import { SwarmClusterService } from "./services/swarm-cluster.service";
import { SwarmJoinGrantService } from "./services/swarm-join-grant.service";
import { SwarmParticipationService } from "./services/swarm-participation.service";
import { SwarmFleetService } from "./services/swarm-fleet.service";

@Module({
    // NodeStateModule supplies NodeConfigRepository + ClusterNodeRepository
    // (pure LOCAL SQLite reads — available before setup and before any global
    // Postgres, which is why the swarm core is setup-safe).
    imports: [NodeStateModule],
    providers: [
        SwarmClusterService,
        SwarmBootstrapService,
        SwarmParticipationService,
        SwarmJoinGrantService,
        SwarmFleetService,
        SwarmLeadershipService,
    ],
    exports: [
        SwarmClusterService,
        SwarmBootstrapService,
        SwarmParticipationService,
        SwarmJoinGrantService,
        SwarmFleetService,
        SwarmLeadershipService,
    ],
})
export class SwarmCoreModule {}