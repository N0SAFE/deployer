import {
  Inject,
  Injectable,
  Optional,
  type InjectionToken,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { DiscoveryService, ModulesContainer } from "@nestjs/core";
import { Cause, Context, type Effect, Exit, Layer, ManagedRuntime } from "effect";

import { collectEffectLayer } from "./collect-effect-layer";
import { EFFECT_RUNTIME_LAYERS } from "./effect-runtime.token";

import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import type { Module as NestModuleRef } from "@nestjs/core/injector/module";

/**
 * Bridge between the two containers.
 *
 * NestJS owns construction and lifecycle; Effect owns composition. Two ways to read the context:
 *
 * - `context()` — the whole container, for seeds, boot code and `runPromise` callers that are not a request;
 * - `contextFor(controller)` — the module that owns the controller: its providers, its imports' **exports**, and the
 *   exports of every global module. Same rule the type audit enforces, answered from Nest's own graph.
 */
@Injectable()
export class EffectRuntime implements OnApplicationShutdown {
  private runtime: ManagedRuntime.ManagedRuntime<unknown, never> | undefined;
  private readonly scopes = new Map<
    unknown,
    { context: Context.Context<unknown>; tokens: Set<InjectionToken> }
  >();

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(ModulesContainer) private readonly modules: ModulesContainer,
    @Optional()
    @Inject(EFFECT_RUNTIME_LAYERS)
    private readonly layers: readonly unknown[] = [],
  ) {}

  /**
   * The app-wide Effect context.
   *
   * Built once, over the complete container, and cached. The oRPC host asks for it while it is still registering routes,
   * before every provider exists; that call gets the discovered services only (no contributed Layer runs, so none can
   * trip over a provider that is not there yet) and nothing is cached, so the first call after startup builds the real
   * one.
   */
  context(): Promise<Context.Context<unknown>> {
    return this.runtimeFor().context();
  }

  /**
   * The context of the module that owns `controller`.
   *
   * This is the request context: a handler can only reach what its module can see, which is what `UnmetOf` already
   * claims at compile time. Falls back to the whole container when the app contributed Layers, since those are
   * composed app-wide and cannot be attributed to one module.
   */
  contextFor(controller: unknown): Context.Context<unknown> {
    if (this.layers.length > 0) {
      // ponytail: contributed Layers are app-wide; scope them per module when a service actually needs it.
      return this.appContext();
    }

    const owner = this.ownerOf(controller);
    return owner === undefined ? (Context.empty() as Context.Context<unknown>) : this.scopeOf(owner).context;
  }

  /**
   * What each controller can reach today that its module cannot: the migration report.
   *
   * Before scoping, every provider was in one context. This lists, per controller, the services registered in the
   * container but outside the controller's module scope — the ones that will start failing when the runtime is flipped,
   * and that the type audit already reports as `Missing`.
   */
  scopeReport(): { controller: string; outOfScope: string[] }[] {
    const all = new Set<InjectionToken>();
    for (const module of this.modules.values()) {
      for (const token of module.providers.keys()) {
        if (Context.isKey(token)) all.add(token);
      }
    }

    const report: { controller: string; outOfScope: string[] }[] = [];

    for (const module of this.modules.values()) {
      const visible = this.scopeOf(module).tokens;
      const outOfScope = [...all]
        .filter((token) => !visible.has(token))
        .map(tokenName)
        .sort();

      if (outOfScope.length === 0) continue;

      for (const wrapper of module.controllers.values()) {
        report.push({ controller: tokenName(wrapper.metatype), outOfScope });
      }
    }

    return report;
  }

  /**
   * Promise boundary for handlers that are not written with `.effect()`.
   * Prefer yielding services inside an Effect program and calling this once.
   */
  runPromise<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    return this.runtimeFor().runPromise(effect);
  }

  /**
   * A fiber on the app runtime, for work that outlives a request: a loop, a reconciler, a subscriber.
   *
   * Prefer `EffectHost` (`@deployer/nest-effect`), which wraps this behind a service so an adapter never injects the
   * Nest class itself and the whole process shares one place that starts and stops fibers.
   */
  runFork<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return this.runtimeFor().runFork(effect);
  }

  /**
   * `runPromise` for callers that match on the failure: it rejects with the ORIGINAL failure value
   * (a typed error, a Nest exception) instead of a fiber wrapper.
   */
  async runPromiseUnwrapped<A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> {
    const exit = await this.runtimeFor().runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime?.dispose();
    this.runtime = undefined;
    this.scopes.clear();
  }

  private ownerOf(controller: unknown): NestModuleRef | undefined {
    for (const module of this.modules.values()) {
      for (const wrapper of module.controllers.values()) {
        if (wrapper.metatype === controller) {
          return module;
        }
      }
    }

    return undefined;
  }

  private scopeOf(module: NestModuleRef): {
    context: Context.Context<unknown>;
    tokens: Set<InjectionToken>;
  } {
    const cached = this.scopes.get(module.metatype);
    if (cached !== undefined) return cached;

    const scope = this.buildScope(module);
    this.scopes.set(module.metatype, scope);
    return scope;
  }

  private buildScope(module: NestModuleRef): {
    context: Context.Context<unknown>;
    tokens: Set<InjectionToken>;
  } {
    const tokens = new Set<InjectionToken>();
    let context = Context.empty() as Context.Context<unknown>;

    const add = (wrapper: InstanceWrapper<unknown>): void => {
      if (wrapper.instance === undefined) return;
      if (!Context.isKey(wrapper.token)) return;
      if (tokens.has(wrapper.token)) return;

      tokens.add(wrapper.token);
      context = Context.add(context, wrapper.token as never, wrapper.instance as never);
    };

    for (const wrapper of module.providers.values()) add(wrapper);
    for (const imported of module.imports) for (const wrapper of this.exportedBy(imported)) add(wrapper);
    for (const candidate of this.modules.values()) {
      if (candidate.isGlobal) for (const wrapper of this.exportedBy(candidate)) add(wrapper);
    }

    return { context, tokens };
  }

  /**
   * The provider instances a module hands upward: its `exports`, plus the exports of the modules it re-exports.
   *
   * Nest stores `exports` as tokens, so a token that is not one of the module's own providers is a re-exported module
   * or a token this module does not own; the former is resolved, the latter ignored rather than guessed.
   */
  private exportedBy(module: NestModuleRef, seen = new Set<NestModuleRef>()): InstanceWrapper<unknown>[] {
    if (seen.has(module)) return [];
    seen.add(module);

    const exported: InstanceWrapper<unknown>[] = [];

    for (const token of module.exports) {
      const own = module.providers.get(token);
      if (own !== undefined) {
        exported.push(own);
        continue;
      }

      if (typeof token === "function") {
        const reExported = (this.modules as unknown as Map<unknown, NestModuleRef>).get(token);
        if (reExported !== undefined) exported.push(...this.exportedBy(reExported, seen));
      }
    }

    return exported;
  }

  private appContext(): Context.Context<unknown> {
    return this.runtimeFor().context() as unknown as Context.Context<unknown>;
  }

  private runtimeFor(): ManagedRuntime.ManagedRuntime<unknown, never> {
    if (this.runtime !== undefined) return this.runtime;

    const collected = collectEffectLayer(this.discovery);
    if (!collected.complete) {
      // Still starting: answer from what exists, and do not remember the answer.
      return ManagedRuntime.make(collected.layer);
    }

    this.runtime = ManagedRuntime.make(this.layer(collected.layer));
    return this.runtime;
  }

  /**
   * The discovered providers, plus any Layer the app contributed.
   *
   * A contributed Layer may depend on a discovered service (for example an
   * event bus that needs the stream pool), so it is built *over* the collected
   * layer rather than merged beside it.
   */
  private layer(discovered: Layer.Layer<unknown>): Layer.Layer<unknown> {
    if (this.layers.length === 0) {
      return discovered;
    }

    const contributed = (this.layers as readonly Layer.Layer<unknown, never, unknown>[]).reduce<
      Layer.Layer<unknown, never, unknown>
    >(
      (acc, layer) => Layer.merge(acc, layer),
      Layer.empty as unknown as Layer.Layer<unknown, never, unknown>,
    );
    return Layer.provideMerge(contributed, discovered);
  }
}

/** A token as a human reads it: the class name, the string, or the Effect key. */
function tokenName(token: unknown): string {
  if (typeof token === "function") return token.name;
  if (typeof token === "string") return token;
  if (typeof token === "object" && token !== null && "key" in token) {
    return String((token as { readonly key: unknown }).key);
  }

  return String(token);
}
