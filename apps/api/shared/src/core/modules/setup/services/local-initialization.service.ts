import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import * as PgDrizzle from 'drizzle-orm/effect-postgres'
import { migrate } from 'drizzle-orm/effect-postgres/migrator'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { layer as pgClientLayer, PgClient as PgClientTag } from '@effect/sql-pg/PgClient'
import type { PgClient } from '@effect/sql-pg/PgClient'
import {
    Clock,
    Config,
    Context,
    Data,
    DateTime,
    Effect,
    Layer,
    Option,
    Ref,
    Schedule,
} from 'effect'
import { Pool } from 'pg'

import { provisionUserAccount } from '@deployer/auth/server'
import type { SetupInitializeLocalInput } from '@deployer/contracts-entities'
import {
    MANAGED_POSTGRES_ALIAS,
    MANAGED_POSTGRES_PORT,
    MANAGED_POSTGRES_VOLUME_NAME,
    managedPostgresServiceName,
    platformNetworkName,
} from '@deployer/docker'
import type {
    DockerEngineShape,
    PostgresProvisionerShape,
} from '@deployer/docker'
import { splitManagedEnv } from '@deployer/env'
import { AppError, ConflictError } from '@deployer/errors'
import { GLOBAL_MIGRATIONS_DIR } from '@deployer/nest-schema'
import * as globalSchema from '@deployer/nest-schema/global'
import { globalRelations } from '../../database/global/global-database.service'
import type { Logger as DrizzleLogger } from 'drizzle-orm/logger'
import { user } from '@deployer/nest-schema/global/identity/auth'
import {
    NodeConfigRepository,
} from '@deployer/node-state'
import {
    SupervisorOrchestrator,
} from '@deployer/supervision'
import {
    SwarmBootstrap,
    SwarmCluster,
    SwarmParticipation,
} from '@deployer/swarm'

import {
    createBetterAuth,
    provisioningSecret,
} from '../../../../config/auth/auth'
import { DEPLOYER_VERSION } from '../../../utils/deployer-version'
import { resolvePostgresIdentity } from '../../docker/containers/postgres/postgres-identity'
import { SWARM_APP_WIRING_SUPERVISOR_ID } from '../../supervisors/platform/swarm-app-wiring.supervisor'
import { SetupInitializationFailed } from '../setup.errors'
import {
    SetupStepTracker,
    listMigrationNames,
    redactUrl,
    runStepEffect as runStep,
    type EmitEvent,
} from '../utils/setup-runner.utils'

import { ApiEnvironment, EnvService } from '../../../../config/env/env.module'
import * as Redacted from 'effect/Redacted'
import type { SqlError } from 'effect/sql/SqlError'
import { DockerEngine, PostgresProvisioner } from '@deployer/docker'

// ── WHY THE PACKAGE CONSTANT AND NOT A RELATIVE PATH ───────────────────────
// `GLOBAL_MIGRATIONS_DIR` is resolved by the schema package that owns the
// migrations, so the path cannot drift when a caller moves (a relative
// `../../../..` count once pointed at a directory that no longer existed and
// surfaced as a misleading "Can't find meta/_journal.json").

// ─── Errors ──────────────────────────────────────────────────────────────────

/** A pg / drizzle call failed (probe, query, CREATE DATABASE, migrate…). */
export class PostgresOperationError extends Data.TaggedError(
    'PostgresOperationError'
)<{
    readonly operation: string
    readonly message: string
    readonly cause: unknown
}> {}

/** Postgres never accepted a connection within the retry budget. */
export class PostgresNotReadyError extends Data.TaggedError(
    'PostgresNotReadyError'
)<{
    readonly attempts: number
    readonly message: string
    readonly cause: unknown
}> {}

/** Reading the migration folder failed. */
export class MigrationFolderError extends Data.TaggedError(
    'MigrationFolderError'
)<{
    readonly folder: string
    readonly message: string
    readonly cause: unknown
}> {}

/** Seeding the initial admin failed. */
export class SeedFailedError extends Data.TaggedError('SeedFailedError')<{
    readonly stage: string
    readonly message: string
    readonly cause: unknown
}> {}

const messageOf = (cause: unknown): string =>
    cause instanceof Error ? cause.message : String(cause)

// ─── Types ───────────────────────────────────────────────────────────────────

/** A step log line is an effect, so it composes in the same pipeline as the work. */
export type StepLog = (message: string) => Effect.Effect<void>

/**
 * What one run resolves from the container.
 *
 * These are YIELDED, not constructed: the flow runs on the app runtime, so each collaborator comes
 * from the module that registered it — the same way a handler reaches its services.
 */
export type LocalInitializationPorts =
    | PostgresProvisioner
    | DockerEngine
    | ApiEnvironment
    | NodeConfigRepository
    | SwarmBootstrap
    | SwarmParticipation
    | SwarmCluster
    | SupervisorOrchestrator

export type LocalInitializationServiceShape = {
    /**
     * Run the full local bootstrap flow. Succeeds with the final `nodeId` and `databaseUrl` so the
     * orchestration layer can emit the terminal `completed` event; any step failure is a
     * `SetupInitializationFailed` carrying the step's message.
     */
    readonly initialize: (
        input: SetupInitializeLocalInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ) => Effect.Effect<
        { nodeId: string; databaseUrl: string },
        SetupInitializationFailed,
        LocalInitializationPorts
    >
}

