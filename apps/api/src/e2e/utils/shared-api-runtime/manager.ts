import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Logger, type INestApplication } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import Dockerode from 'dockerode'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { Wait } from 'testcontainers'
import { getMockEnv } from '@repo/env/mock'
import * as schema from '@/config/drizzle/global/schema'
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service'
import {
    GLOBAL_DATABASE_CONNECTION,
    GLOBAL_DATABASE_POOL,
} from '@/core/modules/database/database-connection'
import { TraefikFileSystemService } from '@/core/modules/traefik/services/traefik-file-system.service'
import { sharedRequestOverride } from './request-override'
import {
    DEFAULT_SHARED_RUNTIME_KEY,
    SHARED_POSTGRES_CONNECTION_URI_ENV,
    resolveSharedRuntimeMaxConcurrency,
    type SharedApiRuntime,
    type SharedApiRuntimeOptions,
    type SharedRuntimeDatabaseContext,
    type SharedPostgresContainerHandle,
    type SharedRuntimePlugin,
} from './types'

const SHARED_RUNTIME_LOG_ENV = 'E2E_SHARED_RUNTIME_LOGS'

class ExternalSharedPostgresContainerHandle
    implements SharedPostgresContainerHandle
{
    public constructor(private readonly connectionUri: string) {}

    public getConnectionUri(): string {
        return this.connectionUri
    }

    public async stop(): Promise<void> {
        // External container lifecycle is managed by global Vitest setup.
    }
}

function isTruthyEnv(value: string | undefined): boolean {
    if (!value) return false
    const normalized = value.trim().toLowerCase()
    return (
        normalized === '1' ||
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === 'on'
    )
}

function isSharedRuntimeLoggingEnabled(): boolean {
    return isTruthyEnv(process.env[SHARED_RUNTIME_LOG_ENV])
}

function logStep(message: string): void {
    if (!isSharedRuntimeLoggingEnabled()) return
    const now = new Date().toISOString()
    console.log(`[e2e-runtime ${now}] ${message}`)
}

function describeActiveHandles(): string {
    const handles =
        (
            process as typeof process & {
                _getActiveHandles?: () => unknown[]
            }
        )._getActiveHandles?.() ?? []

    if (handles.length === 0) {
        return 'none'
    }

    return handles
        .map((handle) => {
            const typed = handle as {
                constructor?: { name?: string }
                hasRef?: () => boolean
            }
            const name = typed.constructor?.name ?? 'unknown'
            const ref =
                typeof typed.hasRef === 'function'
                    ? ` ref=${String(typed.hasRef())}`
                    : ''
            return `${name}${ref}`
        })
        .join(', ')
}

async function withWatchdog<T>(
    stepLabel: string,
    timeoutMs: number,
    action: () => Promise<T>
): Promise<T> {
    const startedAt = Date.now()

    const interval = setInterval(() => {
        const elapsed = Date.now() - startedAt
        logStep(
            `${stepLabel} still running after ${String(elapsed)}ms | active handles: ${describeActiveHandles()}`
        )
    }, 5_000)

    const timeout = setTimeout(() => {
        logStep(
            `${stepLabel} timeout after ${String(timeoutMs)}ms | active handles: ${describeActiveHandles()}`
        )
    }, timeoutMs)

    let raceTimeout: ReturnType<typeof setTimeout> | null = null

    try {
        return await Promise.race([
            action(),
            new Promise<T>((_, reject) => {
                raceTimeout = setTimeout(() => {
                    reject(
                        new Error(
                            `${stepLabel} exceeded ${String(timeoutMs)}ms (active handles: ${describeActiveHandles()})`
                        )
                    )
                }, timeoutMs)
            }),
        ])
    } finally {
        clearInterval(interval)
        clearTimeout(timeout)
        if (raceTimeout) {
            clearTimeout(raceTimeout)
        }
    }
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) {
        return error
    }

    return new Error(String(error))
}

function buildBootstrapAsyncFailure(errors: Error[]): Error {
    const details = errors
        .map((error, index) => `${String(index + 1)}. ${error.message}`)
        .join(' | ')

    return new Error(
        `shared-api-runtime bootstrap detected async failure(s): ${details}`
    )
}

