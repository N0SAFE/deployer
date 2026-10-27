import type { DiscoveryService } from "@nestjs/core";
import { STATIC_CONTEXT } from "@nestjs/core/injector/constants";
import { Context, Layer } from "effect";

type AnyEffectKey = Context.Key<unknown, unknown>;

/** What was found in the container, and whether the container was finished when it was read. */
export type CollectedLayer = {
  readonly layer: Layer.Layer<unknown>;
  /** `false` while a static provider has not been instantiated yet (the application is still starting). */
  readonly complete: boolean;
};

/**
 * Collects every NestJS provider whose **token is an Effect service key**
 * (`Context.Service`) into one Layer.
 *
 * Convention over wiring: a feature module registers its implementation with
 * `{ provide: SomeEffectService, useClass: SomeImpl }` and the runtime picks it
 * up. Duplicate tokens are ignored.
 *
 * Read while the application is still starting, some providers exist only as `null`; the result is
 * then marked incomplete so the runtime does not cache a snapshot with holes in it.
 */
export function collectEffectLayer(discovery: DiscoveryService): CollectedLayer {
  const registered = new Set<unknown>();
  let layer = Layer.empty as Layer.Layer<unknown>;
  let complete = true;

  for (const wrapper of discovery.getProviders()) {
    if (!Context.isKey(wrapper.token)) continue;
    // Only Effect keys matter to the snapshot; Nest keeps unresolved internals of its own around.
    if (wrapper.isDependencyTreeStatic() && wrapper.getInstanceByContextId(STATIC_CONTEXT).isResolved === false) {
      complete = false;
    }
    if (wrapper.instance === undefined) continue;
    if (registered.has(wrapper.token)) continue;

    registered.add(wrapper.token);
    layer = Layer.merge(layer, Layer.succeed(wrapper.token as AnyEffectKey, wrapper.instance));
  }

  return { layer, complete };
}
