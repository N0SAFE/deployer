import { Context, Effect } from 'effect'

import { EffectHost, type EffectHostShape } from './effect-host'

import type {
    OnApplicationBootstrap,
    OnModuleDestroy,
    OnModuleInit,
    Provider,
    Type,
} from '@nestjs/common'

/**
 * The lifecycle a service declares **in its shape**, named the way NestJS names
 * it.
 *
 * A service that owns something with a lifetime — a listener, a poller, a file
 * handle, a pool — states that lifetime where it states everything else it does,
 * and the implementation is then obliged to provide it. The three hooks are
 * Nest's own names so the vocabulary is the one the framework already taught
 * everyone; the difference is the return type, which is an `Effect` instead of
 * `void | Promise<void>`.
 *
 * ── WHY A HOOK CAN YIELD A SERVICE ──────────────────────────────────────────
 * `R` is open. A hook runs on the application runtime, over the context built
 * from every provider whose token is an Effect key (`collectEffectLayer`), so
 * `yield* SomeService` resolves exactly as it does inside a handler:
 *
 * ```ts
 * export class DriftControl extends Context.Service<DriftControl, DriftShape>()('x/Drift') {
 *   static readonly live = class DriftImpl implements DriftShape {
 *     onModuleInit() {
 *       return Effect.gen(function* () {
 *         const supervisors = yield* SupervisorOrchestrator  // ← resolved
 *         return yield* supervisors.startDriftControl
 *       })
 *     }
 *   }
 * }
 * ```
 *
 * The hooks are optional because a service may need any one of them;
 * `serviceLifecycle(tag)` refuses a shape that declares none, so adding the
 * provider is what forces the decision.
 *
 * `run` is the one member with no Nest equivalent: a loop that must be forked
 * and interrupted on shutdown. Nest expresses that as a promise nobody awaits,
 * which is exactly the thing this avoids.
 */
export type ServiceLifecycleShape<R = never> = {
    /** Once, before the app serves (Nest's `onModuleInit`). A failure fails the boot — this is initialisation, not a background task. */
    readonly onModuleInit?: () => Effect.Effect<void, unknown, R>
    /**
     * Once, when EVERY module has finished initialising (Nest's
     * `onApplicationBootstrap`), after all `onModuleInit`s. Use it for what must
     * see the other modules' start-up work (a drift control that converges what
     * the modules registered). A failure fails the boot.
     */
    readonly onApplicationBootstrap?: () => Effect.Effect<void, unknown, R>
    /** Forked after `onModuleInit`, expected to run until interrupted. The runner owns the fiber and interrupts it on stop. */
    readonly run?: () => Effect.Effect<void, unknown, R>
    /** Once, after `run` is interrupted (Nest's `onModuleDestroy`). Never fails the shutdown: a failure is logged. */
    readonly onModuleDestroy?: () => Effect.Effect<void, unknown, R>
}

/** A shape that declares at least one lifecycle hook. */
type DeclaresLifecycle<S> = 'onModuleInit' extends keyof S
    ? true
    : 'run' extends keyof S
      ? true
      : 'onModuleDestroy' extends keyof S
        ? true
        : 'onApplicationBootstrap' extends keyof S
          ? true
          : false

/** The compile error `serviceLifecycle` produces for a shape with no lifecycle in it. */
type NoLifecycleInShape = {
    readonly 'this tag declares no onModuleInit / run / onModuleDestroy in its shape, so there is nothing to bind': never
}

/** One runner per service tag. `Symbol.for` keeps the token stable if the module is loaded twice. */
const lifecycleToken = (key: string): symbol =>
    Symbol.for(`effect-lifecycle:${key}`)

/**
 * Runs one service's lifecycle from Nest's.
 *
 * `onModuleInit`: the hook, then fork `run`.
 * `onApplicationBootstrap`: the hook.
 * `onModuleDestroy`: interrupt `run`, then the hook.
 *
 * That order is the whole point: nothing stops while the work that uses it may
 * still be running.
 *
 * Every hook runs through `EffectHost`, whose runtime is built over the whole
 * container — which is what lets a hook `yield*` a service.
 */
export class ServiceLifecycleRunner<R = never>
    implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
    private stopProgram: (() => Promise<void>) | undefined

    constructor(
        private readonly label: string,
        private readonly service: ServiceLifecycleShape<R>,
        private readonly host: EffectHostShape
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.service.onModuleInit !== undefined) {
            await this.host.runUnwrapped(this.service.onModuleInit())
        }
        if (this.service.run !== undefined) {
            this.stopProgram = this.host.fork(this.label, this.service.run())
        }
    }

    async onApplicationBootstrap(): Promise<void> {
        if (this.service.onApplicationBootstrap !== undefined) {
            await this.host.runUnwrapped(
                this.service.onApplicationBootstrap()
            )
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.stopProgram?.()
        this.stopProgram = undefined
        if (this.service.onModuleDestroy !== undefined) {
            // Shutdown never throws: a service that refuses to stop is reported,
            // and the process still exits.
            await this.host.run(
                this.service.onModuleDestroy().pipe(
                    Effect.catchCause((cause) =>
                        Effect.logWarning(
                            `${this.label} stop failed: ${String(cause)}`
                        )
                    )
                )
            )
        }
    }
}

/**
 * Binds a tag's lifecycle to Nest's: `providers: [serviceLifecycle(OutboxDispatcher)]`.
 *
 * Add it next to the tag's own provider, in the module that owns the service. The
 * tag must be resolvable there (Nest injects the instance); it can come from an
 * imported module's exports.
 */
export function serviceLifecycle<
    I,
    R,
    S extends ServiceLifecycleShape<R>,
>(
    tag: Context.Service<I, S> &
        (DeclaresLifecycle<S> extends true ? unknown : NoLifecycleInShape)
): Provider {
    return {
        provide: lifecycleToken(tag.key),
        useFactory: (host: EffectHostShape, service: S) =>
            new ServiceLifecycleRunner<R>(tag.key, service, host),
        // The intersection above is a compile-time gate only; Nest needs the bare
        // tag as the token.
        inject: [EffectHost, tag as unknown as Type<S>],
    }
}
