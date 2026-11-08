/**
 * CORE MODULE: Local database — opens the node's SQLite file and provides the `@deployer/node-state`
 * `LocalDatabase` Effect service under its own tag.
 *
 * This module owns the CONFIGURATION: WHERE this app's file lives and WHERE its migration files live.
 * Both are the app's, not a package's: an earlier version derived the migrations directory from its
 * own file location, which resolved to a directory that did not exist once the module moved into a
 * package, and the app booted against an UNMIGRATED schema. The migrations create the tables
 * `@deployer/nest-schema/local` defines, so they ship with that package and this app imports the path.
 *
 * The opened handle is also provided under the two connection tokens consumers query through
 * (`LOCAL_DATABASE_CONNECTION` for Drizzle, `LOCAL_DATABASE_CLIENT` for the raw driver).
 */
import { Cause, Effect, Exit, Scope } from 'effect'

import {
    createGlobalModule,
    EffectHost,
    effectHostProvider,
    ServiceLifecycleRunner,
    type EffectHostShape,
    type ServiceLifecycleShape,
} from '@deployer/nest-effect'
import { LOCAL_MIGRATIONS_DIR } from '@deployer/nest-schema/migrations'
import {
    LocalDatabase,
    migrateLocalDatabase,
    openLocalDatabase,
    type LocalDatabaseOptions,
    type LocalDatabaseShape,
} from '@deployer/node-state'

import { EnvModule, EnvService } from '../../../../config/env/env.module'
import {
    LOCAL_DATABASE_CLIENT,
    LOCAL_DATABASE_CONNECTION,
} from '../database-connection'

const LOCAL_DATABASE_OPTIONS = 'LOCAL_DATABASE_OPTIONS' as const

/** Opening and migrating are synchronous Effects; this runs one and throws its original failure. */
const runUnwrapped = <A, E>(effect: Effect.Effect<A, E>): A => {
    const exit = Effect.runSyncExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

/**
 * Ties the Effect `LocalDatabase` to this Nest context: each context opens its OWN handle (the API runs several contexts in
 * one process), so each closes the one it opened. The connection is opened when the host is built so providers can inject
 * the Drizzle handle; the schema is migrated at `onModuleInit`, after the graph resolves and before any consumer's own init hook,
 * and closed at `onModuleDestroy`, so no repository can still be using it.
 */
export type LocalDatabaseHost = ServiceLifecycleShape & {
    readonly database: LocalDatabaseShape
}

export function makeLocalDatabaseHost(
    options: LocalDatabaseOptions
): LocalDatabaseHost {
    const scope = Effect.runSync(Scope.make())
    const database = runUnwrapped(
        openLocalDatabase(options).pipe(Scope.provide(scope))
    )

    return {
        database,
        onModuleInit: () => migrateLocalDatabase(database, options.migrationsDir),
        onModuleDestroy: () =>
            Scope.close(scope, Exit.void).pipe(
                Effect.catchCause((cause) =>
                    Effect.logWarning(
                        `Local SQLite close failed: ${Cause.pretty(cause)}`
                    )
                )
            ),
    }
}

/** The host, as a provider token: the connection tokens below read it, and its lifecycle runner drives migrate/close. */
const LOCAL_DATABASE_HOST = Symbol.for('shared/LocalDatabaseHost')

export const LocalDatabaseModule = createGlobalModule({
    imports: [EnvModule],
    providers: [
        {
            provide: LOCAL_DATABASE_OPTIONS,
            useFactory: (env: EnvService): LocalDatabaseOptions => ({
                databasePath: env.get('NODE_LOCAL_DB_PATH'),
                migrationsDir: LOCAL_MIGRATIONS_DIR,
            }),
            inject: [EnvService],
        },
        effectHostProvider(),
        {
            provide: LOCAL_DATABASE_HOST,
            useFactory: (options: LocalDatabaseOptions) =>
                makeLocalDatabaseHost(options),
            inject: [LOCAL_DATABASE_OPTIONS],
        },
        {
            provide: Symbol.for('shared/LocalDatabaseLifecycle'),
            useFactory: (
                host: LocalDatabaseHost,
                effectHost: EffectHostShape
            ) => new ServiceLifecycleRunner('LocalDatabase', host, effectHost),
            inject: [LOCAL_DATABASE_HOST, EffectHost],
        },
        {
            provide: LocalDatabase,
            useFactory: (host: LocalDatabaseHost) => host.database,
            inject: [LOCAL_DATABASE_HOST],
        },
        {
            provide: LOCAL_DATABASE_CLIENT,
            useFactory: (host: LocalDatabaseHost) => host.database.client,
            inject: [LOCAL_DATABASE_HOST],
        },
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: (host: LocalDatabaseHost) => host.database.db,
            inject: [LOCAL_DATABASE_HOST],
        },
    ],
    exports: [LocalDatabase, LOCAL_DATABASE_CLIENT, LOCAL_DATABASE_CONNECTION],
})