function normalizeDbHost(host: string): string {
    return host === 'localhost' ? '127.0.0.1' : host
}

function summarizeDatabaseEndpoint(url: string): string {
    const parsed = new URL(url)
    return `${normalizeDbHost(parsed.hostname)}:${parsed.port || '<default>'}${parsed.pathname}`
}

function sanitizeDatabaseNamePart(value: string): string {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')

    if (normalized.length === 0) {
        return 'runtime'
    }

    return normalized.slice(0, 24)
}

function buildAdminDatabaseUrl(baseConnectionUri: string): string {
    const parsed = new URL(baseConnectionUri)
    if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1'
    }
    parsed.pathname = '/postgres'
    return parsed.toString()
}

function buildDatabaseUrlWithDatabase(
    baseConnectionUri: string,
    databaseName: string
): string {
    const parsed = new URL(baseConnectionUri)
    if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1'
    }
    parsed.pathname = `/${databaseName}`
    if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', '5')
    }
    if (!parsed.searchParams.has('statement_timeout')) {
        parsed.searchParams.set('statement_timeout', '10000')
    }
    return parsed.toString()
}

async function waitForDatabaseReady(databaseUrl: string): Promise<void> {
    const deadline = Date.now() + 20_000
    let lastError: Error | null = null

    while (Date.now() < deadline) {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 })
        try {
            await pool.query('SELECT 1')
            return
        } catch (error) {
            lastError = normalizeError(error)
            await new Promise((resolve) => setTimeout(resolve, 300))
        } finally {
            await pool.end().catch(() => undefined)
        }
    }

    throw new Error(
        `Postgres testcontainer not ready in time: ${lastError?.message ?? 'unknown connection error'}`
    )
}

async function migrateDatabaseSchema(databaseUrl: string): Promise<void> {
    const migrationsFolder = fileURLToPath(
        new URL('../../../config/drizzle/global/migrations', import.meta.url)
    )
    const pool = new Pool({ connectionString: databaseUrl })

    try {
        const db = drizzle(pool, { schema })
        await migrate(db, { migrationsFolder })
    } finally {
        await pool.end()
    }
}

async function withPgRetry<T>(
    label: string,
    action: () => Promise<T>,
    options: { retries?: number; delayMs?: number } = {}
): Promise<T> {
    const retries = options.retries ?? 8
    const delayMs = options.delayMs ?? 250
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            return await action()
        } catch (error) {
            lastError = normalizeError(error)
            if (attempt >= retries) {
                break
            }

            logStep(
                `${label} failed (attempt ${String(attempt)}/${String(retries)}): ${lastError.message}`
            )
            await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
    }

    throw new Error(
        `${label} failed after ${String(retries)} attempts: ${lastError?.message ?? 'unknown error'}`
    )
}

async function assertRuntimeDatabaseBinding(
    moduleRef: TestingModule,
    expectedDatabaseUrl: string
): Promise<void> {
    const databaseService = moduleRef.get(GlobalDatabaseService)
    if (!databaseService.isHealthy()) {
        throw new Error('GlobalDatabaseService is not connected after app bootstrap')
    }

    await databaseService.db.execute('SELECT 1')

    const pool = moduleRef.get<Pool | null>(GLOBAL_DATABASE_POOL, { strict: false })
    const actualConnectionString = (
        pool as unknown as { options?: { connectionString?: string } } | null
    )?.options?.connectionString

    if (!actualConnectionString) {
        return
    }

    const expected = new URL(expectedDatabaseUrl)
    const actual = new URL(actualConnectionString)

    const expectedHost = normalizeDbHost(expected.hostname)
    const actualHost = normalizeDbHost(actual.hostname)
    const expectedPort = expected.port || '5432'
    const actualPort = actual.port || '5432'
    const expectedDb = expected.pathname
    const actualDb = actual.pathname

    if (
        expectedHost !== actualHost ||
        expectedPort !== actualPort ||
        expectedDb !== actualDb
    ) {
        throw new Error(
            `Database pool mismatch (expected ${summarizeDatabaseEndpoint(expectedDatabaseUrl)}, got ${summarizeDatabaseEndpoint(actualConnectionString)})`
        )
    }
}

