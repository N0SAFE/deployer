/**
 * Layers an app contributes to the runtime.
 *
 * Each side is `unknown[]` on purpose: the runtime erases the service/error/
 * requirement tuple when it composes, and the *typed* surface is the module
 * context that a controller uses.
 */
export const EFFECT_RUNTIME_LAYERS = Symbol("effect/runtime-layers");

export type EffectRuntimeModuleOptions = {
	/**
	 * Effect services built as Layers rather than Nest providers.
	 *
	 * A Nest provider must already be an instance, so a service that needs the
	 * Effect context to construct (an event bus that needs another service, a
	 * scope-managed resource) cannot be one. Pass its Layer here; the runtime
	 * composes it with the discovered providers and disposes it on shutdown.
	 */
	readonly layers?: readonly unknown[];
}