/** The heavy steps, overridable so a spec can short-circuit them (they open real connections). */
export type LocalInitializationSteps = {
    readonly probeExistingDatabase: (
        databaseUrl: string,
        log: StepLog
    ) => Effect.Effect<string, unknown>
    readonly provisionDockerDatabase: (
        log: StepLog,
        deploymentOwnsEverything: boolean
    ) => Effect.Effect<string, unknown, LocalInitializationPorts>
    readonly ensureDatabaseEmpty: (
        databaseUrl: string
    ) => Effect.Effect<ReadonlyArray<string>, unknown>
    readonly runMigrations: (
        databaseUrl: string,
        migrationsFolder: string,
        log: StepLog
    ) => Effect.Effect<void, unknown>
    readonly seedInitialData: (
        databaseUrl: string,
        input: SetupInitializeLocalInput,
        log: StepLog
    ) => Effect.Effect<{ userId: string }, unknown>
}

/** The only per-instance configuration: the step overrides a spec injects. */
export type LocalInitializationOptions = {
    readonly steps?: Partial<LocalInitializationSteps>
}

/** The env var set by globalSetup (e2e) pointing at a shared Postgres. */
const SHARED_PG_ENV = 'E2E_SHARED_POSTGRES_CONNECTION_URI'

// ─── Generic Effect helpers ──────────────────────────────────────────────────

/** Emit several log lines, in order. */
const logLines = (log: StepLog, lines: ReadonlyArray<string>) =>
    Effect.forEach(lines, log, { discard: true })

/** Optional env var as `string | undefined`, read through `Config` instead of `process.env`. */
const optionalEnv = (name: string) =>
    Config.option(Config.String(name)).pipe(Effect.map(Option.getOrUndefined))

/**
 * A database session whose lifetime is bound to `use`.
 *
 * The pool, the connection and the teardown belong to the Effect runtime: `pgClientLayer` opens it
 * and `Effect.scoped` closes it — success, failure or interruption. Nothing calls `pool.end()`.
 */
const withPg = <A, E>(
    url: string,
    use: (sql: PgClient) => Effect.Effect<A, E>
): Effect.Effect<A, E | SqlError> =>
    Effect.scoped(
        Effect.gen(function* () {
            const sql = yield* PgClientTag
            return yield* use(sql)
        }).pipe(Effect.provide(pgClientLayer({ url: Redacted.make(url) })))
    )

/**
 * A typed query through the Effect driver. `sql` is `@effect/sql`'s client, so a statement IS an
 * Effect returning the rows — no Promise boundary, no `tryPromise`, no `.rows` unwrapping.
 */
const query = <T extends object = Record<string, unknown>>(
    sql: PgClient,
    statement: string,
    operation = 'query'
) =>
    sql.unsafe<T>(statement).pipe(
        Effect.mapError(
            (cause: SqlError) =>
                new PostgresOperationError({
                    operation,
                    message: messageOf(cause),
                    cause,
                })
        )
    )

/** The Drizzle query builder bound to the caller's own `PgClient` — no second pool. */
const effectDatabase = (sql: PgClient) =>
    PgDrizzle
        .makeWithDefaults({ relations: globalRelations })
        .pipe(Effect.provideService(PgClientTag, sql))

/**
 * A Promise-facing Drizzle handle. NOT a fallback: better-auth's drizzle adapter `await`s every
 * builder, and an Effect is not a Promise, so the ONE consumer that needs it is the auth instance
 * the seed provisions the super-admin through. Nothing else in this file uses it.
 */
const withPromiseDatabase = <A, E>(
    url: string,
    use: (db: NodePgDatabase) => Effect.Effect<A, E>
): Effect.Effect<A, E> =>
    Effect.acquireUseRelease(
        Effect.sync(() => new Pool({ connectionString: url, max: 1 })),
        (pool) =>
            use(
                drizzleNodePg({
                    client: pool,
                    relations: globalRelations,
                }) as unknown as NodePgDatabase
            ),
        (pool) => Effect.promise(() => pool.end().then(() => undefined))
    )

/** Collapse blank runs, indent each line — one SQL statement as a log block. */
const formatStatement = (sql: string): string =>
    sql
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .filter(
            (line, idx, arr) =>
                !(line === '' && (idx === 0 || arr[idx - 1] === ''))
        )
        .map((line) => (line.length > 0 ? `    ${line}` : line))
        .join('\n')

const buildAdminDatabaseUrl = (connectionUri: string) =>
    Effect.try({
        try: () => {
            const parsed = new URL(connectionUri)
            if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
            parsed.pathname = '/postgres'
            return parsed.toString()
        },
        catch: (cause) =>
            new PostgresOperationError({
                operation: 'parse-shared-uri',
                message: messageOf(cause),
                cause,
            }),
    })

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * The one implementation of `LocalInitializationServiceShape`.
 *
 * A NAMED class: this package emits declarations, and TS4094 forbids private members on an
 * anonymous exported class whose type is exported.
 *
 * Every collaborator is YIELDED per run, so the service has no constructor ports — only the step
 * overrides a spec injects, which are genuine per-instance configuration.
 */
class LocalInitializationServiceImpl implements LocalInitializationServiceShape {
    private readonly overrides: Partial<LocalInitializationSteps>

    constructor(options: LocalInitializationOptions = {}) {
        this.overrides = options.steps ?? {}
    }

    // ─── The steps, overridden or not ────────────────────────────────────────

