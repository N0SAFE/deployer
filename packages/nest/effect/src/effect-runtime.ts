import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { Context, type Effect, Layer, ManagedRuntime } from "effect";
import { collectEffectLayer } from "./collect-effect-layer";
import { EFFECT_RUNTIME_LAYERS } from "./effect-runtime.token";

/**
 * Bridge between the two containers.
 *
 * NestJS owns construction and lifecycle; Effect owns composition. The
 * ManagedRuntime is built **lazily, once** from the providers discovered in the
 * Nest container, then reused for every request.
 *
 * Generic-free on purpose: the app knows its service union, the runtime only
 * knows how to hand out the context. Cast once at the app boundary:
 *
 * ```ts
 * const effectContext = await runtime.context() as Context.Context<AppServices>;
 * ```
 */
@Injectable()
export class EffectRuntime implements OnApplicationShutdown {
  private runtime: ManagedRuntime.ManagedRuntime<unknown, never> | undefined;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Optional()
    @Inject(EFFECT_RUNTIME_LAYERS)
    private readonly layers: readonly unknown[] = [],
  ) {}

  /** Cached App-wide Effect context. */
  context(): Promise<Context.Context<unknown>> {
    return this.build().context();
  }

  /**
   * Promise boundary for handlers that are not written with `.effect()`.
   * Prefer yielding services inside an Effect program and calling this once.
   */
  runPromise<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    return this.build().runPromise(effect);
  }

  private build(): ManagedRuntime.ManagedRuntime<unknown, never> {
    this.runtime ??= ManagedRuntime.make(this.layer());
    return this.runtime;
  }

  /**
   * The discovered providers, plus any Layer the app contributed.
   *
   * A contributed Layer may depend on a discovered service (for example an
   * event bus that needs the stream pool), so it is built *over* the collected
   * layer rather than merged beside it.
   */
  private layer(): Layer.Layer<unknown> {
    const discovered = collectEffectLayer(this.discovery);
    if (this.layers.length === 0) {
      return discovered;
    }

    const contributed = (this.layers as readonly Layer.Layer<unknown, never, unknown>[]).reduce<
      Layer.Layer<unknown, never, unknown>
    >(
      (acc, layer) => Layer.merge(acc, layer),
      Layer.empty as unknown as Layer.Layer<unknown, never, unknown>,
    );
    return Layer.provideMerge(
      contributed,
      discovered,
    ) as Layer.Layer<unknown>;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime?.dispose();
    this.runtime = undefined;
  }
}
