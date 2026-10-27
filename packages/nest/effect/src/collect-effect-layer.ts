import type { DiscoveryService } from "@nestjs/core";
import { Context, Layer } from "effect";

type AnyEffectKey = Context.Key<unknown, unknown>;

/**
 * Collects every NestJS provider whose **token is an Effect service key**
 * (`Context.Service`) into one Layer.
 *
 * Convention over wiring: a feature module registers its implementation with
 * `{ provide: SomeEffectService, useClass: SomeImpl }` and the runtime picks it
 * up. Duplicate tokens are ignored.
 */
export function collectEffectLayer(discovery: DiscoveryService): Layer.Layer<unknown> {
  const registered = new Set<unknown>();
  let layer = Layer.empty as Layer.Layer<unknown>;

  for (const wrapper of discovery.getProviders()) {
    if (wrapper.instance === undefined) continue;
    if (!Context.isKey(wrapper.token)) continue;
    if (registered.has(wrapper.token)) continue;

    registered.add(wrapper.token);
    layer = Layer.merge(layer, Layer.succeed(wrapper.token as AnyEffectKey, wrapper.instance));
  }

  return layer;
}
