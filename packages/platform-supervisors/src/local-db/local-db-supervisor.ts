/**
 * Supervises the local SQLite database.
 *
 * The local SQLite database (node_config, node_mesh_config, local_migrations) is the node's own state
 * store, always managed by the API process itself. It is NOT a docker resource: the file and its schema
 * are initialized at module boot, so convergence only proves the handle is usable, and the probe
 * measures the real database:
 *   - `SELECT 1` latency (primary liveness of the engine),
 *   - table inventory (`sqlite_master`) with count,
 *   - journal mode (WAL expected),
 *   - file size on disk and database size from the page counts,
 *   - applied migration count (`local_migrations`).
 *
 * Unlike the global DB (managed vs external), the local DB is unconditionally managed by this process,
 * so the supervisor is always registered, unless the deployment owns the file (the host decides).
 */
import { stat } from 'node:fs/promises'

import { Effect } from 'effect'

import type { SupervisorSpec } from '@deployer/supervision'

import {
    LOCAL_DB_SUPERVISOR_ID,
    localDbProcessInfoSchema,
    localDbSupervisorPayloadSchema,
    type LocalDbSupervisorPayload,
} from './schemas'

/** The one SQLite handle the supervisor reads. The driver is the host's; this is what it needs of it. */
export type LocalSqlite = {
    /** `SELECT 1`: liveness of the engine. Fails when the handle is unusable. */
    readonly ping: Effect.Effect<void, unknown>
    /** Runs a read query and returns every row. */
    readonly all: (sql: string) => Effect.Effect<readonly unknown[], unknown>
    /** Runs a read query and returns its first row. */
    readonly get: (sql: string) => Effect.Effect<unknown, unknown>
}

export type LocalDbDeps = { readonly sqlite: LocalSqlite }

export type LocalDbSupervisor = {
    readonly spec: SupervisorSpec<
        typeof localDbSupervisorPayloadSchema,
        typeof localDbProcessInfoSchema
    >
}

type Measurements = Omit<LocalDbSupervisorPayload, 'checkedAt' | 'latencyMs'>

const UNKNOWN: Measurements = {
    dbPath: 'unknown',
    journalMode: 'unknown',
    tableCount: 0,
    tables: [],
    migrationsApplied: 0,
    fileSizeBytes: null,
    databaseSizeBytes: 0,
}

const field = (row: unknown, key: string): unknown =>
    typeof row === 'object' && row !== null
        ? (row as Record<string, unknown>)[key]
        : undefined

export function makeLocalDbSupervisor({
    sqlite,
}: LocalDbDeps): LocalDbSupervisor {
    /** A measurement that cannot be taken keeps its fallback: the probe reports what it could read. */
    const attempt = <A>(
        effect: Effect.Effect<A, unknown>,
        fallback: A
    ): Effect.Effect<A> => effect.pipe(Effect.orElseSucceed(() => fallback))

    /** The real on-disk and engine measurements of the file, shared by the probe and the process info. */
    const measure: Effect.Effect<Measurements, unknown> = Effect.gen(
        function* () {
            // The real path comes from sqlite itself (works for file and :memory: databases).
            const dbPath = yield* attempt(
                sqlite.all('PRAGMA database_list').pipe(
                    Effect.map((rows) => {
                        const file = field(rows[0], 'file')
                        return typeof file === 'string' && file !== ''
                            ? file
                            : 'unknown'
                    })
                ),
                'unknown'
            )
            const journalMode = yield* attempt(
                sqlite.get('PRAGMA journal_mode').pipe(
                    Effect.map((row) => {
                        const mode = field(row, 'journal_mode')
                        return typeof mode === 'string' ? mode : 'unknown'
                    })
                ),
                'unknown'
            )
            const databaseSizeBytes = yield* attempt(
                Effect.all([
                    sqlite.get('PRAGMA page_count'),
                    sqlite.get('PRAGMA page_size'),
                ]).pipe(
                    Effect.map(
                        ([count, size]) =>
                            Number(field(count, 'page_count') ?? 0) *
                            Number(field(size, 'page_size') ?? 0)
                    )
                ),
                0
            )
            const fileSizeBytes = yield* Effect.tryPromise(
                async () => (await stat(dbPath)).size
            ).pipe(Effect.orElseSucceed(() => null))

            const tables = (yield* sqlite.all(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )).map((row) => field(row, 'name') as string)
            const migrationsApplied = yield* attempt(
                sqlite
                    .get('SELECT COUNT(*) AS count FROM local_migrations')
                    .pipe(
                        Effect.map((row) => Number(field(row, 'count') ?? 0))
                    ),
                0
            )

            return {
                dbPath,
                journalMode,
                tableCount: tables.length,
                tables,
                migrationsApplied,
                fileSizeBytes,
                databaseSizeBytes,
            }
        }
    )

    const spec: LocalDbSupervisor['spec'] = {
        id: LOCAL_DB_SUPERVISOR_ID,
        description:
            'Local SQLite node database (node_config, mesh config, migrations)',
        payloadSchema: localDbSupervisorPayloadSchema,
        processInfoSchema: localDbProcessInfoSchema,
        // The connection factory opened the file and the migration service migrated it, both during module
        // init and before this runs. A failed open would have thrown there, so convergence only proves
        // the handle is usable.
        converge: sqlite.ping,
        probe: Effect.gen(function* () {
            const startedAt = Date.now()
            const alive = yield* sqlite.ping.pipe(
                Effect.as(null),
                Effect.catch((error) =>
                    Effect.succeed(
                        error instanceof Error ? error.message : String(error)
                    )
                )
            )
            if (alive !== null) {
                return {
                    healthy: false,
                    detail: `SELECT 1 failed: ${alive}`,
                    payload: {
                        checkedAt: new Date().toISOString(),
                        latencyMs: Date.now() - startedAt,
                        ...UNKNOWN,
                    },
                }
            }
            const measurements = yield* measure
            return {
                healthy: true,
                detail: `local sqlite at ${measurements.dbPath} (${String(measurements.tables.length)} tables, ${String(measurements.migrationsApplied)} migrations, journal=${measurements.journalMode})`,
                payload: {
                    checkedAt: new Date().toISOString(),
                    latencyMs: Date.now() - startedAt,
                    ...measurements,
                },
            }
        }),
        degradedPayload: () => ({
            checkedAt: new Date().toISOString(),
            latencyMs: 0,
            ...UNKNOWN,
        }),
        processInfo: measure.pipe(
            Effect.map((measurements) => ({
                process: {
                    kind: 'sqlite' as const,
                    dbPath: measurements.dbPath,
                    journalMode: measurements.journalMode,
                    tableCount: measurements.tableCount,
                    migrationsApplied: measurements.migrationsApplied,
                    fileSizeBytes: measurements.fileSizeBytes,
                },
            }))
        ),
    }

    return { spec }
}
