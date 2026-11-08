import { Context, Effect, Fiber, Layer } from 'effect'

import {
    SupervisorEventBus,
    type SupervisorEventBusShape,
} from '../events/event-bus'

import {
    convergeAll,
    DEGRADED_RETRY_INTERVAL_MS,
    everyInterval,
    RECONCILE_SWEEP_INTERVAL_MS,
    retryDegraded,
} from './drift-control'
import {
    DEFAULT_REGISTRATION_WAIT_MS,
    SupervisorRegistry,
    type SupervisorRegistryShape,
} from './registry'

import type { HealthSnapshot } from '../supervisor/spec'
import type { SupervisorState } from '../supervisor/state'
import type { AnySupervisor } from '../supervisor/supervisor'

export type SupervisorOrchestratorShape = SupervisorRegistryShape & {
    /** A registered supervisor `predicate` accepts, waiting for it to register if need be. */
    readonly getMatching: (
        predicate: (supervisor: AnySupervisor) => boolean,
        options?: { timeoutMs?: number }
    ) => Effect.Effect<AnySupervisor | null>
    /** A registered supervisor by id, waiting for it to register if need be. */
    readonly getById: (
        supervisorId: string,
        options?: { timeoutMs?: number }
    ) => Effect.Effect<AnySupervisor | null>
    /** Converges every registered supervisor in parallel, each failure isolated; the state each ended in. */
    readonly ensureAll: Effect.Effect<Map<string, SupervisorState>>
    /** Converges one supervisor now; null when there is none by that id. */
    readonly convergeNow: (
        supervisorId: string
    ) => Effect.Effect<SupervisorState | null>
    /** The supervisors whose last convergence failed. The app never stops for one: health and events surface it. */
    readonly degraded: Effect.Effect<AnySupervisor[]>
    /** Every supervisor's health, probed in parallel, each published as a `health-snapshot` event. */
    readonly healthOfAll: Effect.Effect<HealthSnapshot<unknown>[]>
    /**
     * Converges everything once, then keeps correcting drift: degraded supervisors are retried and
     * every supervisor is converged again on a slower cadence. Returns a handle that stops both loops.
     */
    readonly startDriftControl: Effect.Effect<{
        readonly stop: Effect.Effect<void>
    }>
}

/**
 * The one implementation of `SupervisorOrchestratorShape`.
 *
 * A NAMED class: declaration emit cannot describe the private members of an anonymous exported
 * class (TS4094), and this package emits declarations.
 *
 * The registry members are the ONE delegation in this class, and they are deliberate: the shape is
 * `SupervisorRegistryShape & {…}`, and the registry is a separate service with its own map that the
 * app registers supervisors through (`orchestrator.register(…)`). Its methods are bound to the
 * registry instance at construction so a caller that reads one off the orchestrator and calls it
 * detached still reaches that map.
 */
class SupervisorOrchestratorImpl implements SupervisorOrchestratorShape {
    private readonly registry: SupervisorRegistryShape
    private readonly intervals: {
        readonly degradedRetryMs?: number
        readonly reconcileSweepMs?: number
    }
    declare readonly register: SupervisorRegistryShape['register']
    declare readonly list: SupervisorRegistryShape['list']
    declare readonly has: SupervisorRegistryShape['has']
    declare readonly get: SupervisorRegistryShape['get']
    declare readonly find: SupervisorRegistryShape['find']
    declare readonly awaitMatch: SupervisorRegistryShape['awaitMatch']

    constructor(
        bus?: SupervisorEventBusShape,
        intervals: {
            degradedRetryMs?: number
            reconcileSweepMs?: number
        } = {}
    ) {
        this.registry = new SupervisorRegistry.live(bus)
        this.intervals = intervals
        for (const key of [
            'register',
            'list',
            'has',
            'get',
            'find',
            'awaitMatch',
        ] as const) {
            Object.defineProperty(this, key, {
                value: this.registry[key].bind(this.registry),
                configurable: true,
            })
        }
    }

    getMatching(
        predicate: (supervisor: AnySupervisor) => boolean,
        options: { timeoutMs?: number } = {}
    ): Effect.Effect<AnySupervisor | null> {
        return this.registry.awaitMatch(
            predicate,
            options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS
        )
    }