    private makeSteps(): LocalInitializationSteps {
        return {
            probeExistingDatabase:
                this.overrides.probeExistingDatabase ??
                this.probeExistingDatabase,
            provisionDockerDatabase:
                this.overrides.provisionDockerDatabase ??
                this.provisionDockerDatabase,
            ensureDatabaseEmpty:
                this.overrides.ensureDatabaseEmpty ?? this.ensureDatabaseEmpty,
            runMigrations:
                this.overrides.runMigrations ?? this.runMigrations,
            seedInitialData:
                this.overrides.seedInitialData ?? this.seedInitialData,
        }
    }

    // ─── Database helpers, one per heavy step ────────────────────────────────

    private readonly probeExistingDatabase: (
        databaseUrl: string,
        log: StepLog
    ) => Effect.Effect<string, unknown> = Effect.fn('probeExistingDatabase')(
        function* (databaseUrl: string, log: StepLog) {
            const t0 = yield* Clock.currentTimeMillis
            yield* withPg(databaseUrl, (sql) =>
                Effect.gen(function* () {
                    yield* log('dispatching SELECT 1 …')
                    yield* query(sql, 'SELECT 1', 'probe')
                })
            )
            const t1 = yield* Clock.currentTimeMillis
            yield* log(`reply received in ${String(t1 - t0)} ms`)
            return databaseUrl
        }
    )

    /**
     * Retry `SELECT 1` with a linear back-off (1s, 2s, 3s…) up to 30 attempts. A fresh pool per
     * attempt; "does not exist" is permanent and stops the retries immediately.
     */
    private readonly waitForPostgres: (
        connectionString: string,
        log?: StepLog
    ) => Effect.Effect<void, PostgresNotReadyError> = Effect.fn(
        'waitForPostgres'
    )(function* (
        connectionString: string,
        log?: StepLog
    ) {
        const maxRetries = 30
        const attempts = yield* Ref.make(0)

        yield* withPg(connectionString, (sql) =>
            query(sql, 'SELECT 1', 'wait-for-postgres')
        ).pipe(
            Effect.tapError((error) =>
                Ref.updateAndGet(attempts, (n) => n + 1).pipe(
                    Effect.flatMap((attempt) => {
                        const msg = `Postgres not ready (attempt ${String(attempt)}/${String(maxRetries)}): ${error.message}`
                        return Effect.logDebug(msg).pipe(
                            Effect.andThen(log ? log(msg) : Effect.void)
                        )
                    })
                )
            ),
            Effect.retry({
                // `Schedule.linear` does not exist in effect 4 — a fixed 1s cadence is the closest
                // supported ramp and is what the retry needs (the budget, not the curve, is the point).
                schedule: Schedule.spaced('1 second'),
                times: maxRetries - 1,
                while: (error) => !error.message.includes('does not exist'),
            }),
            Effect.catch((error) =>
                Ref.get(attempts).pipe(
                    Effect.flatMap((n) =>
                        Effect.fail(
                            new PostgresNotReadyError({
                                attempts: n,
                                message: error.message,
                                cause: error,
                            })
                        )
                    )
                )
            )
        )
    })

    private readonly ensureDatabaseEmpty: (
        databaseUrl: string
    ) => Effect.Effect<ReadonlyArray<string>, unknown> = Effect.fn(
        'ensureDatabaseEmpty'
    )(
        function* (databaseUrl: string) {
            const tables = yield* withPg(databaseUrl, (sql) =>
                query<{ table_name: string }>(
                    sql,
                    `SELECT table_name FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE';`,
                    'list-tables'
                ).pipe(Effect.map((rows) => rows.map((row) => row.table_name)))
            )

            if (tables.length === 0) return tables

            // Tables exist: with migration tracking this is a container reuse (let the flow proceed);
            // without it, it is a leftover database and must be blocked.
            const hasMigrations =
                tables.includes('__drizzle_migrations') ||
                tables.includes('schema_version')

            if (!hasMigrations) {
                return yield* Effect.fail(
                    new ConflictError(
                        `Database is not empty. Found tables: ${tables.join(', ')}`
                    )
                )
            }

            yield* Effect.logInfo(
                `Database already initialized (${String(tables.length)} tables found) — skipping fresh setup`
            )
            return tables
        }
    )

    private readonly runMigrations: (
        databaseUrl: string,
        migrationsFolder: string,
        log: StepLog
    ) => Effect.Effect<void, unknown> = Effect.fn('runMigrations')(function* (
        databaseUrl: string,
        migrationsFolder: string,
        log: StepLog
    ) {
        // Drizzle's logger is SYNCHRONOUS, so it cannot yield. Collecting the statements into a plain
        // array keeps the bridge side-effect-free: the array is flushed through `log` afterwards.
        const statements: string[] = []
        const migrationLogger: DrizzleLogger = {
            logQuery: (sql: string, params: unknown[]) => {
                statements.push(
                    params.length > 0
                        ? `${formatStatement(sql)}\n    -- params: ${JSON.stringify(params)}`
                        : formatStatement(sql)
                )
            },
        }

        yield* withPg(databaseUrl, (sql) =>
            Effect.gen(function* () {
                yield* log('acquiring connection')
                yield* query(sql, 'SELECT 1', 'migration-probe')
                yield* log('acquired — handing off to drizzle migrator')

                const db = yield* PgDrizzle
                    .make({ relations: globalRelations })
                    .pipe(
                        Effect.provide(
                            Layer.mergeAll(
                                PgDrizzle.DefaultServices,
                                Layer.succeed(PgClientTag, sql),
                                PgDrizzle.EffectLogger.layerFromDrizzle(
                                    migrationLogger
                                )
                            )
                        )
                    )

                const t0 = yield* Clock.currentTimeMillis
                yield* migrate(db, { migrationsFolder }).pipe(
                    Effect.mapError(
                        (cause) =>
                            new PostgresOperationError({
                                operation: 'migrate',
                                message: messageOf(cause),
                                cause,
                            })
                    )
                )
                const t1 = yield* Clock.currentTimeMillis

                yield* Effect.forEach(statements, log, { discard: true })
                yield* log(
                    `drizzle migrator returned in ${String(t1 - t0)} ms`
                )
            })
        )
    })