async function configureTraefikPathsForE2E(
    moduleRef: TestingModule
): Promise<void> {
    const traefikFileSystemService = moduleRef.get(TraefikFileSystemService, {
        strict: false,
    })
    if (!traefikFileSystemService) {
        return
    }

    const basePath = process.env.TRAEFIK_CONFIG_BASE_PATH
    const backupPath = process.env.TRAEFIK_BACKUP_PATH

    if (!basePath || !backupPath) {
        throw new Error(
            'TRAEFIK_CONFIG_BASE_PATH/TRAEFIK_BACKUP_PATH are required for e2e runtime'
        )
    }

    const fs = await import('node:fs/promises')
    await fs.mkdir(basePath, { recursive: true })
    await fs.mkdir(backupPath, { recursive: true })

    await Promise.all([
        Bun.write(join(basePath, '.e2e-writable-check'), ''),
        Bun.write(join(backupPath, '.e2e-writable-check'), ''),
    ])

    const mutableService = traefikFileSystemService as unknown as {
        paths?: {
            basePath: string
            dynamicPath: string
            staticPath: string
            projectsPath: string
            standalonePath: string
            sslPath: string
            certsPath: string
            middlewarePath: string
            pluginsPath: string
            backupPath: string
        }
    }

    if (!mutableService.paths) {
        return
    }

    mutableService.paths.basePath = basePath
    mutableService.paths.dynamicPath = join(basePath, 'dynamic')
    mutableService.paths.staticPath = join(basePath, 'static')
    mutableService.paths.projectsPath = join(basePath, 'dynamic', 'projects')
    mutableService.paths.standalonePath = join(
        basePath,
        'dynamic',
        'standalone'
    )
    mutableService.paths.sslPath = join(basePath, 'ssl')
    mutableService.paths.certsPath = join(basePath, 'certs')
    mutableService.paths.middlewarePath = join(basePath, 'middleware')
    mutableService.paths.pluginsPath = join(basePath, 'plugins')
    mutableService.paths.backupPath = backupPath
}

function resolveDefaultRuntimeKey(): string {
    const workerKey = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID
    if (workerKey && workerKey.length > 0) {
        return `worker-${workerKey}`
    }

    return DEFAULT_SHARED_RUNTIME_KEY
}

function resolveRuntimeKey(options?: SharedApiRuntimeOptions): string {
    if (options?.instanceKey && options.instanceKey.length > 0) {
        return options.instanceKey
    }

    return resolveDefaultRuntimeKey()
}

export class SharedApiRuntimeManager {
    private runtimePromisesByKey = new Map<string, Promise<SharedApiRuntime>>()
    private runtimeEnvSnapshotsByKey = new Map<string, Map<string, string | undefined>>()
    private runtimeStartStopLock: Promise<void> = Promise.resolve()
    private sharedPostgresContainerPromise: Promise<SharedPostgresContainerHandle> | null =
        null
    private sharedPostgresContainerRefCount = 0

    private resolvePlugins(options: SharedApiRuntimeOptions): SharedRuntimePlugin[] {
        return options.plugins ?? []
    }

    private async runPluginHook(
        plugins: SharedRuntimePlugin[],
        hook: keyof SharedRuntimePlugin,
        context: unknown,
    ): Promise<void> {
        for (const plugin of plugins) {
            const handler = plugin[hook]
            if (typeof handler !== 'function') {
                continue
            }

            await withWatchdog(`plugin:${plugin.name}:${String(hook)}`, 30_000, async () => {
                await handler(context as never)
            })
        }
    }

    private applyRuntimeEnv(
        entries: Record<string, string>
    ): Map<string, string | undefined> {
        const snapshot = new Map<string, string | undefined>()

        for (const [key, value] of Object.entries(entries)) {
            snapshot.set(key, process.env[key])
            process.env[key] = value
        }

        return snapshot
    }

