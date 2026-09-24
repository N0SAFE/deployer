/**
 * NodeStateModule — the LOCAL node-state surface (SQLite only).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `NodeConfigRepository` and the cluster-node repositories were reachable only by
 * importing the whole **`SetupModule`** (a feature module that also wires the
 * wizard controller). That made every consumer of node state depend on the setup
 * FEATURE, which closed a cycle:
 *
 *     MeshCoreModule → SetupModule → CoreInitializationModule → SwarmCoreModule
 *                                                              → MeshCoreModule
 *
 * The repositories themselves have no such dependency: they read the LOCAL
 * SQLite database (`node_config`, `cluster_node`, `cluster_nodes`), which is a
 * file next to the API and exists from the first millisecond of boot — before
 * setup, before the global Postgres, before anything. So they belong in their own
 * @Global() module that ANYONE can import without pulling in the setup feature.
 *
 * This is the "provider that serves setup without dragging in things that
 * depend on setup" seam: swarm, mesh and setup all consume node state; none of
 * them has to know about each other.
 *
 * REPOSITORIES KEPT AT THEIR EXISTING PATHS on purpose: 36 files import
 * `NodeConfigRepository`, so moving the file would churn them for no benefit.
 * The module boundary is what matters, not the directory.
 */

import { Global, Module } from "@nestjs/common";

import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import { ClusterNodeRepository } from "@repo/nest-nodes/cluster-node.repository";
import { ClusterNodeInventoryRepository } from "@repo/nest-nodes/cluster-node-inventory.repository";

@Global()
@Module({
	imports: [LocalDatabaseModule],
	providers: [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository],
	exports: [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository],
})
export class NodeStateModule {}