    private provisionDatabaseNamespace(
        sharedUri: string,
        log: StepLog
    ): Effect.Effect<string, unknown> {
        const self = this
        return Effect.fn('provisionDatabaseNamespace')(function* () {
            const adminUrl = yield* buildAdminDatabaseUrl(sharedUri)
            const suffix = yield* Effect.sync(() =>
                randomUUID().replace(/-/g, '').slice(0, 8)
            )
            const databaseName = `deployer_bootstrap_${suffix}`

            yield* log(`target database = ${databaseName}`)
            yield* log(`admin URL       = ${redactUrl(adminUrl)}`)

            yield* withPg(adminUrl, (adminSql) =>
                Effect.gen(function* () {
                    yield* log('▸ Probing shared Postgres admin endpoint …')
                    yield* self.waitForPostgres(adminUrl, log)

                    const escapedName = `"${databaseName.replaceAll('"', '""')}"`
                    yield* log(`▸ CREATE DATABASE ${escapedName} …`)
                    yield* query(
                        adminSql,
                        `CREATE DATABASE ${escapedName}`,
                        'create-database'
                    )
                    yield* log('  database created')
                })
            )

            const parsed = yield* Effect.try({
                try: () => {
                    const url = new URL(sharedUri)
                    url.pathname = `/${databaseName}`
                    return url
                },
                catch: (cause) =>
                    new PostgresOperationError({
                        operation: 'parse-shared-uri',
                        message: messageOf(cause),
                        cause,
                    }),
            })
            yield* log(
                `namespace ready at ${parsed.hostname}:${parsed.port}${parsed.pathname}`
            )
            return parsed.toString()
        })()
    }

