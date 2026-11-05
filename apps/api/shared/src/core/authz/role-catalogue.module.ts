import { Context, Effect } from 'effect'

import {
    createModuleContext,
    effectHostProvider,
    serviceLifecycle,
    type ServiceLifecycleShape,
} from '@deployer/nest-effect'

import { DatabasePort, storage } from '../modules/database/storage'

import { installRoleSnapshot } from './role-catalog'
import { loadRoleCatalogue } from './role-catalogue.loader'

/** How stale a permission snapshot may be before it is reloaded (`SEC-055`, ≤30 s). */
const REFRESH_INTERVAL_MS = 30_000

export type RoleCatalogueRefresherShape = ServiceLifecycleShape & {
    /** Read the catalogue now — the write path calls this so an edit is visible before the next tick. Never fails. */
    readonly refresh: () => Effect.Effect<void>
}

/**
 * Keeps this process's authorization snapshot in step with the `roles` table.
 *
 * Loaded once at boot — after the seed, in module order (`onReady`) — then every 30 s. A write that changes the catalogue
 * also refreshes directly in the service that owns it (see identity's `RoleService`), so a single replica sees an edit
 * immediately; the interval is what makes a SECOND replica catch up, and what bounds staleness if a `NOTIFY`-style push
 * is added later.
 *
 * A failed read keeps the previous snapshot: a database blip must not turn every permission check into a denial.
 */
export function makeRoleCatalogueRefresher(
    database: Context.Service.Shape<typeof DatabasePort>,
    options: { readonly refreshIntervalMs: number } = {
        refreshIntervalMs: REFRESH_INTERVAL_MS,
    }
): RoleCatalogueRefresherShape {
    const refresh: RoleCatalogueRefresherShape['refresh'] = () =>
        storage(database, (db) => loadRoleCatalogue(db)).pipe(
            Effect.map((catalogue) => {
                installRoleSnapshot(catalogue.epoch, catalogue.roles)
            }),
            Effect.catch((error) =>
                Effect.logWarning(
                    `role catalogue refresh failed, keeping the previous snapshot: ${error.cause instanceof Error ? error.cause.message : error.message}`
                )
            )
        )

    return {
        refresh,
        onReady: () => refresh(),
        // The runner owns the fiber and interrupts it at shutdown: a refresh never keeps the process alive.
        run: () =>
            Effect.forever(
                Effect.sleep(options.refreshIntervalMs).pipe(
                    Effect.andThen(refresh())
                )
            ),
    }
}

export class RoleCatalogueRefresher extends Context.Service<
    RoleCatalogueRefresher,
    RoleCatalogueRefresherShape
>()('shared/RoleCatalogueRefresher') {}

/**
 * The catalogue refresher, registered once per process.
 *
 * Imported by every service's root module: the authz gate (`SEC-062`) decides from this snapshot, so a service without
 * it would answer from the code table and refuse every CUSTOM role. The database is a global module, so importing this
 * one only adds the provider.
 */
export class RoleCatalogueModule extends createModuleContext({
    providers: [
        effectHostProvider(),
        {
            provide: RoleCatalogueRefresher,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeRoleCatalogueRefresher(database),
            inject: [DatabasePort],
        },
        serviceLifecycle(RoleCatalogueRefresher),
    ],
    exports: [RoleCatalogueRefresher],
}) {}
