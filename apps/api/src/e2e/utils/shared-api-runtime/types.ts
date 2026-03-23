import type { INestApplication } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import type { AnyContractRouter, ContractRouterClient } from '@orpc/contract'
import type { AppContract } from '@repo/api-contracts'
import type { Pool } from 'pg'
import type request from 'supertest'
import type { Auth } from '@/auth'

export interface SharedPostgresContainerHandle {
    getConnectionUri(): string
    stop(): Promise<void>
}

export interface RuntimeModuleBuilder {
    overrideProvider(token: unknown): RuntimeModuleBuilder
    useValue(value: unknown): RuntimeModuleBuilder
    setLogger(logger: unknown): RuntimeModuleBuilder
    compile(): Promise<TestingModule>
}

export interface SharedApiRuntime {
    app: INestApplication
    moduleRef: TestingModule
    postgresContainer: SharedPostgresContainerHandle
    runtimePool: Pool
    instanceKey: string
    databaseName: string
    databaseUrl: string
    baseUrl: string
}

export interface SharedRuntimeDatabaseContext {
    instanceKey: string
    databaseName: string
    databaseUrl: string
    postgresContainer: SharedPostgresContainerHandle
}

export interface SharedRuntimeNestModuleBuilderContext extends SharedRuntimeDatabaseContext {
    moduleBuilder: RuntimeModuleBuilder
}

export interface SharedRuntimeNestModuleCompiledContext extends SharedRuntimeDatabaseContext {
    moduleRef: TestingModule
    moduleBuilder: RuntimeModuleBuilder
}

export interface SharedRuntimeNestAppInitContext extends SharedRuntimeDatabaseContext {
    app: INestApplication
    moduleRef: TestingModule
    moduleBuilder: RuntimeModuleBuilder
}

export interface SharedRuntimeContainerContext {
    instanceKey: string
    postgresContainer: SharedPostgresContainerHandle
}

export interface SharedRuntimeEnvironmentContext extends SharedRuntimeDatabaseContext {
    env: Record<string, string>
}

export interface SharedRuntimeReadyContext {
    runtime: SharedApiRuntime
}

export interface SharedRuntimeErrorContext {
    instanceKey: string
    error: Error
    databaseName?: string
    databaseUrl?: string
    postgresContainer?: SharedPostgresContainerHandle
}

export interface SharedRuntimePlugin {
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

export interface SharedRuntimeDatabaseOptions {
    name?: string
    onDatabaseCreate?: (context: SharedRuntimeDatabaseContext) => Promise<void> | void
}

export interface SharedRuntimeNestOptions {
    onModuleBuilder?: (context: SharedRuntimeNestModuleBuilderContext) => Promise<void> | void
    onModuleCompiled?: (context: SharedRuntimeNestModuleCompiledContext) => Promise<void> | void
    onAppInit?: (context: SharedRuntimeNestAppInitContext) => Promise<void> | void
}

export interface SharedApiRuntimeOptions {
    instanceKey?: string
    database?: SharedRuntimeDatabaseOptions
    nest?: SharedRuntimeNestOptions
    plugins?: SharedRuntimePlugin[]
}

export interface SharedRuntimeRequestOverride {
    headers: Record<string, string | string[]>
    method: string
    url: string
}

export interface SharedRuntimeOrpcClientOptions {
    headers?: Record<string, string>
    tracker?: SharedOrpcResponseTracker
}

export type ClassConstructor<T> = abstract new (...args: never[]) => T

export interface SharedRuntimeServiceMapper {
    get<T>(service: ClassConstructor<T>): T
}

export interface SharedApiRuntimeContext {
    runtime: SharedApiRuntime
    orpc: SharedRuntimeOrpcClient<AppContract>
    http: ReturnType<typeof request>
    betterAuth: Auth
    serviceMapper: SharedRuntimeServiceMapper
    orpcTracker: SharedOrpcResponseTracker
}

export interface SharedOrpcResponseMeta {
    requestUrl: string
    requestMethod: string
    responseUrl: string
    status: number
    ok: boolean
    redirected: boolean
    headers: Record<string, string>
}

export interface SharedOrpcResponseTracker {
    record(meta: SharedOrpcResponseMeta): void
    clear(): void
    getLast(): SharedOrpcResponseMeta | null
    getAll(): SharedOrpcResponseMeta[]
}

export interface SharedRuntimeOrpcInspector {
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