    getById(
        supervisorId: string,
        options: { timeoutMs?: number } = {}
    ): Effect.Effect<AnySupervisor | null> {
        return this.registry.awaitMatch(
            (supervisor: AnySupervisor) => supervisor.id === supervisorId,
            options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS
        )
    }

    get ensureAll(): Effect.Effect<Map<string, SupervisorState>> {
        return Effect.suspend(() =>
            convergeAll(this.registry.list()).pipe(
                Effect.map((states) => new Map(states))
            )
        )
    }

    convergeNow(
        supervisorId: string
    ): Effect.Effect<SupervisorState | null> {
        const supervisor = this.registry.get(supervisorId)
        return supervisor === null
            ? Effect.succeed(null)
            : supervisor.ensureDesiredState
    }

    get degraded(): Effect.Effect<AnySupervisor[]> {
        return Effect.suspend(() =>
            Effect.forEach(this.registry.list(), (supervisor) =>
                supervisor.getStateSnapshot.pipe(
                    Effect.map((snapshot) =>
                        snapshot.state === 'degraded' ? [supervisor] : []
                    )
                )
            ).pipe(Effect.map((groups) => groups.flat()))
        )
    }

    get healthOfAll(): Effect.Effect<HealthSnapshot<unknown>[]> {
        return Effect.suspend(() =>
            Effect.forEach(
                this.registry.list(),
                (supervisor) => supervisor.getHealthAndNotify,
                { concurrency: 'unbounded' }
            )
        )
    }

    get startDriftControl(): Effect.Effect<{
        readonly stop: Effect.Effect<void>
    }> {
        const { intervals } = this
        return Effect.gen({ self: this }, function* () {
            const loops = yield* Effect.forkDetach(
                Effect.gen({ self: this }, function* () {
                    const results = yield* this.ensureAll
                    for (const [id, state] of results) {
                        const snapshot = yield* this.registry.get(id)
                            ?.getStateSnapshot ??
                            Effect.succeed({ state, detail: null })
                        if (state === 'degraded') {
                            yield* Effect.logWarning(
                                `⚠️ Supervisor "${id}" DEGRADED after boot convergence: ${snapshot.detail ?? 'unknown'}`
                            )
                        } else if (state === 'pending') {
                            yield* Effect.logInfo(
                                `⏳ Supervisor "${id}" deferred (pending): ${snapshot.detail ?? 'awaiting prerequisite'}`
                            )
                        } else {
                            yield* Effect.logInfo(
                                `✅ Supervisor "${id}" ${state}`
                            )
                        }
                    }
                    yield* Effect.raceAll([
                        everyInterval(
                            'Degraded-supervisor retry',
                            intervals.degradedRetryMs ??
                                DEGRADED_RETRY_INTERVAL_MS,
                            Effect.suspend(() =>
                                retryDegraded(this.registry.list())
                            )
                        ),
                        everyInterval(
                            'Reconcile sweep',
                            intervals.reconcileSweepMs ??
                                RECONCILE_SWEEP_INTERVAL_MS,
                            this.ensureAll
                        ),
                    ])
                })
            )
            return { stop: Fiber.interrupt(loops) }
        })
    }
}

export class SupervisorOrchestrator extends Context.Service<
    SupervisorOrchestrator,
    SupervisorOrchestratorShape
>()('supervision/SupervisorOrchestrator') {
    /** The orchestrator over the app's event bus; its drift control stops with the layer's scope. */
    static readonly Live: Layer.Layer<
        SupervisorOrchestrator,
        never,
        SupervisorEventBus
    > = Layer.effect(
        SupervisorOrchestrator,
        Effect.gen(function* () {
            const orchestrator = new SupervisorOrchestrator.live(
                yield* SupervisorEventBus
            )
            const control = yield* orchestrator.startDriftControl
            yield* Effect.addFinalizer(() => control.stop)
            return orchestrator
        })
    )

    /** The implementation: it owns the registry and takes the bus. */
    static readonly live = SupervisorOrchestratorImpl
}