    private restoreRuntimeEnv(snapshot: Map<string, string | undefined>): void {
        for (const [key, value] of snapshot.entries()) {
            if (value === undefined) {
                delete process.env[key]
                continue
            }

            process.env[key] = value
        }
    }

    private requireValue<T>(value: T | null | undefined, message: string): T {
        if (value == null) {
            throw new Error(message)
        }

        return value
    }

    /**
     * Remove any Docker containers with the `deployer.managed` label.
     * These are created by LocalInitializationService.provisionDockerDatabase()
     * during the `initialize` ORPC call and are never auto-removed because
     * Postgres keeps them alive. If left running they accumulate across the
     * test suite and slow down subsequent Docker operations.
     */
    private async cleanupDeployerManagedContainers(): Promise<void> {
        const docker = new Dockerode()
        const containers = await docker.listContainers({
            all: true,
            filters: { label: ['deployer.managed'] },
        })

        if (containers.length === 0) {
            return
        }

        for (const containerInfo of containers) {
            const dockerContainer = docker.getContainer(containerInfo.Id)
            try {
                await dockerContainer.stop({ t: 5 }).catch(() => undefined)
                await dockerContainer.remove({ force: true }).catch(() => undefined)
                logStep(
                    `Cleaned up deployer-managed container: ${containerInfo.Names?.[0] ?? containerInfo.Id}`,
                )
            } catch {
                // already removed or inaccessible — ignore
            }
        }
    }

    private async withRuntimeStartStopLock<T>(
        action: () => Promise<T>
    ): Promise<T> {
        let release: (() => void) | null = null
        const current = this.runtimeStartStopLock
        this.runtimeStartStopLock = new Promise<void>((resolve) => {
            release = resolve
        })

        await current

        try {
            return await action()
        } finally {
            if (release) {
                release()
            }
        }
    }

    private async acquireSharedPostgresContainer(): Promise<SharedPostgresContainerHandle> {
        return await this.withRuntimeStartStopLock(async () => {
            if (!this.sharedPostgresContainerPromise) {
                const sharedConnectionUri =
                    process.env[SHARED_POSTGRES_CONNECTION_URI_ENV]
                if (sharedConnectionUri && sharedConnectionUri.length > 0) {
                    logStep(
                        `acquireSharedPostgresContainer: using EXTERNAL shared container (${summarizeDatabaseEndpoint(sharedConnectionUri)})`,
                    );
                    this.sharedPostgresContainerPromise = Promise.resolve(
                        new ExternalSharedPostgresContainerHandle(
                            sharedConnectionUri
                        )
                    )
                } else {
                    logStep(
                        'acquireSharedPostgresContainer: creating NEW container (no shared URI)',
                    );
                    this.sharedPostgresContainerPromise = new PostgreSqlContainer(
                        'postgres:16-alpine'
                    )
                        .withDatabase('deployer_e2e')
                        .withUsername('deployer')
                        .withPassword('deployer')
                        .withWaitStrategy(
                            Wait.forLogMessage(
                                'database system is ready to accept connections'
                            )
                        )
                        .withStartupTimeout(180_000)
                        .start()
                }
            }

            const container = await this.sharedPostgresContainerPromise
            this.sharedPostgresContainerRefCount += 1
            logStep(
                `acquireSharedPostgresContainer: refCount now ${String(this.sharedPostgresContainerRefCount)}`,
            );
            return container
        })
    }

    private async releaseSharedPostgresContainer(): Promise<void> {
        await this.withRuntimeStartStopLock(async () => {
            if (!this.sharedPostgresContainerPromise) {
                return
            }

            this.sharedPostgresContainerRefCount = Math.max(
                0,
                this.sharedPostgresContainerRefCount - 1
            )
            if (this.sharedPostgresContainerRefCount > 0) {
                return
            }

            const container = await this.sharedPostgresContainerPromise
            await container.stop().catch(() => undefined)
            this.sharedPostgresContainerPromise = null
        })
    }

