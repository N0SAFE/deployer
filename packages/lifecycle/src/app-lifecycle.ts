import { Context, Effect, Layer, PubSub, Ref, Stream } from 'effect'

import {
    AppLifecyclePhase,
    describePhase,
    type AppLifecycleEvent,
    type BootstrapStep,
    type LifecycleState,
    type TransitionDetails,
} from './phases'

/**
 * The application lifecycle: a phase, an optional bootstrap step, the last error and a metadata
 * bag, plus a stream of every change.
 *
 * It is purely an observer. It never exits the process or acts on a phase; the orchestrator and the
 * health endpoint read it and decide. Each operation is an Effect that never fails, and the
 * synchronous ones (`stateNow`, `transitionNow`) exist for hosts that have to answer a plain function
 * call: they run the same logic, not a copy.
 */
export type AppLifecycleShape = {
    /** The current state. */
    readonly state: Effect.Effect<LifecycleState>
    /** A snapshot of the current state, shaped like an event. */
    readonly snapshot: Effect.Effect<AppLifecycleEvent>
    /** Every change from the moment of subscription, one event per change. */
    readonly events: Stream.Stream<AppLifecycleEvent>
    /** Moves to `phase`, merging any metadata and recording an `error`. */
    readonly transition: (
        phase: AppLifecyclePhase,
        details?: TransitionDetails
    ) => Effect.Effect<void>
    /** Enters a bootstrap step (the phase becomes `bootstrapping`). */
    readonly enterStep: (step: BootstrapStep) => Effect.Effect<void>
    readonly markReady: Effect.Effect<void>
    readonly markError: (error: string) => Effect.Effect<void>
    /** Records a probed database URL and whether it answered; subscribers are told. */
    readonly markDatabaseProbe: (
        url: string,
        reachable: boolean
    ) => Effect.Effect<void>
    /** Records the mesh connection status; subscribers are told. */
    readonly markMeshConnected: (connected: boolean) => Effect.Effect<void>
    /** Synchronous read of the current state. */
    readonly stateNow: () => LifecycleState
    /** Synchronous `transition`, for callers that cannot yield an Effect. */
    readonly transitionNow: (
        phase: AppLifecyclePhase,
        details?: TransitionDetails
    ) => void
    readonly markReadyNow: () => void
    readonly markErrorNow: (error: string) => void
    readonly markDatabaseProbeNow: (url: string, reachable: boolean) => void
    readonly markMeshConnectedNow: (connected: boolean) => void
}

export class AppLifecycle extends Context.Service<
    AppLifecycle,
    AppLifecycleShape
>()('lifecycle/AppLifecycle') {
    static readonly layer = Layer.effect(
        AppLifecycle,
        Effect.sync(makeAppLifecycle)
    )
}

const initial: LifecycleState = {
    phase: AppLifecyclePhase.INITIALIZED,
    step: null,
    error: null,
    metadata: {},
}

const withMetadata = (metadata: Readonly<Record<string, unknown>>) =>
    Object.keys(metadata).length > 0 ? { ...metadata } : undefined

/** Builds a lifecycle that starts in `initialized` and announces that to its (future) subscribers. */
export function makeAppLifecycle(): AppLifecycleShape {
    const ref = Ref.makeUnsafe<LifecycleState>(initial)
    const bus = Effect.runSync(PubSub.unbounded<AppLifecycleEvent>())

    const publish = (event: Omit<AppLifecycleEvent, 'timestamp'>): void => {
        PubSub.publishUnsafe(bus, {
            ...event,
            timestamp: new Date().toISOString(),
        })
    }
    const update = (
        change: (state: LifecycleState) => LifecycleState
    ): LifecycleState => {
        const next = change(Ref.getUnsafe(ref))
        Effect.runSync(Ref.set(ref, next))
        return next
    }

    const transitionNow = (
        phase: AppLifecyclePhase,
        details?: TransitionDetails
    ): void => {
        const from = Ref.getUnsafe(ref).phase
        const { error, message, ...rest } = details ?? {}
        const next = update((state) => ({
            phase,
            step: null,
            error:
                typeof error === 'string' && error !== '' ? error : state.error,
            metadata: { ...state.metadata, ...rest },
        }))
        publish({
            phase,
            message:
                typeof message === 'string'
                    ? message
                    : `Transition: ${from} → ${phase}`,
            error: typeof error === 'string' ? error : undefined,
            metadata: withMetadata(next.metadata),
        })
    }

    const noteMetadata = (
        patch: Record<string, unknown>,
        message: string
    ): void => {
        const next = update((state) => ({
            ...state,
            metadata: { ...state.metadata, ...patch },
        }))
        publish({ phase: next.phase, message, metadata: { ...next.metadata } })
    }

    const markReadyNow = () => {
        transitionNow(AppLifecyclePhase.READY, {
            message: 'Application is fully ready',
        })
    }
    const markErrorNow = (error: string) => {
        transitionNow(AppLifecyclePhase.ERROR, {
            error,
            message: `Bootstrap failed: ${error}`,
        })
    }
    const markDatabaseProbeNow = (url: string, reachable: boolean) => {
        noteMetadata(
            { databaseUrl: url, databaseReachable: reachable },
            reachable ? 'Database reachable' : 'Database unreachable'
        )
    }
    const markMeshConnectedNow = (connected: boolean) => {
        noteMetadata(
            { meshConnected: connected },
            connected ? 'Mesh connected' : 'Mesh disconnected'
        )
    }

    const lift =
        <A extends unknown[]>(run: (...args: A) => void) =>
        (...args: A) =>
            Effect.sync(() => {
                run(...args)
            })

    publish({
        phase: initial.phase,
        message: 'Application initialized, starting bootstrap...',
    })

    return {
        state: Ref.get(ref),
        snapshot: Ref.get(ref).pipe(
            Effect.map((state) => ({
                phase: state.phase,
                step: state.step ?? undefined,
                message: describePhase(state),
                timestamp: new Date().toISOString(),
                error: state.error ?? undefined,
                metadata: withMetadata(state.metadata),
            }))
        ),
        events: Stream.fromPubSub(bus),
        transition: lift(transitionNow),
        enterStep: (step) =>
            Effect.sync(() => {
                update((state) => ({
                    ...state,
                    phase: AppLifecyclePhase.BOOTSTRAPPING,
                    step,
                }))
                publish({
                    phase: AppLifecyclePhase.BOOTSTRAPPING,
                    step,
                    message: `Bootstrapping: ${step}`,
                })
            }),
        markReady: Effect.sync(markReadyNow),
        markError: lift(markErrorNow),
        markDatabaseProbe: lift(markDatabaseProbeNow),
        markMeshConnected: lift(markMeshConnectedNow),
        stateNow: () => Ref.getUnsafe(ref),
        transitionNow,
        markReadyNow,
        markErrorNow,
        markDatabaseProbeNow,
        markMeshConnectedNow,
    }
}
