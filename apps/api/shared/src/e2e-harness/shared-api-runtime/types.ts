import type { INestApplication, Type } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import type { AnyContractRouter, ContractRouterClient } from '@orpc/contract'
import type { AppContract } from '../../core/orpc/app-contract'
import type { Pool } from 'pg'
import type request from 'supertest'
import type { Auth } from '../../auth'

export type SharedPostgresContainerHandle = {
    getConnectionUri(): string
    // `unknown`, not `void`: testcontainers' StartedPostgreSqlContainer.stop()
    // resolves to StoppedTestContainer, which is not assignable to Promise<void>.
    stop(): Promise<unknown>
}

/**
 * What `overrideProvider(...)` returns. Nest applies `.useValue(...)` on the
 * override handle, not on the builder itself — modelling it as a direct builder
 * method made `TestingModuleBuilder` structurally incompatible.
 */
export type RuntimeModuleBuilderOverride = {
    useValue(value: unknown): RuntimeModuleBuilder
}

export type RuntimeModuleBuilder = {
    overrideProvider(token: unknown): RuntimeModuleBuilderOverride
    setLogger(logger: unknown): RuntimeModuleBuilder
    compile(): Promise<TestingModule>
}

export type SharedApiRuntime = {
    app: INestApplication
    moduleRef: TestingModule
    postgresContainer: SharedPostgresContainerHandle
    runtimePool: Pool
    instanceKey: string
    databaseName: string
    databaseUrl: string
    baseUrl: string
}

export type SharedRuntimeDatabaseContext = {
    instanceKey: string
    databaseName: string
    databaseUrl: string
    postgresContainer: SharedPostgresContainerHandle
}

export type SharedRuntimeNestModuleBuilderContext = {
    moduleBuilder: RuntimeModuleBuilder
} & SharedRuntimeDatabaseContext

export type SharedRuntimeNestModuleCompiledContext = {
    moduleRef: TestingModule
    moduleBuilder: RuntimeModuleBuilder
} & SharedRuntimeDatabaseContext

export type SharedRuntimeNestAppInitContext = {
    app: INestApplication
    moduleRef: TestingModule
    moduleBuilder: RuntimeModuleBuilder
} & SharedRuntimeDatabaseContext

export type SharedRuntimeContainerContext = {
    instanceKey: string
    postgresContainer: SharedPostgresContainerHandle
}

export type SharedRuntimeEnvironmentContext = {
    env: Record<string, string>
} & SharedRuntimeDatabaseContext

export type SharedRuntimeReadyContext = {
    runtime: SharedApiRuntime
}

export type SharedRuntimeErrorContext = {
    instanceKey: string
    error: Error
    databaseName?: string
    databaseUrl?: string
    postgresContainer?: SharedPostgresContainerHandle
}

export type SharedRuntimePlugin = {
    name: string
    onContainerReady?: (context: SharedRuntimeContainerContext) => Promise<void> | void
    onDatabaseCreated?: (context: SharedRuntimeDatabaseContext) => Promise<void> | void
    onEnvironmentPrepared?: (context: SharedRuntimeEnvironmentContext) => Promise<void> | void
    onModuleBuilder?: (context: SharedRuntimeNestModuleBuilderContext) => Promise<void> | void
    onModuleCompiled?: (context: SharedRuntimeNestModuleCompiledContext) => Promise<void> | void
    onAppInit?: (context: SharedRuntimeNestAppInitContext) => Promise<void> | void
    onReady?: (context: SharedRuntimeReadyContext) => Promise<void> | void
    onError?: (context: SharedRuntimeErrorContext) => Promise<void> | void
}

export type SharedRuntimeDatabaseOptions = {
    name?: string
    onDatabaseCreate?: (context: SharedRuntimeDatabaseContext) => Promise<void> | void
}

export type SharedRuntimeNestOptions = {
    /**
     * Which Nest module to boot.
     *
     * Defaults to the monolith's `@/app.module`. A service's e2e suite passes its own
     * (`./app.module` relative to that service) so the test boots the app that ships,
     * rather than a monolith that no longer contains the domain under test.
     */
    /**
     * The Nest module to boot, as a CLASS.
     *
     * A loader returning the class (rather than a `{ AppModule }` namespace object) because
     * every app names its root differently — `AppModule`, `FleetServiceModule`, … — and
     * forcing a common export name would be a convention that exists only for the harness.
     */
    rootModuleLoader?: () => Promise<Type<unknown>>
    onModuleBuilder?: (context: SharedRuntimeNestModuleBuilderContext) => Promise<void> | void
    onModuleCompiled?: (context: SharedRuntimeNestModuleCompiledContext) => Promise<void> | void
    onAppInit?: (context: SharedRuntimeNestAppInitContext) => Promise<void> | void
}

export type SharedApiRuntimeOptions = {
    instanceKey?: string
    database?: SharedRuntimeDatabaseOptions
    nest?: SharedRuntimeNestOptions
    plugins?: SharedRuntimePlugin[]
}

export type SharedRuntimeRequestOverride = {
    headers: Record<string, string | string[]>
    method: string
    url: string
}

export type SharedRuntimeOrpcClientOptions = {
    headers?: Record<string, string>
    tracker?: SharedOrpcResponseTracker
}

export type ClassConstructor<T> = abstract new (...args: never[]) => T

export type SharedRuntimeServiceMapper = {
    get<T>(service: ClassConstructor<T>): T
}

export type SharedApiRuntimeContext = {
    runtime: SharedApiRuntime
    orpc: SharedRuntimeOrpcClient<AppContract>
    http: ReturnType<typeof request>
    betterAuth: Auth
    serviceMapper: SharedRuntimeServiceMapper
    orpcTracker: SharedOrpcResponseTracker
}

export type SharedOrpcResponseMeta = {
    requestUrl: string
    requestMethod: string
    responseUrl: string
    status: number
    ok: boolean
    redirected: boolean
    headers: Record<string, string>
}

export type SharedOrpcResponseTracker = {
    record(meta: SharedOrpcResponseMeta): void
    clear(): void
    getLast(): SharedOrpcResponseMeta | null
    getAll(): SharedOrpcResponseMeta[]
}

export type SharedRuntimeOrpcInspector = {
    clear(): void
    getLastResponse(): SharedOrpcResponseMeta | null
    getAllResponses(): SharedOrpcResponseMeta[]
}

export type SharedRuntimeOrpcClient<TContract extends AnyContractRouter> = ContractRouterClient<TContract>

export const DEFAULT_SHARED_RUNTIME_KEY = 'default'
export const SHARED_RUNTIME_MAX_CONCURRENCY_ENV =
    'E2E_SHARED_RUNTIME_MAX_CONCURRENCY'
export const SHARED_POSTGRES_CONNECTION_URI_ENV =
    'E2E_SHARED_POSTGRES_CONNECTION_URI'

export function resolveSharedRuntimeMaxConcurrency(
    fallback = 4,
): number {
    const raw = process.env[SHARED_RUNTIME_MAX_CONCURRENCY_ENV]
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN

    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback
    }

    return parsed
}
