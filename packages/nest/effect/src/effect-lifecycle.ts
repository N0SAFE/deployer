import { Context, Effect } from "effect";

import { EffectHost, type EffectHostShape } from "./effect-host";

import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, Provider, Type } from "@nestjs/common";

/**
 * The lifecycle a service declares **in its shape**.
 *
 * A service that owns something with a lifetime — a listener, a poller, a file handle, a pool — states that lifetime
 * where it states everything else it does, and the implementation is then obliged to provide it. Nest's
 * `OnModuleInit` / `OnModuleDestroy` do not appear on the service at all: one generic runner binds the three members
 * below, so there is no per-service adapter class to forget to update.
 *
 * ```ts
 * export type OutboxDispatcherShape = ServiceLifecycleShape & {
 *   readonly dispatchPending: Effect.Effect<void, OutboxFailure>;
 * };
 *
 * export class OutboxDispatcher extends Context.Service<OutboxDispatcher, OutboxDispatcherShape>()("events/Outbox") {
 *   static readonly live = class … implements OutboxDispatcherShape {
 *     onStart = () => Effect.void;                      // once, before serving; must complete
 *     run = () => Effect.repeat(this.dispatchPending, Schedule.spaced("3 seconds"));  // forked; interrupted on stop
 *     onStop = () => Effect.void;                       // once, after the loop is interrupted
 *   };
 * }
 * ```
 *
 * The three members are optional because a service may need any one of them; `serviceLifecycle(tag)` refuses a shape
 * that declares none, so adding the provider is what forces the decision.
 */
export type ServiceLifecycleShape = {
	/** Runs once, before the app serves. A failure fails the boot — this is initialisation, not a background task. */
	readonly onStart?: () => Effect.Effect<void, unknown>;
	/**
	 * Runs once when EVERY module has finished initialising (Nest's `onApplicationBootstrap`), after all `onStart`s. Use it for
	 * what must see the other modules' start-up work (a drift control that converges what the modules registered). A failure
	 * fails the boot, like `onStart`.
	 */
	readonly onReady?: () => Effect.Effect<void, unknown>;
	/** Forked after `onStart`, expected to run until interrupted. The runner owns the fiber and interrupts it on stop. */
	readonly run?: () => Effect.Effect<void, unknown>;
	/** Runs once, after `run` is interrupted. Never fails the shutdown: a failure is logged. */
	readonly onStop?: () => Effect.Effect<void, unknown>;
};

/** A shape that declares at least one lifecycle member. */
type DeclaresLifecycle<S> = "onStart" extends keyof S
	? true
	: "run" extends keyof S
		? true
		: "onStop" extends keyof S
			? true
			: "onReady" extends keyof S
				? true
				: false;

/** The compile error `serviceLifecycle` produces for a shape with no lifecycle in it. */
type NoLifecycleInShape = {
	readonly "this tag declares no onStart / run / onStop in its shape, so there is nothing to bind": never;
};

/** One runner per service tag. `Symbol.for` keeps the token stable if the module is loaded twice. */
const lifecycleToken = (key: string): symbol => Symbol.for(`effect-lifecycle:${key}`);

/**
 * Runs one service's lifecycle from Nest's.
 *
 * `onModuleInit`: `onStart`, then fork `run`.
 * `onApplicationBootstrap`: `onReady`.
 * `onModuleDestroy`: interrupt `run`, then `onStop`.
 *
 * That order is the whole point: nothing stops while the work that uses it may still be running.
 */
export class ServiceLifecycleRunner implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
	private stopProgram: (() => Promise<void>) | undefined;

	constructor(
		private readonly label: string,
		private readonly service: ServiceLifecycleShape,
		private readonly host: EffectHostShape,
	) {}

	async onModuleInit(): Promise<void> {
		if (this.service.onStart !== undefined) {
			await this.host.runUnwrapped(this.service.onStart());
		}
		if (this.service.run !== undefined) {
			this.stopProgram = this.host.fork(this.label, this.service.run());
		}
	}

	async onApplicationBootstrap(): Promise<void> {
		if (this.service.onReady !== undefined) {
			await this.host.runUnwrapped(this.service.onReady());
		}
	}

	async onModuleDestroy(): Promise<void> {
		await this.stopProgram?.();
		this.stopProgram = undefined;
		if (this.service.onStop !== undefined) {
			// Shutdown never throws: a service that refuses to stop is reported, and the process still exits.
			await this.host.run(
				this.service
					.onStop()
					.pipe(Effect.catchCause((cause) => Effect.logWarning(`${this.label} stop failed: ${String(cause)}`))),
			);
		}
	}
}

/**
 * Binds a tag's lifecycle to Nest's: `providers: [serviceLifecycle(OutboxDispatcher)]`.
 *
 * Add it next to the tag's own provider, in the module that owns the service. The tag must be resolvable there (Nest
 * injects the instance); it can come from an imported module's exports.
 */
export function serviceLifecycle<I, S extends ServiceLifecycleShape>(
	tag: Context.Service<I, S> & (DeclaresLifecycle<S> extends true ? unknown : NoLifecycleInShape),
): Provider {
	return {
		provide: lifecycleToken(tag.key),
		useFactory: (host: EffectHostShape, service: S) => new ServiceLifecycleRunner(tag.key, service, host),
		// The intersection above is a compile-time gate only; Nest needs the bare tag as the token.
		inject: [EffectHost, tag as unknown as Type<S>],
	};
}
