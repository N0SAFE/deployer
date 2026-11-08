import { Context, Effect } from 'effect'

import type { DeploymentSourceCheckoutContext } from '@deployer/contracts-entities'
import type { ServiceLifecycleShape } from '@deployer/nest-effect'
import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import type { CodeProviderShape } from './code-provider.interface'
import type { RuntimeInvalid } from '../../../../core/runtime.errors'

export type CodeProviderRegistryShape = ServiceLifecycleShape & {
    /** Registered provider types (e.g. ["github", "upload", "custom"]). */
    readonly listProviderTypes: () => Effect.Effect<string[]>
    /** The adapter for a source type, or null when unsupported. */
    readonly getProvider: (
        sourceType: string
    ) => Effect.Effect<CodeProviderShape | null>
    /** Shared dispatch: null when no provider handles the source type. */
    readonly resolveSourceCheckout: (
        input: DeploymentTriggerInput
    ) => Effect.Effect<DeploymentSourceCheckoutContext | null, RuntimeInvalid>
}

export class CodeProviderRegistry extends Context.Service<
    CodeProviderRegistry,
    CodeProviderRegistryShape
>()('runtime/CodeProviderRegistry') {}

/** The registry over the collected providers; a later provider of the same type overwrites (and logs it). */
export function makeCodeProviderRegistry(
    providers: readonly CodeProviderShape[]
): CodeProviderRegistryShape {
    const providersByType = new Map<string, CodeProviderShape>()
    const overwritten: string[] = []
    for (const provider of providers) {
        const key = provider.sourceType.toLowerCase()
        if (providersByType.has(key)) overwritten.push(key)
        providersByType.set(key, provider)
    }
    const getProvider: CodeProviderRegistryShape['getProvider'] = (
        sourceType
    ) =>
        Effect.sync(() => providersByType.get(sourceType.toLowerCase()) ?? null)

    return {
        listProviderTypes: () => Effect.sync(() => [...providersByType.keys()]),
        getProvider,
        resolveSourceCheckout: (input) =>
            Effect.flatMap(getProvider(input.source.sourceType), (provider) =>
                provider
                    ? provider.resolveSourceCheckout(input)
                    : Effect.succeed(null)
            ),
        onModuleInit: () =>
            Effect.gen(function* () {
                for (const key of overwritten) {
                    yield* Effect.logWarning(
                        `CodeProvider '${key}' registered twice, the last one wins`
                    )
                }
                yield* Effect.logInfo(
                    `Code provider registry initialized: ${[...providersByType.keys()].join(', ')}`
                )
            }),
    }
}
