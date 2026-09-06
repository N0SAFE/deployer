/**
 * CORE MODULE: Swarm
 *
 * Provides Swarm cluster services (bootstrap, cluster state, join tokens,
 * master election/leadership, API-driven platform stack). `DockerService`
 * comes from the @Global() `CoreDockerModule`; this module only wires the
 * platform-side cluster helpers. The swarm execution backend
 * (`runners/swarm`) builds on top of this.
 */

import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { SwarmLeadershipService } from "./election/swarm-leadership.service";
import { ClusterNodeInventoryRepository } from "./repositories/cluster-node-inventory.repository";
import { ClusterNodeRepository } from "./repositories/cluster-node.repository";
import { GlobalClusterNodesRepository } from "./repositories/global-cluster-nodes.repository";
import { SwarmBootstrapService } from "./services/swarm-bootstrap.service";
import { SwarmClusterService } from "./services/swarm-cluster.service";
import { NodeInventoryService } from "./services/node-inventory.service";
import { PlatformStackService } from "./services/platform-stack.service";

@Module({
    imports: [MeshCoreModule],
    providers: [
        SwarmClusterService,
        SwarmBootstrapService,
        ClusterNodeRepository,
        ClusterNodeInventoryRepository,
        GlobalClusterNodesRepository,
        SwarmLeadershipService,
        NodeInventoryService,
        PlatformStackService,
    ],
    exports: [SwarmClusterService, ClusterNodeRepository, ClusterNodeInventoryRepository],
})
export class SwarmCoreModule {}