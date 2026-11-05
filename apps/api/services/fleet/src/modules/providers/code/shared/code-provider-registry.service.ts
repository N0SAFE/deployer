import { Context, Effect } from 'effect'

import {
    serviceOver,
    type Over,
    type RequirementsOf,
} from '@deployer/effect-core'
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

import type { CodeProvider } from './code-provider.interface'

/** The providers, by the lowercase source type the registry dispatches on. */
type RegisteredProviders = {
    readonly github: GithubSourceProviderServiceShape
    readonly gitlab: GitlabSourceProviderServiceShape
    readonly upload: UploadSourceProviderServiceShape
    readonly custom: CustomSourceProviderServiceShape
}

/** What a provider reads from the Effect context when its method runs. */
type ProviderRequirements = RequirementsOf<
    RegisteredProviders[keyof RegisteredProviders]
>

/**
 * The public API for source provider operations: callers invoke ONE shared method and the registry
 * resolves the right provider by source type. `registered` is the one place that names the providers,
 * so a new source type is one more entry there and nothing else changes.
 */
function makeCodeProviderRegistryService(registered: RegisteredProviders) {
    const providersByType = new Map<string, CodeProvider<ProviderRequirements>>(
        Object.entries(registered)
    )

    /** The provider for a source type, or null when unsupported (the trigger then resolves to no checkout). */
    const getProvider = (sourceType: string) =>
        providersByType.get(sourceType.toLowerCase()) ?? null

    return {
        /** Registered source types (e.g. ["github", "gitlab", "upload", "custom"]). */
        listProviderTypes: () => Effect.succeed([...providersByType.keys()]),

        // ─── Shared dispatch method ─────────────────────────────────────────────

        resolveSourceCheckout: Effect.fn(
            'CodeProviderRegistryService.resolveSourceCheckout'
        )(function* (input: DeploymentTriggerInput) {
            const provider = getProvider(input.source.sourceType)
            if (!provider) return null
            return yield* provider.resolveSourceCheckout(input)
        }),
    }
}

export type CodeProviderRegistryServiceShape = Over<
    ReturnType<typeof makeCodeProviderRegistryService>,
    | GithubSourceProviderService
    | GitlabSourceProviderService
    | UploadSourceProviderService
    | CustomSourceProviderService
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CodeProviderRegistryService extends Context.Service<
    CodeProviderRegistryService,
    CodeProviderRegistryServiceShape
>()('fleet/CodeProviderRegistryService') {
    /** The providers are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: CodeProviderRegistryServiceShape = serviceOver(
        Effect.all({
            github: GithubSourceProviderService,
            gitlab: GitlabSourceProviderService,
            upload: UploadSourceProviderService,
            custom: CustomSourceProviderService,
        }),
        makeCodeProviderRegistryService
    )
}
