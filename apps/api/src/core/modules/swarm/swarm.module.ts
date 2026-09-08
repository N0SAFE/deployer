/**
 * CORE MODULE: Swarm
 *
 * Provides Swarm cluster services (bootstrap, cluster state, join tokens,
 * master election/leadership). `DockerService` comes from the @Global()
 * `CoreDockerModule`; this module only wires the platform-side cluster
 * helpers. The swarm execution backend (`runners/swarm`) builds on top of
 * this and is responsible for scheduling DEPLOYER-OWNED workloads only
 * (user deployments/projects/services) — Deployer's own platform infra
 * (ingress, DB, Redis) is managed by supervisors / compose, never Swarm.
 */

import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { SwarmLeadershipService } from "./election/swarm-leadership.service";
import { ClusterNodeInventoryRepository } from "./repositories/cluster-node-inventory.repository";
import { ClusterNodeRepository } from "./repositories/cluster-node.repository";
import { GlobalClusterNodesRepository } from "./repositories/global-cluster-nodes.repository";
import { SwarmBootstrapService } from "./services/swarm-bootstrap.service";
import { SwarmClusterService } from "./services/swarm-cluster.service";
import { SwarmFleetService } from "./services/swarm-fleet.service";
import { NodeInventoryService } from "./services/node-inventory.service";

@Module({
    imports: [MeshCoreModule],
    providers: [
        SwarmClusterService,
        SwarmBootstrapService,
        SwarmFleetService,
        ClusterNodeRepository,
        ClusterNodeInventoryRepository,
        GlobalClusterNodesRepository,
        SwarmLeadershipService,
        NodeInventoryService,
    ],
    exports: [SwarmClusterService, SwarmFleetService, ClusterNodeRepository, ClusterNodeInventoryRepository],
})
export class SwarmCoreModule {}