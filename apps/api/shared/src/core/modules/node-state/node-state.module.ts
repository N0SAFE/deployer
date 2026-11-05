/**
 * NodeStateModule — the API's registration of the node-state repositories.
 *
 * `NodeConfigRepository` and the cluster-node repositories were reachable only by importing the whole
 * `SetupModule` (a feature module that also wires the wizard controller), which closed a cycle:
 *
 *     MeshCoreModule → SetupModule → CoreInitializationModule → SwarmCoreModule
 *                                                              → MeshCoreModule
 *
 * The repositories have no such dependency: they read the LOCAL SQLite database (`node_config`,
 * `cluster_node`, `cluster_nodes`), a file next to the API that exists from the first millisecond of
 * boot, before setup and before the global Postgres. So they live in their own `@Global()` module that
 * anyone can import without pulling in the setup feature: swarm, mesh and setup all consume node state
 * and none of them has to know about each other.
 *
 * The providers ARE the Effect repositories from `@deployer/node-state`, provided under the package's
 * own tags; callers inject the tag and run the Effect they need.
 */
import { createGlobalModule, effectHostProvider, serviceLifecycle } from "@deployer/nest-effect";
import {
	ClusterNodeInventoryRepository,
	ClusterNodeRepository,
	LocalDatabase,
	NodeConfigRepository,
	makeAgentFirstNodeConfigRepository,
	makeClusterNodeInventoryRepository,
	makeClusterNodeRepository,
	type LocalDatabaseShape,
} from "@deployer/node-state";

import { LocalDatabaseModule } from "../database/local/local-database.module";

import { agentNodeRecords } from "./agent-node-records";
import { NodeConfigSnapshot } from "./node-config.snapshot";

const repositories = [
	{
		provide: NodeConfigRepository,
		useFactory: (db: LocalDatabaseShape) => makeAgentFirstNodeConfigRepository(db, agentNodeRecords()),
		inject: [LocalDatabase],
	},
	{ provide: ClusterNodeRepository, useFactory: (db: LocalDatabaseShape) => makeClusterNodeRepository(db), inject: [LocalDatabase] },
	{
		provide: ClusterNodeInventoryRepository,
		useFactory: (db: LocalDatabaseShape) => makeClusterNodeInventoryRepository(db),
		inject: [LocalDatabase],
	},
	// Synchronous cache of the config row for the seams that cannot do I/O (the pg pool's per-connect
	// URL resolver, the global-db supervisor's synchronous config callbacks).
	NodeConfigSnapshot.provider,
	serviceLifecycle(NodeConfigSnapshot),
	effectHostProvider(),
];

export const NodeStateModule = createGlobalModule({
	imports: [LocalDatabaseModule],
	providers: repositories,
	exports: [NodeConfigRepository, NodeConfigSnapshot, ClusterNodeRepository, ClusterNodeInventoryRepository],
});
