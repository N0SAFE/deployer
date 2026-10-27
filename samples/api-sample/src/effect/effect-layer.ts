import type { DiscoveryService } from "@nestjs/core";
import { Context, Layer } from "effect";
import type { AppServices } from "./runtime";

/**
 * Convention over configuration: any NestJS provider whose **token is an
 * Effect service key** (`Context.Service`) is exposed to Effect with that same
 * instance.
 *
 * ```ts
 * providers: [{ provide: PlanetRepository, useClass: InMemoryPlanetRepository }]
 * ```
 *
 * That is the whole registration — no decorator, no layer token, no module
 * import. `Context.isKey` is what makes it safe to detect.
 */
export function collectEffectLayer(discovery: DiscoveryService): Layer.Layer<AppServices, never, never> {
  const registered = new Set<unknown>();
  let layer = Layer.empty as Layer.Layer<unknown, never, never>;

  for (const wrapper of discovery.getProviders()) {
    if (wrapper.instance === undefined) continue;
    if (!Context.isKey(wrapper.token)) continue;
    if (registered.has(wrapper.token)) continue;

    registered.add(wrapper.token);
    layer = Layer.merge(layer, Layer.succeed(wrapper.token, wrapper.instance));
  }

  // The only assertion: individual Layers are checked against their own keys,
  // discovery is dynamic so the final union cannot be derived by the compiler.
  return layer as unknown as Layer.Layer<AppServices, never, never>;
}
