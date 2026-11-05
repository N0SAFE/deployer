import { Effect } from 'effect'

import type { ServiceLifecycleShape } from '@deployer/nest-effect'

import type { Pool } from 'pg'

/**
 * The pool lifecycle — owns the teardown of the SHARED global
 * Postgres pool.
 *
 * WHY a dedicated provider: the pool is built by a DI factory and injected by
 * token, so no single class "owns" it. Without an explicit owner nothing closed
 * it at shutdown, and a `pg.Pool` with `min: 2` / `allowExitOnIdle: false`
 * keeps live sockets (and therefore a live event loop) until the process is
 * force-killed — the app could not exit cleanly on SIGTERM.
 *
 * TIMING: it runs at the context's teardown, after the work that used the pool; `pool.end()` drains the checked-out
 * clients instead of racing them.
 *
 * The module is `@Global`, so this runs for the main app AND for every sub-app
 * context (setup-wizard, mesh-initializer), which each build their own pool —
 * including the empty-URL placeholder pool created before the database URL is
 * known. All of them are released here.
 */
export function makeGlobalDatabasePoolLifecycle(
    pool: Pool | undefined
): ServiceLifecycleShape {
    return {
        onStop: () =>
            pool === undefined
                ? Effect.void
                : // `end()` drains in-flight queries and closes every idle client. Shutdown must never throw: a pool that
                  // refuses to close is reported and the process still exits (main.ts bounds the wait).
                  Effect.tryPromise(() => pool.end()).pipe(
                      Effect.andThen(
                          Effect.logInfo('🔌 Global Postgres pool closed')
                      ),
                      Effect.catch((error: unknown) =>
                          Effect.logWarning(
                              `Global Postgres pool close failed: ${error instanceof Error ? error.message : String(error)}`
                          )
                      )
                  ),
    }
}
