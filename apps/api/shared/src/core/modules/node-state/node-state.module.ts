/**
 * NodeStateModule — the API's registration of the shared node-state repositories.
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
 * WHY IT DELEGATES TO THE PACKAGE'S `NodesModule.forRoot`
 * The providers themselves now live in `@repo/nest-nodes`, shared with
 * `apps/setup`. Their dependency on `LocalDatabaseService` is passed IN rather
 * than assumed: the package's module declares no imports of its own, so an app
 * that forgot to register a local database would get a boot error naming the
 * missing provider instead of a container that looks complete. Declaring the
 * repositories here as well would be a SECOND registration of the same classes
 * in one container — the duplication this delegation removes.
 *
 * REPOSITORIES KEPT AT THEIR EXISTING PATHS on purpose: 36 files import
 * `NodeConfigRepository`, so moving the file would churn them for no benefit.
 * The module boundary is what matters, not the directory.
 */

import { Global, Module } from "@nestjs/common";

import { NodesModule } from "@repo/nest-nodes/nodes.module";
import { localDatabaseRegistration } from "@/core/modules/database/local/local-database.module";

@Global()
@Module({
	imports: [
		// The API's own local-database registration (path + migrations), forwarded
		// to the package so its repositories can resolve `LocalDatabaseService`.
		//
		// The DynamicModule is passed, not the `LocalDatabaseModule` wrapper
		// class: only the REGISTRATION brings `LocalDatabaseService` into scope.
		NodesModule.forRoot({ localDatabase: localDatabaseRegistration() }),
	],
	exports: [NodesModule],
})
export class NodeStateModule {}