    /**
     * Provision the global Postgres as a PLAIN CONTAINER, for a profile with no swarm (compose owns
     * every service). Reachable by the same alias the compose stack uses (`global-db`), so the DSN is
     * identical either way.
     */
    private provisionContainerDatabase(
        log: StepLog
    ): Effect.Effect<string, unknown, DockerEngine | ApiEnvironment> {
        const self = this
        return Effect.fn('provisionContainerDatabase')(function* () {
            const dockerEngine = yield* DockerEngine
            const env = yield* ApiEnvironment

            const prefix = env.get('DEPLOYER_PREFIX')
            const name = managedPostgresServiceName(prefix)
            const identity = resolvePostgresIdentity(env)
            const network = platformNetworkName(prefix)

            yield* logLines(log, [
                '▸ No swarm on this deployment (compose owns every service) — provisioning Postgres as a container',
                `  container = ${name}`,
                `  image     = ${identity.image}`,
                `  volume    = ${MANAGED_POSTGRES_VOLUME_NAME}`,
                `  user      = ${identity.username}`,
                `  db        = ${identity.databaseName}`,
            ])

            // Volume first: recreating the container must reuse existing data, so it is never removed here.
            yield* dockerEngine.volumes
                .ensure(MANAGED_POSTGRES_VOLUME_NAME)
                .pipe(Effect.ignore)

            // An interrupted earlier run can leave a container behind; `create` fails on a name collision.
            yield* dockerEngine.containers.removeIfExists(name).pipe(Effect.ignore)

            const container = yield* dockerEngine.containers.create({
                name,
                Image: identity.image,
                Env: [
                    `POSTGRES_USER=${identity.username}`,
                    `POSTGRES_PASSWORD=${identity.password}`,
                    `POSTGRES_DB=${identity.databaseName}`,
                ],
                HostConfig: {
                    PortBindings: {
                        [`${String(MANAGED_POSTGRES_PORT)}/tcp`]: [
                            { HostPort: '0' },
                        ],
                    },
                    Binds: [
                        `${MANAGED_POSTGRES_VOLUME_NAME}:/var/lib/postgresql/data`,
                    ],
                    RestartPolicy: { Name: 'unless-stopped' },
                },
                ExposedPorts: { [`${String(MANAGED_POSTGRES_PORT)}/tcp`]: {} },
                // The alias is what makes it reachable: declare network AND aliases at CREATE time,
                // otherwise the container lands on the default bridge where `global-db` does not resolve.
                NetworkingConfig: {
                    EndpointsConfig: {
                        [network]: {
                            Aliases: [name, MANAGED_POSTGRES_ALIAS],
                        },
                    },
                },
            })

            yield* log(`▸ Starting container ${container.id.slice(0, 12)} …`)
            yield* dockerEngine.containers.start(container.id)

            const { username, password, databaseName } = identity
            const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`

            // STARTED IS NOT LISTENING: wait for the first-boot initdb before the next step connects.
            yield* log('▸ Waiting for Postgres to accept connections …')
            yield* self.waitForPostgres(url, log)

            yield* log(
                `✅ Database ready at postgresql://${username}:***@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`
            )
            return url
        })()
    }

    private provisionDockerDatabase(
        log: StepLog,
        deploymentOwnsEverything: boolean
    ): Effect.Effect<
        string,
        unknown,
        | PostgresProvisioner
        | DockerEngine
        | ApiEnvironment
        | SupervisorOrchestrator
    > {
        const self = this
        return Effect.fn('provisionDockerDatabase')(function* () {
            const postgresProvisioner = yield* PostgresProvisioner
            const dockerEngine = yield* DockerEngine
            const env = yield* ApiEnvironment
            const supervisors = yield* SupervisorOrchestrator

            // Shared Postgres (e2e globalSetup): namespace inside it instead of a new service.
            const sharedUri = yield* optionalEnv(SHARED_PG_ENV)
            if (sharedUri) {
                yield* log(
                    'detected E2E_SHARED_POSTGRES_CONNECTION_URI — using namespace mode'
                )
                return yield* self.provisionDatabaseNamespace(sharedUri, log)
            }

            // Fully compose-managed profile: no swarm, so the swarm-service path below cannot run.
            if (deploymentOwnsEverything) {
                return yield* self.provisionContainerDatabase(log)
            }

            // The global database is a SWARM SERVICE — the same object GlobalDbSupervisorService
            // converges for the rest of the platform's life (same spec builder, same resolver).
            yield* log('▸ Scheduling the global Postgres as a swarm service …')
            const prefix = env.get('DEPLOYER_PREFIX')
            const serviceName = managedPostgresServiceName(prefix)
            const identity = resolvePostgresIdentity(env)
            yield* logLines(log, [
                `  service = ${serviceName}`,
                `  image   = ${identity.image}`,
                `  volume  = ${MANAGED_POSTGRES_VOLUME_NAME}`,
                `  user    = ${identity.username}`,
                `  db      = ${identity.databaseName}`,
                '  port    = 5432 (host mode, node-local)',
            ])

            const spec = yield* postgresProvisioner.ensure({ prefix, identity })
            yield* log(`✅ Service ${spec.name} has a running task`)

            // Attach THIS container to the overlay BEFORE using the DSN: the alias only resolves for
            // attached containers, and the supervisor's own cadence (30s) would race the probe.
            yield* supervisors.convergeNow(SWARM_APP_WIRING_SUPERVISOR_ID)
            yield* log(
                '▸ Wired this container onto the platform overlay (global-db resolvable)'
            )

            yield* log('▸ Replaying recent service output …')
            const initialLogs = yield* dockerEngine.swarmServices.logs(
                spec.name,
                { stdout: true, stderr: true, tail: 30 }
            )
            const initialLines = initialLogs
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            yield* initialLines.length === 0
                ? log('  (no prior output)')
                : logLines(log, initialLines)

            const { username, password, databaseName } = identity
            const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`
            yield* log(
                `✅ Database ready at postgresql://${username}:***@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`
            )
            return url
        })()
    }

    private readonly seedInitialData: (
        databaseUrl: string,
        input: SetupInitializeLocalInput,
        log: StepLog
    ) => Effect.Effect<{ userId: string }, unknown> = Effect.fn(
        'seedInitialData'
    )(function* (
        databaseUrl: string,
        input: SetupInitializeLocalInput,
        log: StepLog
    ) {
        const seedError =
            (stage: string) =>
            (cause: unknown): SeedFailedError =>
                new SeedFailedError({
                    stage,
                    message: messageOf(cause),
                    cause,
                })

        /** Read the admin row through the Effect driver — a statement IS an Effect here. */
        const findAdminId = (stage: string) =>
            withPg(databaseUrl, (sql) =>
                Effect.gen(function* () {
                    const db = yield* effectDatabase(sql)
                    return yield* db
                        .select({ id: user.id, role: user.role })
                        .from(user)
                        .where(eq(user.email, input.email))
                        .limit(1)
                        .pipe(
                            Effect.mapError(seedError(stage)),
                            Effect.map((rows) => rows[0])
                        )
                })
            )

        // Idempotent seed: never call sign-up a second time for an existing admin.
        yield* log('▸ Checking whether the admin already exists…')
        const existing = yield* findAdminId('lookup-existing')
        if (existing) {
            // AUTH-005: an existing account is never promoted by matching an email.
            yield* log(
                `  user ${input.email} already exists — leaving its role untouched`
            )
            return { userId: existing.id }
        }

        // Better Auth is the single source of truth for user/account creation.
        yield* log('▸ Creating Better Auth instance (service-side API)…')
        const authEnv = yield* Effect.all({
            DEV_AUTH_KEY: optionalEnv('DEV_AUTH_KEY'),
            DEFAULT_ADMIN_EMAIL: optionalEnv('DEFAULT_ADMIN_EMAIL'),
            NODE_ENV: Config.String('NODE_ENV').pipe(
                Config.withDefault('development')
            ),
            BASE_URL: optionalEnv('NEXT_PUBLIC_API_URL'),
            APP_URL: optionalEnv('APP_URL'),
            NEXT_PUBLIC_APP_URL: optionalEnv('NEXT_PUBLIC_APP_URL'),
            TRUSTED_ORIGINS: optionalEnv('TRUSTED_ORIGINS'),
            AUTH_BASE_DOMAIN: optionalEnv('AUTH_BASE_DOMAIN'),
        })

        const userId = yield* withPromiseDatabase(databaseUrl, (db) =>
            Effect.gen(function* () {
                const { auth } = yield* Effect.try({
                    try: () => createBetterAuth(db, authEnv, provisioningSecret()),
                    catch: seedError('create-auth'),
                })

                yield* log(
                    "▸ Provisioning the super-admin through Better Auth's internal adapter …"
                )
                // Public sign-up is disabled (AUTH-001): provision verified, role written at creation.
                return yield* Effect.tryPromise({
                    try: () =>
                        provisionUserAccount(auth, {
                            email: input.email,
                            name: input.name,
                            password: input.password,
                            role: 'superAdmin',
                        }),
                    catch: seedError('provision-user'),
                })
            })
        ).pipe(
            // Another node created the same admin concurrently (unique email): the winner's row is
            // the admin. Use it, never promote it.
            Effect.catchIf(
                (error) => /duplicate|already exists|unique/i.test(error.message),
                (error) =>
                    Effect.gen(function* () {
                        yield* log(
                            `  concurrent seed detected (${error.message}) — using the row that won`
                        )
                        const raced = yield* findAdminId('lookup-raced')
                        if (!raced) return yield* Effect.fail(error)
                        return raced.id
                    })
            )
        )

        yield* logLines(log, [
            `  user.id  = ${userId}`,
            '  user + credential account written, role superAdmin, email verified',
        ])
        return { userId }
    })

    // ─── The flow ────────────────────────────────────────────────────────────

    initialize(
        input: SetupInitializeLocalInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Effect.Effect<
        { nodeId: string; databaseUrl: string },
        SetupInitializationFailed,
        LocalInitializationPorts
    > {
        return this.run(input, tracker, emit).pipe(
            Effect.mapError(
                (cause) =>
                    new SetupInitializationFailed({
                        reason: messageOf(cause),
                        cause,
                    })
            )
        )
    }

    /** The flow, yielding every collaborator it needs from the container. */
    private run(
        input: SetupInitializeLocalInput,
        tracker: SetupStepTracker,
        emit: EmitEvent
    ): Effect.Effect<
        { nodeId: string; databaseUrl: string },
        unknown,
        LocalInitializationPorts
    > {
        const self = this
        return Effect.fn('LocalInitialization.initialize')(function* () {
            const steps = self.makeSteps()

            const nodeId = yield* Effect.sync(() => randomUUID())
            yield* Effect.annotateCurrentSpan('nodeId', nodeId)

            // ── Database source resolution ───────────────────────────────────
            // 1. existingDatabaseUrl in the request → operator-supplied URL.
            // 2. Otherwise a URL already persisted for this node as a SETUP CANDIDATE → the node was GIVEN a database.
            // 3. Otherwise → the API spawns its own Postgres ("local", supervised by GlobalDbSupervisorService).
            const explicitUrl = input.existingDatabaseUrl?.trim() ?? ''

            const nodeConfigRepository = yield* NodeConfigRepository
            const providedUrl = explicitUrl
                ? ''
                : yield* nodeConfigRepository.find().pipe(
                      Effect.map((cfg) =>
                          cfg?.setupState !== 'setup_done' &&
                          cfg?.databaseUrl?.trim() &&
                          cfg.databaseProvisioning === 'external'
                              ? cfg.databaseUrl.trim()
                              : ''
                      )
                  )

            // Read ONCE: the swarm step founds the cluster from it, `register_node` persists it,
            // `finalize` reports it.
            const swarmChoice = input.swarm
            const databaseProvisioning =
                explicitUrl || providedUrl ? 'external' : 'local'

            // ── Swarm FIRST (unless the deployment owns everything) ──────────
            // Locally-managed Postgres is a SWARM SERVICE, so the engine must be a cluster BEFORE the
            // database step. Skipped for an externally-provided URL and when compose owns every service.
            const deploymentOwnsEverything = yield* self.deploymentOwnsAllServices(
                yield* ApiEnvironment
            )

            if (databaseProvisioning === 'local' && !deploymentOwnsEverything) {
                yield* runStep(
                    tracker,
                    emit,
                    'initialize_swarm',
                    'Create the Swarm cluster',
                    (stepLog) =>
                        Effect.gen(function* () {
                            yield* logLines(stepLog, [
                                '▸ Initializing Docker Swarm…',
                                `  mode    = ${swarmChoice?.mode ?? 'create'}`,
                                `  policy  = ${swarmChoice?.policy ?? 'auto'}`,
                                ...(swarmChoice?.advertiseAddr
                                    ? [
                                          `  advertise = ${swarmChoice.advertiseAddr}`,
                                      ]
                                    : []),
                                ...(swarmChoice?.joinAddrs.length
                                    ? [
                                          `  join    = ${swarmChoice.joinAddrs.join(', ')}`,
                                      ]
                                    : []),
                            ])

                            // PERSIST THE OPERATOR'S CHOICE BEFORE CONVERGING: `converge()` reads
                            // `node_config.swarmConfig`, not the request.
                            const cfg = yield* nodeConfigRepository.find()
                            const nowIso = yield* DateTime.now.pipe(
                                Effect.map(DateTime.formatIso)
                            )
                            yield* nodeConfigRepository.upsert({
                                ...(cfg ?? {}),
                                nodeId,
                                strategy: 'local',
                                setupState: cfg?.setupState ?? 'not_started',
                                deployerVersion: DEPLOYER_VERSION,
                                swarmConfig: {
                                    mode: swarmChoice?.mode ?? 'create',
                                    policy: swarmChoice?.policy ?? 'auto',
                                    advertiseAddr:
                                        swarmChoice?.advertiseAddr ?? null,
                                    joinToken: swarmChoice?.joinToken ?? null,
                                    joinAddrs: swarmChoice?.joinAddrs ?? [],
                                },
                                updatedAt: nowIso,
                            })
                            yield* stepLog(
                                '  → participation persisted (node_config.swarmConfig)'
                            )

                            yield* (yield* SwarmBootstrap).converge('setup')
                            const snapshot = yield* (
                                yield* SwarmCluster
                            ).getLocalClusterSnapshot()

                            if (snapshot.localNodeState !== 'active') {
                                // A service-based database CANNOT be provisioned without a swarm.
                                return yield* Effect.fail(
                                    new AppError(
                                        `Swarm cluster did not become active (state=${snapshot.localNodeState}); ` +
                                            'a locally-managed Postgres is scheduled as a swarm service and cannot be provisioned without it',
                                        'SWARM_UNAVAILABLE',
                                        {
                                            localNodeState:
                                                snapshot.localNodeState,
                                        }
                                    )
                                )
                            }

                            yield* logLines(stepLog, [
                                '✅ Swarm cluster active',
                                `  role    = ${snapshot.localNode.swarmRole}`,
                                `  master  = ${snapshot.master?.nodeId ?? 'self'}`,
                                `  nodes   = ${String(snapshot.nodeCount)} (managers ${String(snapshot.managerCount)})`,
                            ])
                        })
                )
            }

            const databaseUrl = yield* runStep(
                tracker,
                emit,
                'provision_database',
                'Set up the database',
                (stepLog) =>
                    Effect.gen(function* () {
                        const existingUrl = explicitUrl || providedUrl
                        if (existingUrl) {
                            yield* logLines(stepLog, [
                                explicitUrl
                                    ? '▸ Using database URL supplied in the setup request'
                                    : '▸ Using the database URL provided for this node (MANAGED_GLOBAL_DB_ENABLED / SETUP_AUTO)',
                                `  host = ${redactUrl(existingUrl)}`,
                                '▸ Opening probe connection (max 1 client)…',
                            ])
                            return yield* steps.probeExistingDatabase(
                                existingUrl,
                                stepLog
                            )
                        }
                        yield* logLines(stepLog, [
                            '▸ Bootstrapping Docker Postgres 16…',
                            '  image  = postgres:16-alpine',
                            '  volume = deployer_postgres_data',
                            '  port   = 5432 (host-assigned)',
                            '▸ Pulling image (cached if present)…',
                        ])
                        return yield* steps.provisionDockerDatabase(
                            stepLog,
                            deploymentOwnsEverything
                        )
                    })
            )

            const readyLine = `✅ Database ready at ${redactUrl(databaseUrl)}`
            yield* Effect.sync(() => {
                tracker.log('provision_database', readyLine)
                const readyEvent = tracker.logEvent(
                    'provision_database',
                    readyLine
                )
                if (readyEvent) emit(readyEvent)
            })

            const existingTables = yield* runStep(
                tracker,
                emit,
                'ensure_empty',
                'Ensure database is empty',
                (stepLog) =>
                    Effect.gen(function* () {
                        yield* logLines(stepLog, [
                            '▸ Querying information_schema.tables …',
                            '  schema = public',
                            '  type   = BASE TABLE',
                        ])
                        const tables =
                            yield* steps.ensureDatabaseEmpty(databaseUrl)
                        yield* tables.length === 0
                            ? logLines(stepLog, [
                                  '  result = 0 tables',
                                  '✅ Database is empty',
                              ])
                            : logLines(stepLog, [
                                  `  result = ${String(tables.length)} tables`,
                                  `  tables = ${tables.join(', ')}`,
                                  '✅ Database already initialized',
                              ])
                        return tables
                    })
            )

            // Already initialized (tables exist): skip migration and seed.
            if (existingTables.length === 0) {
                yield* runStep(
                    tracker,
                    emit,
                    'run_migrations',
                    'Run migrations',
                    (stepLog) =>
                        Effect.gen(function* () {
                            // Resolved by the package that owns the migrations — not a `../..` count.
                            const migrationsFolder = GLOBAL_MIGRATIONS_DIR
                            const migrationNames = yield* Effect.try({
                                try: () => listMigrationNames(migrationsFolder),
                                catch: (cause) =>
                                    new MigrationFolderError({
                                        folder: migrationsFolder,
                                        message: messageOf(cause),
                                        cause,
                                    }),
                            })
                            const total = String(migrationNames.length)
                            yield* logLines(stepLog, [
                                `▸ Migration folder: ${migrationsFolder}`,
                                `▸ Found ${total} migration file(s):`,
                                ...migrationNames.map(
                                    (name, i) =>
                                        `  [${String(i + 1).padStart(2, '0')}/${total}] ${name}`
                                ),
                                '▸ Handing off to drizzle migrator (every statement will be streamed below)…',
                            ])
                            yield* steps.runMigrations(
                                databaseUrl,
                                migrationsFolder,
                                stepLog
                            )
                            yield* stepLog(
                                `✅ All ${total} migration(s) applied successfully`
                            )
                        }),
                    'Connecting to the database and applying every Drizzle migration one statement at a time.'
                )

                yield* runStep(
                    tracker,
                    emit,
                    'seed_initial_data',
                    'Initialize workspace data',
                    (stepLog) =>
                        Effect.gen(function* () {
                            yield* logLines(stepLog, [
                                `▸ Creating super-admin user: ${input.email}`,
                                `  name  = ${input.name}`,
                                '  role  = super-admin',
                                '▸ Hashing password (bcrypt, cost 12)…',
                                '▸ Inserting user record…',
                                '▸ Inserting credentials account…',
                            ])
                            const seedResult = yield* steps.seedInitialData(
                                databaseUrl,
                                input,
                                stepLog
                            )
                            yield* logLines(stepLog, [
                                `✅ User ${input.email} created with super-admin role`,
                                `  user.id  = ${seedResult.userId}`,
                            ])
                        })
                )
            } else {
                yield* Effect.logInfo(
                    '⏭️  Database already initialized — skipping migration and seed steps'
                )
            }

            yield* runStep(
                tracker,
                emit,
                'register_node',
                'Register this node',
                (stepLog) =>
                    Effect.gen(function* () {
                        yield* logLines(stepLog, [
                            `▸ Assigning node ID ${nodeId}…`,
                            '  strategy = local',
                            '  mesh     = (none)',
                            '  database = ' +
                                (databaseProvisioning === 'local'
                                    ? 'locally managed (supervised)'
                                    : 'external (provided URL)'),
                            ...(swarmChoice
                                ? [
                                      `  swarm    = ${swarmChoice.mode} cluster (policy=${swarmChoice.policy})`,
                                  ]
                                : []),
                            '▸ Persisting node config to global database…',
                        ])
                        const now = yield* DateTime.now.pipe(
                            Effect.map(DateTime.formatIso)
                        )
                        yield* nodeConfigRepository.upsert({
                            nodeId,
                            strategy: 'local',
                            setupState: 'setup_done',
                            deployerVersion: DEPLOYER_VERSION,
                            meshUrlsSnapshot: [],
                            configuredAt: now,
                            updatedAt: now,
                            databaseUrl,
                            databaseProvisioning,
                            swarmConfig: swarmChoice
                                ? {
                                      mode: swarmChoice.mode,
                                      policy: swarmChoice.policy,
                                      advertiseAddr:
                                          swarmChoice.advertiseAddr ?? null,
                                      joinToken: swarmChoice.joinToken ?? null,
                                      joinAddrs: swarmChoice.joinAddrs,
                                  }
                                : undefined,
                        })
                        yield* stepLog('✅ Node config persisted')
                    })
            )

            yield* runStep(
                tracker,
                emit,
                'finalize',
                'Finalize setup',
                (stepLog) =>
                    Effect.gen(function* () {
                        yield* logLines(stepLog, [
                            '▸ Marking setup as completed…',
                            `  nodeId  = ${nodeId}`,
                            `  dbUrl   = ${redactUrl(databaseUrl)}`,
                            '▸ Generating readiness summary…',
                            '  database  = ready',
                            '  migrations = applied',
                            '  workspace  = seeded',
                            '▸ Swarm summary…',
                        ])

                        // Reported from the LIVE engine snapshot, so a cluster that degraded since is
                        // reported honestly instead of echoing a stale success.
                        const swarmSnapshot = yield* (
                            yield* SwarmCluster
                        ).getLocalClusterSnapshot()
                        yield* swarmSnapshot.localNodeState === 'active'
                            ? logLines(stepLog, [
                                  '✅ Swarm cluster active',
                                  `  mode    = ${swarmChoice?.mode ?? 'create'}`,
                                  `  policy  = ${swarmChoice?.policy ?? 'auto'}`,
                                  `  role    = ${swarmSnapshot.localNode.swarmRole}`,
                                  `  master  = ${swarmSnapshot.master?.nodeId ?? 'self'}`,
                                  `  nodes   = ${String(swarmSnapshot.nodeCount)} (managers ${String(swarmSnapshot.managerCount)})`,
                                  '  → every platform service is scheduled on Swarm',
                              ])
                            : logLines(stepLog, [
                                  `⚠️  Swarm not active (state=${swarmSnapshot.localNodeState})`,
                                  '  → re-converge from the Cluster page',
                              ])

                        yield* stepLog('✅ Setup complete')
                    })
            )

            return { nodeId, databaseUrl }
        })()
    }

    /**
     * Whether the DEPLOYMENT owns every platform service (compose / operator).
     *
     * True for the plain `dev` profile, where every `MANAGED_*_ENABLED` is `true`: the supervisors all
     * skip registration and NOTHING is ever scheduled onto a swarm. Read from the SAME
     * `splitManagedEnv` source the supervisors use, so this cannot disagree with them.
     */
    private deploymentOwnsAllServices(
        env: EnvService
    ): Effect.Effect<boolean> {
        return Effect.sync(() => {
            const managed = splitManagedEnv(env)
            return (
                managed.traefik.enabled &&
                managed.redis.enabled &&
                managed.localDb.enabled
            )
        })
    }
}

export class LocalInitializationService extends Context.Service<
    LocalInitializationService,
    LocalInitializationServiceShape
>()('shared/LocalInitializationService') {
    /** The implementation: only the step overrides are per-instance; everything else is yielded. */
    static readonly live = LocalInitializationServiceImpl
}