    private async createRuntimeDatabase(
        container: SharedPostgresContainerHandle,
        options: SharedApiRuntimeOptions,
        instanceKey: string
    ): Promise<{ databaseName: string; databaseUrl: string }> {
        const baseConnectionUri = container.getConnectionUri()
        const adminDatabaseUrl = buildAdminDatabaseUrl(baseConnectionUri)
        const adminPool = new Pool({
            connectionString: adminDatabaseUrl,
            max: 1,
        })

        const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
        const databaseName = options.database?.name
            ? sanitizeDatabaseNamePart(options.database.name)
            : `deployer_e2e_${sanitizeDatabaseNamePart(instanceKey)}_${suffix}`

        try {
            const escapedName = `"${databaseName.replaceAll('"', '""')}"`
            await waitForDatabaseReady(adminDatabaseUrl)
            await withPgRetry(
                `create runtime database ${databaseName}`,
                async () => {
                    await adminPool.query(`CREATE DATABASE ${escapedName}`)
                }
            )
        } finally {
            await adminPool.end().catch(() => undefined)
        }

        return {
            databaseName,
            databaseUrl: buildDatabaseUrlWithDatabase(
                baseConnectionUri,
                databaseName
            ),
        }
    }

    private async dropRuntimeDatabase(
        container: SharedPostgresContainerHandle,
        databaseName: string
    ): Promise<void> {
        const adminDatabaseUrl = buildAdminDatabaseUrl(container.getConnectionUri())
        const adminPool = new Pool({
            connectionString: adminDatabaseUrl,
            max: 1,
        })
        const escapedName = `"${databaseName.replaceAll('"', '""')}"`

        try {
            await waitForDatabaseReady(adminDatabaseUrl)
            await withPgRetry(
                `drop runtime database ${databaseName}`,
                async () => {
                    try {
                        await adminPool.query(
                            `DROP DATABASE IF EXISTS ${escapedName} WITH (FORCE)`
                        )
                    } catch {
                        await adminPool.query(
                            `DROP DATABASE IF EXISTS ${escapedName}`
                        )
                    }
                },
                { retries: 4, delayMs: 200 }
            )
        } finally {
            await adminPool.end().catch(() => undefined)
        }
    }

    public async getRuntime(
        options: SharedApiRuntimeOptions = {}
    ): Promise<SharedApiRuntime> {
        const key = resolveRuntimeKey(options)
        const maxParallelSharedRuntimes = resolveSharedRuntimeMaxConcurrency()

        if (
            !this.runtimePromisesByKey.has(key) &&
            this.runtimePromisesByKey.size >= maxParallelSharedRuntimes
        ) {
            throw new Error(
                `Max shared runtime instances reached (${String(maxParallelSharedRuntimes)}). Stop one before creating ${key}.`
            )
        }

        if (!this.runtimePromisesByKey.has(key)) {
            this.runtimePromisesByKey.set(key, this.startRuntime(key, options))
        }

        const runtimePromise = this.runtimePromisesByKey.get(key)
        if (!runtimePromise) {
            throw new Error(`Missing runtime promise for key ${key}`)
        }

        try {
            return await runtimePromise
        } catch (error) {
            this.runtimePromisesByKey.delete(key)
            throw error
        }
    }

    public async stopRuntime(
        options: SharedApiRuntimeOptions = {}
    ): Promise<void> {
        const key = resolveRuntimeKey(options)
        const runtimePromise = this.runtimePromisesByKey.get(key)

        if (!runtimePromise) {
            return
        }

        this.runtimePromisesByKey.delete(key)

        let runtime: SharedApiRuntime
        try {
            runtime = await runtimePromise
        } catch {
            return
        }

        // Always clean up containers even if app.close() times out
        const cleanupContainer = async (): Promise<void> => {
            // End the pool first — this disconnects the app's Postgres
            // connections *before* we stop the Docker containers below.
            await runtime.runtimePool.end().catch(() => undefined)

            await this.dropRuntimeDatabase(
                runtime.postgresContainer,
                runtime.databaseName
            ).catch(() => undefined)
            await this.releaseSharedPostgresContainer().catch(() => undefined)
        }

        let appCloseError: Error | undefined

        try {
            await withWatchdog(`Nest app close (${key})`, 20_000, async () => {
                await runtime.app.close()
            })
        } catch (error) {
            appCloseError = error instanceof Error ? error : new Error(String(error))
            logStep(
                `stopRuntime: app.close failed (${key}): ${appCloseError.message} — continuing with container cleanup`,
            )
        }

        try {
            await withWatchdog(`Nest module close (${key})`, 20_000, async () => {
                await runtime.moduleRef.close()
            })
        } catch (error) {
            logStep(
                `stopRuntime: moduleRef.close failed (${key}): ${error instanceof Error ? error.message : String(error)}`,
            )
        }

        // Always clean up containers regardless of app/module close failures
        await cleanupContainer()

        const snapshot = this.runtimeEnvSnapshotsByKey.get(key)
        if (snapshot) {
            this.restoreRuntimeEnv(snapshot)
            this.runtimeEnvSnapshotsByKey.delete(key)
        }

        // Re-throw app close error after cleanup is complete
        if (appCloseError) {
            throw appCloseError
        }
    }

