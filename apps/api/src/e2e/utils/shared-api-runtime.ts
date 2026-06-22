import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll } from 'vitest'
import { appContract, setupContract } from '@repo/api-contracts'
import type { AnyContractRouter } from '@orpc/contract'
import type { Auth } from '@/auth'
import { AuthCoreService } from '@/core/modules/auth/services/auth-core.service'
import { SharedApiRuntimeManager } from './shared-api-runtime/manager'
import {
    resetSharedRuntimeRequestOverride,
    setSharedRuntimeAuthHeaders,
    setSharedRuntimeRequestOverride,
} from './shared-api-runtime/request-override'
import {
    createSharedOrpcResponseTracker,
    createSharedRuntimeOrpcClient,
} from './shared-api-runtime/orpc'
import type {
    ClassConstructor,
    SharedApiRuntime,
    SharedApiRuntimeContext,
    SharedApiRuntimeOptions,
    SharedRuntimeOrpcClient,
    SharedRuntimeOrpcClientOptions,
    SharedRuntimeServiceMapper,
} from './shared-api-runtime/types'
import { resolveSharedRuntimeMaxConcurrency } from './shared-api-runtime/types'

const sharedRuntimeManager = new SharedApiRuntimeManager()
const runtimeContextPromisesByKey = new Map<string, Promise<SharedApiRuntimeContext>>()

function resolveDefaultRuntimeKey(): string {
    const workerKey = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID
    if (workerKey && workerKey.length > 0) {
        return `worker-${workerKey}`
    }

    return 'default'
}

function resolveRuntimeKey(options?: SharedApiRuntimeOptions): string {
    if (options?.instanceKey && options.instanceKey.length > 0) {
        return options.instanceKey
    }

    return resolveDefaultRuntimeKey()
}

function createServiceMapper(runtime: SharedApiRuntime): SharedRuntimeServiceMapper {
    return {
        get<T>(service: ClassConstructor<T>): T {
            return runtime.moduleRef.get<T>(service)
        },
    }
}

async function buildSharedApiRuntimeContext(
    options?: SharedApiRuntimeOptions,
): Promise<SharedApiRuntimeContext> {
    const runtime = await sharedRuntimeManager.getRuntime(options)
    const serviceMapper = createServiceMapper(runtime)
    const betterAuth = serviceMapper.get(AuthCoreService).instance
    const tracker = createSharedOrpcResponseTracker()

    return {
        runtime,
        orpc: createSharedRuntimeOrpcClient(appContract, runtime, {
            tracker,
        }),
        http: request(runtime.app.getHttpServer()),
        betterAuth,
        serviceMapper,
        orpcTracker: tracker,
    }
}

export {
    setSharedRuntimeRequestOverride,
    setSharedRuntimeAuthHeaders,
    resetSharedRuntimeRequestOverride,
    createSharedRuntimeOrpcClient,
}

export type {
    SharedApiRuntime,
    SharedApiRuntimeContext,
    SharedApiRuntimeOptions,
    SharedRuntimeOrpcClient,
    SharedRuntimeOrpcClientOptions,
}

export interface DescribeSharedRuntimeScope {
    instanceKey: string
    getRuntime(): SharedApiRuntime
    getContext(): SharedApiRuntimeContext
}

export function useDescribeSharedApiRuntime(
    options: SharedApiRuntimeOptions = {},
): DescribeSharedRuntimeScope {
    const instanceKey =
        options.instanceKey && options.instanceKey.length > 0
            ? options.instanceKey
            : `describe-${resolveDefaultRuntimeKey()}-${randomUUID()}`

    const scopedOptions: SharedApiRuntimeOptions = {
        ...options,
        instanceKey,
    }

    let context: SharedApiRuntimeContext | null = null

    beforeAll(async () => {
        context = await getSharedApiRuntimeContext(scopedOptions)
    })

    afterAll(async () => {
        await stopSharedApiRuntime(scopedOptions)
        context = null
    })

    return {
        instanceKey,
        getRuntime(): SharedApiRuntime {
            if (!context) {
                throw new Error(
                    `Shared runtime not initialized for describe instance '${instanceKey}'. Access it inside tests or after beforeAll.`
                )
            }
            return context.runtime
        },
        getContext(): SharedApiRuntimeContext {
            if (!context) {
                throw new Error(
                    `Shared runtime context not initialized for describe instance '${instanceKey}'. Access it inside tests or after beforeAll.`
                )
            }
            return context
        },
    }
}

export { resolveSharedRuntimeMaxConcurrency }

export async function createSharedSetupOrpcClient(
    options?: SharedRuntimeOrpcClientOptions,
    runtimeOptions?: SharedApiRuntimeOptions,
): Promise<SharedRuntimeOrpcClient<typeof setupContract>> {
    const runtime = await getSharedApiRuntime(runtimeOptions)
    return createSharedRuntimeOrpcClient(setupContract, runtime, options)
}

export async function getSharedApiRuntime(
    options?: SharedApiRuntimeOptions,
): Promise<SharedApiRuntime> {
    return await sharedRuntimeManager.getRuntime(options)
}

export async function getSharedApiRuntimeContext(
    options?: SharedApiRuntimeOptions,
): Promise<SharedApiRuntimeContext> {
    const key = resolveRuntimeKey(options)
    const existing = runtimeContextPromisesByKey.get(key)
    if (existing) {
        return await existing
    }

    const contextPromise = buildSharedApiRuntimeContext(options)
    runtimeContextPromisesByKey.set(key, contextPromise)

    try {
        return await contextPromise
    } catch (error) {
        runtimeContextPromisesByKey.delete(key)
        throw error
    }
}

export async function stopSharedApiRuntime(
    options?: SharedApiRuntimeOptions,
): Promise<void> {
    const key = resolveRuntimeKey(options)
    runtimeContextPromisesByKey.delete(key)
    await sharedRuntimeManager.stopRuntime(options)
}

export async function stopAllSharedApiRuntimes(): Promise<void> {
    runtimeContextPromisesByKey.clear()
    await sharedRuntimeManager.stopAllRuntimes()
}
