import { Context, Effect } from 'effect'
import z from 'zod/v4'

import { customSourceCheckoutContextSchema } from '@deployer/contracts-entities'
import {
    resolveRuntimeRunnerKind,
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from '@deployer/contracts-entities'

import { RuntimeInvalid } from '../../../../../core/runtime.errors'
import {
    matchesSourceType,
    type CodeProviderShape,
} from '../../shared/code-provider.interface'

const customSourceContextSchema = z.object({
    sourceType: z.literal('custom'),
    customData: z
        .object({
            containerImage: z.string().min(1),
            containerName: z.string().min(1).optional(),
            runtimeRunner: z.string().min(1).optional(),
            networkMode: z.string().min(1).optional(),
            cpuShares: z.number().positive().optional(),
            memoryLimitBytes: z.number().positive().optional(),
            healthCheckMaxRetries: z.number().int().positive().optional(),
            healthCheckRetryIntervalMs: z.number().int().positive().optional(),
            runtimeRunnerOptions: runtimeRunnerOptionsSchema.optional(),
        })
        .loose(),
})

function buildRuntimeRunnerOptionsFallback(input: {
    runtimeRunnerOptions?: RuntimeRunnerOptions
    runtimeRunner?: string
    containerName?: string
    networkMode?: string
    cpuShares?: number
    memoryLimitBytes?: number
    healthCheckMaxRetries?: number
    healthCheckRetryIntervalMs?: number
}): RuntimeRunnerOptions | null {
    if (input.runtimeRunnerOptions) {
        return input.runtimeRunnerOptions
    }

    const runner = resolveRuntimeRunnerKind(input.runtimeRunner)
    const options: Record<string, unknown> = {
        runner,
        ...(input.containerName ? { containerName: input.containerName } : {}),
        ...(input.networkMode ? { networkMode: input.networkMode } : {}),
        ...(typeof input.cpuShares === 'number'
            ? { cpuShares: input.cpuShares }
            : {}),
        ...(typeof input.memoryLimitBytes === 'number'
            ? { memoryLimitBytes: input.memoryLimitBytes }
            : {}),
        ...(typeof input.healthCheckMaxRetries === 'number'
            ? { healthCheckMaxRetries: input.healthCheckMaxRetries }
            : {}),
        ...(typeof input.healthCheckRetryIntervalMs === 'number'
            ? { healthCheckRetryIntervalMs: input.healthCheckRetryIntervalMs }
            : {}),
    }

    const parsed = runtimeRunnerOptionsSchema.safeParse(options)
    return parsed.success ? parsed.data : null
}

export class CustomSourceProvider extends Context.Service<
    CustomSourceProvider,
    CodeProviderShape
>()('runtime/CustomSourceProvider') {
    /** No ports: a constant a module provides with `useValue`. */
    static readonly live: CodeProviderShape = makeCustomSourceProvider()
}

export function makeCustomSourceProvider(): CodeProviderShape {
    const sourceType = 'custom'
    return {
        sourceType,
        resolveSourceCheckout: (input) =>
            Effect.gen(function* () {
                if (
                    !matchesSourceType(sourceType, input) ||
                    input.source.sourceType !== 'custom'
                ) {
                    return null
                }

                const parsed = customSourceContextSchema.safeParse(input.source)
                if (!parsed.success) {
                    return yield* new RuntimeInvalid({
                        reason: 'Custom/manual source requires source.customData.containerImage',
                    })
                }

                const details = parsed.data.customData
                const runtimeRunnerOptions = buildRuntimeRunnerOptionsFallback({
                    runtimeRunnerOptions: details.runtimeRunnerOptions,
                    runtimeRunner: details.runtimeRunner,
                    containerName: details.containerName,
                    networkMode: details.networkMode,
                    cpuShares: details.cpuShares,
                    memoryLimitBytes: details.memoryLimitBytes,
                    healthCheckMaxRetries: details.healthCheckMaxRetries,
                    healthCheckRetryIntervalMs:
                        details.healthCheckRetryIntervalMs,
                })

                return customSourceCheckoutContextSchema.parse({
                    provider: 'custom',
                    containerImage: details.containerImage,
                    ...(details.containerName
                        ? { containerName: details.containerName }
                        : {}),
                    ...(details.runtimeRunner
                        ? { runtimeRunner: details.runtimeRunner }
                        : {}),
                    ...(details.networkMode
                        ? { networkMode: details.networkMode }
                        : {}),
                    ...(typeof details.cpuShares === 'number'
                        ? { cpuShares: details.cpuShares }
                        : {}),
                    ...(typeof details.memoryLimitBytes === 'number'
                        ? { memoryLimitBytes: details.memoryLimitBytes }
                        : {}),
                    ...(typeof details.healthCheckMaxRetries === 'number'
                        ? {
                              healthCheckMaxRetries:
                                  details.healthCheckMaxRetries,
                          }
                        : {}),
                    ...(typeof details.healthCheckRetryIntervalMs === 'number'
                        ? {
                              healthCheckRetryIntervalMs:
                                  details.healthCheckRetryIntervalMs,
                          }
                        : {}),
                    ...(runtimeRunnerOptions ? { runtimeRunnerOptions } : {}),
                })
            }),
    }
}
