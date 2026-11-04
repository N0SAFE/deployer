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



import { ClusterNodeInventoryRepository, type ClusterNodeInventoryRepositoryShape } from "@deployer/node-state";
import { createModuleContext, effectHostProvider, serviceLifecycle } from "@deployer/nest-effect";
import { SwarmCluster, type SwarmClusterShape } from "@deployer/swarm";

import { DatabaseModule } from "../database/database.module";
import { DatabasePort } from "../database/storage";
import { MeshCoreModule } from "../mesh/mesh-core.module";
import { SystemMeshConfigService, type SystemMeshConfigServiceShape } from "../mesh/services/system-mesh-config.service";

import { GlobalClusterNodesRepository, makeGlobalClusterNodesRepository, type GlobalClusterNodesRepositoryShape } from "./repositories/global-cluster-nodes.repository";
import { makeNodeInventoryService, NodeInventoryService } from "./services/node-inventory.service";
import { SwarmCoreModule } from "./swarm.module";

import type { Context } from "effect";

export class SwarmInventoryModule extends createModuleContext({
    // SwarmCoreModule supplies SwarmClusterService (the `docker node ls` read
    // path). This direction is acyclic: SwarmCoreModule never imports this one.
    imports: [SwarmCoreModule, MeshCoreModule, DatabaseModule],
    providers: [
        effectHostProvider(),
        {
            provide: GlobalClusterNodesRepository,
            useFactory: (database: Context.Service.Shape<typeof DatabasePort>, meshConfig: SystemMeshConfigServiceShape) =>
                makeGlobalClusterNodesRepository({ database, meshConfig }),
            inject: [DatabasePort, SystemMeshConfigService],
        },
        {
            provide: NodeInventoryService,
            useFactory: (cluster: SwarmClusterShape, inventory: ClusterNodeInventoryRepositoryShape, globalClusterNodes: GlobalClusterNodesRepositoryShape) =>
                makeNodeInventoryService({ cluster, inventory, globalClusterNodes }),
            inject: [SwarmCluster, ClusterNodeInventoryRepository, GlobalClusterNodesRepository],
        },
        serviceLifecycle(NodeInventoryService),
    ],
    exports: [GlobalClusterNodesRepository, NodeInventoryService],
}) {}
