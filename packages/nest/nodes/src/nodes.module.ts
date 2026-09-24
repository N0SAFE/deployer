import { Global, Module, type DynamicModule } from "@nestjs/common";

import { NodeConfigRepository } from "./node-config.repository";
import { ClusterNodeRepository } from "./cluster-node.repository";
import { ClusterNodeInventoryRepository } from "./cluster-node-inventory.repository";

/**
 * NodesModule — the node-state repositories, each reading the LOCAL SQLite file.
 *
 * HOW TO USE IT
 *
 *   NodesModule.forRoot()
 *
 * No options: these repositories are storage-only. They read `node_config`,
 * `cluster_node` and `cluster_nodes` from whatever `LOCAL_DATABASE_CONNECTION`
 * the app already registered — the CONNECTION's configuration (file path,
 * migrations) belongs to `@repo/nest-database-local`, so duplicating it here
 * would be a second source of truth for the same file.
 *
 * `forRoot()` still exists, rather than a bare module import, so the
 * registration call reads the same way as its siblings (`DockerModule.forRoot`,
 * `SwarmModule.forRoot`, …). A mixed vocabulary — some packages imported
 * directly and others configured — is what makes a wiring mistake hard to spot.
 *
 * WHY `@Global()`
 * Ten modules consume these repositories (mesh, swarm, setup, reachability, the
 * sub-apps, the CLI). Node state is the platform's pre-setup source of truth, so
 * it is read from everywhere and contains no configuration worth scoping.
 *
 * WHY THE REPOSITORIES LIVE HERE RATHER THAN IN THE `setup` FEATURE
 * They were once reachable only by importing the whole setup feature, which
 * closed a cycle: `MeshCoreModule → SetupModule → CoreInitializationModule →
 * SwarmCoreModule → MeshCoreModule`. The repositories themselves depend on
 * nothing but local storage, so extracting them is what lets `swarm`, `mesh` and
 * `setup` all read node state without importing each other.
 */
@Global()
@Module({})
export class NodesModule {
	static forRoot(): DynamicModule {
		return {
			module: NodesModule,
			providers: [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository],
			exports: [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository],
		};
	}
}
