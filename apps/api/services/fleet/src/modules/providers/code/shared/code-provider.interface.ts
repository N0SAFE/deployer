/**
 * CodeProvider — the contract every CODE source provider answers.
 *
 * A provider turns a deployment trigger into a typed checkout context, as an Effect. The registry
 * dispatches on the key a provider is registered under, so a provider carries no type key of its own.
 *
 * The requirement channel is written ONCE, as the union of what any provider may yield. It used to be
 * a type parameter (`CodeProvider<R>`) with four instantiations, each naming exactly one tag — a
 * generic whose every instantiation is spelled out is an alias with extra steps
 * (`docs/architecture/service-implementation-rule.md`). A provider that reads nothing satisfies this
 * contract as it stands.
 */
import type { Effect } from 'effect'

import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import type { Git } from '@/core/ports/git.port'

import type { DeploymentSourceCheckoutContext } from '../../base/source-provider.interface'
import type { UploadBundleRegistryService } from '../upload/services/upload-bundle-registry.service'

/** Everything a CODE source provider may read from the Effect context while it resolves. */
export type CodeProviderRequirements = Git | UploadBundleRegistryService

export type CodeProvider = {
    /**
     * THE shared method: resolve a deployment trigger into a typed checkout context. Answers null
     * when this provider does not handle the trigger.
     */
    resolveSourceCheckout(
        input: DeploymentTriggerInput
    ): Effect.Effect<
        DeploymentSourceCheckoutContext | null,
        unknown,
        CodeProviderRequirements
    >
}
