import { Global, Module, type DynamicModule } from "@nestjs/common";

import { NodeConfigRepository } from "./node-config.repository";
import { ClusterNodeRepository } from "./cluster-node.repository";
import { ClusterNodeInventoryRepository } from "./cluster-node-inventory.repository";

/**
 * NodesModule — the node-state repositories, each reading the LOCAL SQLite file.
 *
 * HOW TO USE IT
 *
 *   NodesModule.forRoot({ localDatabase: LocalDatabaseModule.forRootAsync({ ... }) })
 *
 * WHY `forRoot` TAKES THE DATABASE REGISTRATION AS A PARAMETER
 * The repositories inject `LocalDatabaseService`, so Nest must be able to
 * RESOLVE it from this module's scope. This module used to declare no imports at
 * all and rely on `LocalDatabaseModule` being registered globally elsewhere in
 * the app — which held in `apps/api` (one module there calls
 * `forRootAsync`) and failed in every other app. `apps/setup` was the first
 * consumer outside that arrangement and could not assemble its module graph:
 *
 *   Nest can't resolve dependencies of the NodeConfigRepository (?).
 *   Please make sure that the argument LocalDatabaseService at index [0] is
 *   available in the NodesModule module.
 *
 * Importing the bare `LocalDatabaseModule` class is NOT a fix: it is
 * `@Module({})`, so it provides nothing — only `forRoot`/`forRootAsync`
 * register the connection, and the nine existing `imports: [LocalDatabaseModule]`
 * sites in `apps/api` are no-ops that work purely because that one `forRootAsync`
 * makes the module `@Global()`.
 *
 * So the registration is passed IN, through `imports`, exactly as NestJS
 * intends. This keeps the file path and migrations directory the APP's decision
 * (they differ per app — `apps/api` and `apps/setup` ship different local
 * tables) while making the dependency explicit and the module self-contained for
 * any app that registers it.
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

/** What `NodesModule.forRoot` needs from the consuming app. */
export interface NodesModuleOptions {
    /**
     * The already-configured local-database registration.
     *
     * Pass `LocalDatabaseModule.forRoot(...)` / `.forRootAsync(...)` — the
     * DynamicModule, NOT the class. The app owns `databasePath` and
     * `migrationsDir` because they describe ITS local tables.
     */
    localDatabase: DynamicModule;
}

@Global()
@Module({})
export class NodesModule {
    static forRoot(options: NodesModuleOptions): DynamicModule {
        return {
            module: NodesModule,
            // The app's registration, forwarded verbatim. This is what brings
            // `LocalDatabaseService` into scope for the repositories below.
            imports: [options.localDatabase],
            providers: [
                NodeConfigRepository,
                ClusterNodeRepository,
                ClusterNodeInventoryRepository,
            ],
            exports: [
                NodeConfigRepository,
                ClusterNodeRepository,
                ClusterNodeInventoryRepository,
            ],
        };
    }
}
