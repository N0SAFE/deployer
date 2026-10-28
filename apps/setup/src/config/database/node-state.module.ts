/**
 * The setup app's registration of the node-state repositories: the `@deployer/node-state` Effect
 * repositories over the local database, provided under the package's own tags.
 */
import { Global, Module } from "@nestjs/common";
import {
	ClusterNodeInventoryRepository,
	ClusterNodeRepository,
	LocalDatabase,
	NodeConfigRepository,
	makeClusterNodeInventoryRepository,
	makeClusterNodeRepository,
	makeNodeConfigRepository,
	type LocalDatabaseShape,
} from "@deployer/node-state";

import { LocalDatabaseModule } from "@/config/database/local-database.module";

const repositories = [
	{ provide: NodeConfigRepository, useFactory: (db: LocalDatabaseShape) => makeNodeConfigRepository(db), inject: [LocalDatabase] },
	{ provide: ClusterNodeRepository, useFactory: (db: LocalDatabaseShape) => makeClusterNodeRepository(db), inject: [LocalDatabase] },
	{
		provide: ClusterNodeInventoryRepository,
		useFactory: (db: LocalDatabaseShape) => makeClusterNodeInventoryRepository(db),
		inject: [LocalDatabase],
	},
];

@Global()
@Module({
	imports: [LocalDatabaseModule],
	providers: repositories,
	exports: [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository],
})
export class NodeStateModule {}
