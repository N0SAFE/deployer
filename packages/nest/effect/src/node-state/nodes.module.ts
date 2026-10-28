import { Global, Module, type DynamicModule } from "@nestjs/common";

import { ClusterNodeInventoryRepository, ClusterNodeRepository, NodeConfigRepository } from "./repositories";

export type NodesModuleOptions = {
	/** The app's `LocalDatabaseModule` registration, so the repositories can resolve the database host. */
	localDatabase: DynamicModule;
};

/** Mounts the node-state repositories over the app's local database registration. */
@Global()
@Module({})
export class NodesModule {
	static forRoot(options: NodesModuleOptions): DynamicModule {
		const repositories = [NodeConfigRepository, ClusterNodeRepository, ClusterNodeInventoryRepository];
		return { module: NodesModule, imports: [options.localDatabase], providers: repositories, exports: repositories };
	}
}
