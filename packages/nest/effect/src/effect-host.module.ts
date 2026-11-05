import { createGlobalModule } from './create-module-context'
import { EffectHost, effectHostProvider } from './effect-host'

/**
 * The process-wide `EffectHost`.
 *
 * Global on purpose: the oRPC host injects it from inside its own module factory (`extraContext.inject: [EffectHost]`),
 * and a provider declared in the root is not visible to an imported module's factory. Exporting it globally is what lets
 * one host serve the transport, the adapters and the loops without each module re-providing (and stopping) its own.
 */
export class EffectHostModule extends createGlobalModule({
    providers: [effectHostProvider()],
    exports: [EffectHost],
}) {}
