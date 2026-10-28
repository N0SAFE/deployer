/**
 * The Nest host for `@deployer/node-state`: the local database module and the synchronous
 * repository faces the Nest callers inject. The behaviour is the Effect package's.
 */
export { LOCAL_DATABASE_OPTIONS_TOKEN, LocalDatabaseHost } from "./local-database.host";
export { LocalDatabaseModule } from "./local-database.module";
export type { LocalDatabaseModuleAsyncOptions, LocalDatabaseModuleOptions } from "./local-database.module";
export { LocalDatabaseService } from "./local-database.service";
export { NodesModule } from "./nodes.module";
export type { NodesModuleOptions } from "./nodes.module";
export { ClusterNodeInventoryRepository, ClusterNodeRepository, NodeConfigRepository } from "./repositories";
