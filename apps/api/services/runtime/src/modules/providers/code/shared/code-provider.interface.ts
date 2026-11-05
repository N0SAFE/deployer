/**
 * CodeProvider — the contract of a CODE source provider, as a shape.
 *
 * Concrete providers are constants/factories over this shape, each under its own tag, and the module
 * collects them under `CODE_PROVIDERS`. `CodeProviderRegistry` dispatches by `sourceType`.
 */
import type { Effect } from 'effect'

import type { DeploymentSourceCheckoutContext } from '@deployer/contracts-entities'
import type { DeploymentTriggerInput } from '@deployer/runtime-contracts/modules/deployment/crud'

import type { RuntimeInvalid } from '../../../../core/runtime.errors'

export type CodeProviderShape = {
    /** Dispatch key (lowercase): "github" | "gitlab" | "upload" | "custom" | ... */
    readonly sourceType: string
    /**
     * THE shared method: resolve a deployment trigger into a typed checkout context.
     * Succeeds with null when this provider does not handle the trigger.
     */
    readonly resolveSourceCheckout: (
        input: DeploymentTriggerInput
    ) => Effect.Effect<DeploymentSourceCheckoutContext | null, RuntimeInvalid>
}

/** Injection token for every registered provider, as one collection the registry dispatches over. */
export const CODE_PROVIDERS = 'runtime/CodeProviders'

/** True when the trigger targets this provider type. */
export function matchesSourceType(
    sourceType: string,
    input: DeploymentTriggerInput
): boolean {
    return input.source.sourceType.toLowerCase() === sourceType.toLowerCase()
}
