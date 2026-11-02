import { Context, Effect, Fiber } from "effect";

import { EffectRuntime } from "./effect-runtime";

import type { FactoryProvider } from "@nestjs/common";

/**
 * The one place a process starts Effect work that is not a request.
 *
 * A loop, a reconciler, an event subscriber or a one-shot boot task needs a fiber on the application runtime. Doing that
 * with `@Inject(EffectRuntime)` couples the adapter to a Nest class and scatters "who forked this, and can it be stopped?"
 * across the codebase. `EffectHost` is that capability as a service:
 *
 * - the adapter declares the *work* (`Effect<never, never>`), not the runtime;
 * - the host owns forking and interruption, so shutdown is one call per fiber and no adapter leaks one;
 * - a spec substitutes the host with a fake that records the programs instead of running them.
 *
 * It is deliberately thin: the runtime still exists (something has to own the `ManagedRuntime`), but it is injected in
 * exactly one provider (`effectHostProvider`) instead of at every call site.
 */
export type EffectHostShape = {
	/** Run a program to completion on the app runtime. For a boot task or a Promise caller that already holds an Effect. */
	readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
	/** Run a program to completion, rejecting with the original failure value rather than a fiber wrapper. */
	readonly runUnwrapped: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
	/**
	 * Fork a long-lived program. The returned function interrupts it and resolves when the fiber is done, so a module's
	 * `onApplicationShutdown` (or `onModuleDestroy`) can await it.
	 */
	readonly fork: <E, R>(label: string, effect: Effect.Effect<void, E, R>) => () => Promise<void>;
	/** The app-wide Effect context, for a boundary that builds a per-call context (oRPC over a websocket, a worker). */
	readonly context: () => Promise<Context.Context<unknown>>;
	/**
	 * The context of the module that owns a controller: what a request may reach. The oRPC host passes the controller
	 * class, so a handler sees exactly what its module declares — the same rule the requirement audit enforces.
	 */
	readonly contextFor: (controller: unknown) => Context.Context<unknown>;
	/** Fibers currently alive, for the shutdown log and for tests. */
	readonly size: () => number;
};

export class EffectHost extends Context.Service<EffectHost, EffectHostShape>()("effect/Host") {}

/** Build the host over the app runtime; the module provides it once. */
type AnyFiber = ReturnType<EffectRuntime["runFork"]>;

export function makeEffectHost(runtime: EffectRuntime): EffectHostShape {
	const live = new Map<string, AnyFiber>();

	const remove = (label: string, fiber: AnyFiber) => () => {
		live.delete(label);
		return Effect.runPromise(Fiber.interrupt(fiber)).then(
			() => undefined,
			() => undefined,
		);
	};

	return {
		run: (effect) => runtime.runPromise(effect),
		context: () => runtime.context(),
		contextFor: (controller) => runtime.contextFor(controller),
		runUnwrapped: (effect) => runtime.runPromiseUnwrapped(effect),
		fork: (label, effect) => {
			const fiber = runtime.runFork(effect as Effect.Effect<void>);
			live.set(label, fiber);
			return remove(label, fiber);
		},
		size: () => live.size,
	};
}

/**
 * The Nest provider tuple a module adds to `providers`.
 *
 * ```ts
 * export class GithubModule extends createModuleContext({
 *   providers: [effectHostProvider(), GithubPreviewLoop],
 *   …
 * })
 * ```
 */
export function effectHostProvider(): FactoryProvider {
	return { provide: EffectHost, useFactory: makeEffectHost, inject: [EffectRuntime] };
}
