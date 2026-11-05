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
    makeSupervisorRegistry,
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

export function makeSupervisorOrchestrator(
    bus?: SupervisorEventBusShape,
    intervals: { degradedRetryMs?: number; reconcileSweepMs?: number } = {}
): SupervisorOrchestratorShape {
    const registry = makeSupervisorRegistry(bus)

    const ensureAll: SupervisorOrchestratorShape['ensureAll'] = Effect.suspend(
        () =>
            convergeAll(registry.list()).pipe(
                Effect.map((states) => new Map(states))
            )
    )

    const startDriftControl: SupervisorOrchestratorShape['startDriftControl'] =
        Effect.gen(function* () {
            const loops = yield* Effect.forkDetach(
                Effect.gen(function* () {
                    const results = yield* ensureAll
                    for (const [id, state] of results) {
                        const snapshot = yield* registry.get(id)
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
                            Effect.suspend(() => retryDegraded(registry.list()))
                        ),
                        everyInterval(
                            'Reconcile sweep',
                            intervals.reconcileSweepMs ??
                                RECONCILE_SWEEP_INTERVAL_MS,
                            ensureAll
                        ),
                    ])
                })
            )
            return { stop: Fiber.interrupt(loops) }
        })

    return {
        ...registry,
        getMatching: (predicate, options = {}) =>
            registry.awaitMatch(
                predicate,
                options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS
            ),
        getById: (supervisorId, options = {}) =>
            registry.awaitMatch(
                (supervisor) => supervisor.id === supervisorId,
                options.timeoutMs ?? DEFAULT_REGISTRATION_WAIT_MS
            ),
        ensureAll,
        convergeNow: (supervisorId) => {
            const supervisor = registry.get(supervisorId)
            return supervisor === null
                ? Effect.succeed(null)
                : supervisor.ensureDesiredState
        },
        degraded: Effect.suspend(() =>
            Effect.forEach(registry.list(), (supervisor) =>
                supervisor.getStateSnapshot.pipe(
                    Effect.map((snapshot) =>
                        snapshot.state === 'degraded' ? [supervisor] : []
                    )
                )
            ).pipe(Effect.map((groups) => groups.flat()))
        ),
        healthOfAll: Effect.suspend(() =>
            Effect.forEach(
                registry.list(),
                (supervisor) => supervisor.getHealthAndNotify,
                { concurrency: 'unbounded' }
            )
        ),
        startDriftControl,
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
            const orchestrator = makeSupervisorOrchestrator(
                yield* SupervisorEventBus
            )
            const control = yield* orchestrator.startDriftControl
            yield* Effect.addFinalizer(() => control.stop)
            return orchestrator
        })
    )
}
