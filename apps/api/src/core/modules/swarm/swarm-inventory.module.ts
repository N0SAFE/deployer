/**
 * SwarmInventoryModule — the POST-SETUP half of the swarm tree.
 *
 * It holds the only swarm providers that need a resource which does not exist
 * until setup has run:
 *
 *   - `GlobalClusterNodesRepository` → `GlobalDatabaseService` (global Postgres)
 *     and `SystemMeshConfigService` (mesh). This is the single reason the swarm
 *     tree ever referenced the mesh module.
 *   - `NodeInventoryService` → the repository above, plus the local-SQLite
 *     inventory. It is the periodic `docker node ls` sweep that keeps
 *     `cluster_nodes` fresh and enrolls this node into the SHARED
 *     `cluster_nodes` table.
 *
 * LOAD IT AFTER SETUP. Keeping it out of `SwarmCoreModule` is what lets the
 * setup wizard use the swarm primitives (create/join, participation, fleet
 * read-models) before a global database exists — and it removes the
 * `swarm → mesh` edge that closed the former module cycle.
 *
 * Importing `MeshCoreModule` here is safe: `MeshCoreModule` no longer imports
 * `SetupModule` (it takes `NodeStateModule` instead), so there is no path back.
 */

import { Module } from "@nestjs/common";

import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { SwarmCoreModule } from "./swarm.module";
import { GlobalClusterNodesRepository } from "./repositories/global-cluster-nodes.repository";
import { NodeInventoryService } from "./services/node-inventory.service";

@Module({
    // SwarmCoreModule supplies SwarmClusterService (the `docker node ls` read
    // path). This direction is acyclic: SwarmCoreModule never imports this one.
    imports: [SwarmCoreModule, MeshCoreModule],
    providers: [GlobalClusterNodesRepository, NodeInventoryService],
    exports: [GlobalClusterNodesRepository, NodeInventoryService],
})
export class SwarmInventoryModule {}
