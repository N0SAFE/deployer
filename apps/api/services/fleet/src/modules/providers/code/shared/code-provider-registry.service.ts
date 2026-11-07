import { Context, Effect } from 'effect'

import type { RequirementsOf } from '@deployer/effect-core'
import type { DeploymentSourceCheckoutContext } from '@deployer/contracts-entities'
import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import {
    CustomSourceProviderService,
    type CustomSourceProviderServiceShape,
} from '../custom/services/custom-source-provider.service'
import {
    GithubSourceProviderService,
    type GithubSourceProviderServiceShape,
} from '../github/services/github-source-provider.service'
import {
    GitlabSourceProviderService,
    type GitlabSourceProviderServiceShape,
} from '../gitlab/services/gitlab-source-provider.service'
import {
    UploadSourceProviderService,
    type UploadSourceProviderServiceShape,
} from '../upload/services/upload-source-provider.service'

/** The providers, by the lowercase source type the registry dispatches on. */
type RegisteredProviders = {
    readonly github: GithubSourceProviderServiceShape
    readonly gitlab: GitlabSourceProviderServiceShape
    readonly upload: UploadSourceProviderServiceShape
    readonly custom: CustomSourceProviderServiceShape
}

/**
 * What a provider reads from the Effect context when its method runs.
 *
 * Distributed over the union member by member: `RequirementsOf<A | B>` collapses to `never`,
 * because the mapped type reads `T[K]` across the union instead of each member in turn.
 */
type ProviderRequirements = {
    [K in keyof RegisteredProviders]: RequirementsOf<RegisteredProviders[K]>
}[keyof RegisteredProviders]
    // Each provider is itself a tag the dispatch yields before calling it.
    | GithubSourceProviderService
    | GitlabSourceProviderService
    | UploadSourceProviderService
    | CustomSourceProviderService

/**
 * The public API for source provider operations: callers invoke ONE shared method and the registry
 * resolves the right provider by source type. `providerFor` is the one place that names the providers,
 * so a new source type is one more branch there and nothing else changes.
 */
export type CodeProviderRegistryServiceShape = {
    /** Registered source types, in dispatch order (github, gitlab, upload, custom). */
    readonly listProviderTypes: () => Effect.Effect<string[]>
    /**
     * Resolve a trigger to a typed checkout context through the provider for its source type;
     * null when the type is unsupported (the trigger then resolves to no checkout).
     */
    readonly resolveSourceCheckout: (
        input: DeploymentTriggerInput
    ) => Effect.Effect<
        DeploymentSourceCheckoutContext | null,
        unknown,
        ProviderRequirements
    >
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CodeProviderRegistryService extends Context.Service<
    CodeProviderRegistryService,
    CodeProviderRegistryServiceShape
>()('fleet/CodeProviderRegistryService') {
    static readonly live = class CodeProviderRegistryServiceImpl
        implements CodeProviderRegistryServiceShape
    {
        listProviderTypes(): ReturnType<
            CodeProviderRegistryServiceShape['listProviderTypes']
        > {
            return Effect.succeed(['github', 'gitlab', 'upload', 'custom'])
        }

        resolveSourceCheckout(
            input: DeploymentTriggerInput
        ): ReturnType<
            CodeProviderRegistryServiceShape['resolveSourceCheckout']
        > {
            return Effect.gen(function* () {
                switch (input.source.sourceType) {
                    case 'github':
                        return yield* (
                            yield* GithubSourceProviderService
                        ).resolveSourceCheckout(input)
                    case 'gitlab':
                        return yield* (
                            yield* GitlabSourceProviderService
                        ).resolveSourceCheckout(input)
                    case 'upload':
                        return yield* (
                            yield* UploadSourceProviderService
                        ).resolveSourceCheckout(input)
                    case 'custom':
                        return yield* (
                            yield* CustomSourceProviderService
                        ).resolveSourceCheckout(input)
                    default:
                        return null
                }
            })
        }
    }
}
