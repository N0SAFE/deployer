/**
 * CodeProvider — the contract every CODE source provider answers.
 *
 * A provider turns a deployment trigger into a typed checkout context, as an Effect. `R` is what the
 * provider reads from the Effect context; the registry dispatches on the key the provider is
 * registered under, so a provider carries no type key of its own.
 */
import type { Effect } from "effect";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import type { DeploymentSourceCheckoutContext } from "../../base/source-provider.interface";

export type CodeProvider<R = never> = {
    /**
     * THE shared method: resolve a deployment trigger into a typed checkout context. Answers null
     * when this provider does not handle the trigger.
     */
    resolveSourceCheckout(
        input: DeploymentTriggerInput,
    ): Effect.Effect<DeploymentSourceCheckoutContext | null, unknown, R>;
};