    public async stopAllRuntimes(): Promise<void> {
        const keys = [...this.runtimePromisesByKey.keys()]
        let lastError: Error | undefined

        for (const key of keys) {
            try {
                await this.stopRuntime({ instanceKey: key })
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error))
                logStep(
                    `stopAllRuntimes: runtime "${key}" stop failed: ${lastError.message}`,
                )
            }
        }

        // Clean up any bootstrap Postgres containers created by the setup wizard
        // (LocalInitializationService.provisionDockerDatabase) during tests.
        // These carry the "deployer.managed" label and accumulate across the
        // test suite if not explicitly removed.
        try {
            await this.cleanupDeployerManagedContainers()
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logStep(`stopAllRuntimes: cleanupDeployerManagedContainers failed: ${message}`)
        }

        if (lastError) {
            logStep(
                `stopAllRuntimes: completed with errors — ${keys.length} runtime(s) processed, last error: ${lastError.message}`,
            )
        }
    }

    private async startRuntime(
        instanceKey: string,
        options: SharedApiRuntimeOptions
    ): Promise<SharedApiRuntime> {
        const startedAt = Date.now()
        logStep(`bootstrap start (${instanceKey})`)
        const plugins = this.resolvePlugins(options)

        const bootstrapAsyncErrors: Error[] = []
        const onUnhandledRejection = (reason: unknown): void => {
            bootstrapAsyncErrors.push(normalizeError(reason))
        }
        const onUncaughtException = (error: Error): void => {
            bootstrapAsyncErrors.push(normalizeError(error))
        }

        process.on('unhandledRejection', onUnhandledRejection)
        process.on('uncaughtException', onUncaughtException)

        let postgresContainer: SharedPostgresContainerHandle | null = null
        let databaseName = ''
        let databaseUrl = ''
        let runtimePool: Pool | null = null
        let moduleBuilder: ReturnType<typeof Test.createTestingModule> | null =
            null
        let moduleRef: TestingModule | null = null
        let app: INestApplication | null = null
        let runtimeEnvSnapshot: Map<string, string | undefined> | null = null

        try {
            logStep(`acquiring shared postgres container (${instanceKey})`)
            postgresContainer = await this.acquireSharedPostgresContainer()

            await this.runPluginHook(plugins, 'onContainerReady', {
                instanceKey,
                postgresContainer,
            })

            logStep(`creating isolated database (${instanceKey})`)
            const dbInfo = await this.createRuntimeDatabase(
                postgresContainer,
                options,
                instanceKey
            )
            databaseName = dbInfo.databaseName
            databaseUrl = dbInfo.databaseUrl

            const databaseContext: SharedRuntimeDatabaseContext = {
                instanceKey,
                databaseName,
                databaseUrl,
                postgresContainer,
            }

            await options.database?.onDatabaseCreate?.(databaseContext)
            await this.runPluginHook(plugins, 'onDatabaseCreated', databaseContext)

            const apiMockEnv = getMockEnv('api')
            const runtimeEnv = {
                ...apiMockEnv,
                DATABASE_URL: databaseUrl,
                AUTH_SECRET:
                    process.env.AUTH_SECRET ??
                    apiMockEnv.AUTH_SECRET,
                BETTER_AUTH_SECRET:
                    process.env.BETTER_AUTH_SECRET ??
                    process.env.AUTH_SECRET ??
                    apiMockEnv.BETTER_AUTH_SECRET,
                NEXT_PUBLIC_API_URL:
                    process.env.NEXT_PUBLIC_API_URL ??
                    apiMockEnv.NEXT_PUBLIC_API_URL,
                NEXT_PUBLIC_APP_URL:
                    process.env.NEXT_PUBLIC_APP_URL ??
                    apiMockEnv.NEXT_PUBLIC_APP_URL,
                NODE_ENV: 'test',
                NODE_LOCAL_DB_PATH: join(
                    tmpdir(),
                    `deployer-api-e2e-${instanceKey}-${randomUUID()}.db`
                ),
                TRAEFIK_CONFIG_BASE_PATH: join(
                    tmpdir(),
                    `deployer-api-e2e-traefik-${instanceKey}-${randomUUID()}`
                ),
                TRAEFIK_BACKUP_PATH: '',
            }
            runtimeEnv.TRAEFIK_BACKUP_PATH = join(
                runtimeEnv.TRAEFIK_CONFIG_BASE_PATH,
                'backups'
            )
            runtimeEnvSnapshot = this.applyRuntimeEnv(runtimeEnv)
            this.runtimeEnvSnapshotsByKey.set(instanceKey, runtimeEnvSnapshot)
            await this.runPluginHook(plugins, 'onEnvironmentPrepared', {
                ...databaseContext,
                env: runtimeEnv,
            })

            await withWatchdog(
                `database readiness bootstrap (${instanceKey})`,
                30_000,
                async () => {
                    await waitForDatabaseReady(databaseUrl)
                }
            )

            await withWatchdog(
                `database schema migrate bootstrap (${instanceKey})`,
                120_000,
                async () => {
                    await migrateDatabaseSchema(databaseUrl)
                }
            )

            logStep(`loading AppModule (${instanceKey})`)
            const { AppModule } = await withWatchdog(
                `AppModule import (${instanceKey})`,
                45_000,
                async () => await import('@/app.module')
            )

            moduleRef = await withWatchdog(
                `Nest testing module compile (${instanceKey})`,
                60_000,
                async () => {
                    runtimePool = new Pool({
                        connectionString: databaseUrl,
                    })
                    const runtimeConnection = drizzle(runtimePool, {
                        schema,
                    })

                    moduleBuilder = Test.createTestingModule({
                        imports: [AppModule],
                    })
                        .overrideProvider(REQUEST)
                        .useValue(sharedRequestOverride)
                        .overrideProvider(GLOBAL_DATABASE_POOL)
                        .useValue(runtimePool)
                        .overrideProvider(GLOBAL_DATABASE_CONNECTION)
                        .useValue(runtimeConnection)

                    const moduleBuilderContext = {
                        ...databaseContext,
                        moduleBuilder,
                    }
                    await options.nest?.onModuleBuilder?.(moduleBuilderContext)
                    await this.runPluginHook(
                        plugins,
                        'onModuleBuilder',
                        moduleBuilderContext,
                    )

                    if (isSharedRuntimeLoggingEnabled()) {
                        moduleBuilder.setLogger(new Logger())
                    }

                    const compiled = await moduleBuilder.compile()

                    const moduleCompiledContext = {
                        ...databaseContext,
                        moduleBuilder,
                        moduleRef: compiled,
                    }
                    await options.nest?.onModuleCompiled?.(moduleCompiledContext)
                    await this.runPluginHook(
                        plugins,
                        'onModuleCompiled',
                        moduleCompiledContext,
                    )

                    return compiled
                }
            )

            await withWatchdog(
                `traefik e2e path configure (${instanceKey})`,
                10_000,
                async () => {
                    await configureTraefikPathsForE2E(
                        this.requireValue(
                            moduleRef,
                            'moduleRef missing for Traefik configure'
                        )
                    )
                }
            )

            app = this.requireValue(
                moduleRef,
                'moduleRef missing for app init'
            ).createNestApplication({
                logger: isSharedRuntimeLoggingEnabled()
                    ? undefined
                    : ['error'],
            })

            const appInitContext = {
                ...databaseContext,
                app,
                moduleRef: this.requireValue(
                    moduleRef,
                    'moduleRef missing for onAppInit'
                ),
                moduleBuilder: this.requireValue(
                    moduleBuilder,
                    'moduleBuilder missing for onAppInit'
                ),
            }
            await options.nest?.onAppInit?.(appInitContext)
            await this.runPluginHook(plugins, 'onAppInit', appInitContext)

            await withWatchdog(
                `Nest app listen (${instanceKey})`,
                45_000,
                async () => {
                    await this.requireValue(
                        app,
                        'app missing before listen'
                    ).listen(0)
                }
            )

            const resolvedModuleRef = this.requireValue(
                moduleRef,
                `Nest module missing after bootstrap (${instanceKey})`
            )
            const resolvedApp = this.requireValue(
                app,
                `Nest app missing after bootstrap (${instanceKey})`
            )
            const resolvedRuntimePool = this.requireValue(
                runtimePool,
                `Runtime pool missing after bootstrap (${instanceKey})`
            )

            await withWatchdog(
                `runtime database binding assert (${instanceKey})`,
                10_000,
                async () => {
                    await assertRuntimeDatabaseBinding(
                        resolvedModuleRef,
                        databaseUrl
                    )
                }
            )

            const httpServer = resolvedApp.getHttpServer() as {
                address: () => AddressInfo | string | null
            }
            const address = httpServer.address()
            if (!address || typeof address === 'string') {
                throw new Error(
                    'Unable to resolve Nest HTTP server address for e2e runtime'
                )
            }

            const baseUrl = `http://127.0.0.1:${String(address.port)}`

            await withWatchdog(
                `bootstrap async error guard (${instanceKey})`,
                5_000,
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 250))
                    if (bootstrapAsyncErrors.length > 0) {
                        throw buildBootstrapAsyncFailure(bootstrapAsyncErrors)
                    }
                }
            )

            logStep(
                `bootstrap complete (${instanceKey}) in ${String(Date.now() - startedAt)}ms (baseUrl=${baseUrl})`
            )

            const runtime: SharedApiRuntime = {
                app: resolvedApp,
                moduleRef: resolvedModuleRef,
                postgresContainer,
                runtimePool: resolvedRuntimePool,
                instanceKey,
                databaseName,
                databaseUrl,
                baseUrl,
            }

            await this.runPluginHook(plugins, 'onReady', {
                runtime,
            })

            return runtime
        } catch (error) {
            const normalizedError = normalizeError(error)
            if (bootstrapAsyncErrors.length > 0) {
                const asyncFailure =
                    buildBootstrapAsyncFailure(bootstrapAsyncErrors)
                normalizedError.message = `${normalizedError.message} | ${asyncFailure.message}`
            }

            await this.runPluginHook(plugins, 'onError', {
                instanceKey,
                error: normalizedError,
                databaseName: databaseName.length > 0 ? databaseName : undefined,
                databaseUrl: databaseUrl.length > 0 ? databaseUrl : undefined,
                postgresContainer: postgresContainer ?? undefined,
            }).catch(() => undefined)

            if (app) await app.close().catch(() => undefined)
            if (moduleRef) await moduleRef.close().catch(() => undefined)
            if (runtimePool) await runtimePool.end().catch(() => undefined)

            if (postgresContainer && databaseName.length > 0) {
                await this.dropRuntimeDatabase(
                    postgresContainer,
                    databaseName
                ).catch(() => undefined)
            }

            if (postgresContainer) {
                await this.releaseSharedPostgresContainer().catch(
                    () => undefined
                )
            }

            if (runtimeEnvSnapshot) {
                this.restoreRuntimeEnv(runtimeEnvSnapshot)
                this.runtimeEnvSnapshotsByKey.delete(instanceKey)
            }

            throw normalizedError
        } finally {
            process.off('unhandledRejection', onUnhandledRejection)
            process.off('uncaughtException', onUncaughtException)
        }
    }
}
