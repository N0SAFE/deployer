import { Logger } from '@nestjs/common'
import { Context } from 'effect'
import {
    BehaviorSubject,
    Observable,
    Subject,
    defer,
    filter,
    map,
    merge,
    of,
    distinctUntilChanged,
} from 'rxjs'

import type {
    SetupPhase,
    SetupPhaseEvent,
    SetupPhaseSnapshot,
} from './setup-phase.types'

/** What the rest of the app can do with the phase. A plain shape: a spec fakes it, a module provides it. */
export interface SetupPhaseShape {
    /** Current phase, for synchronous reads (the Terminus indicator). */
    current(): SetupPhaseSnapshot
    /** Current phase as a stream. Replays the current value to new subscribers. */
    readonly snapshot$: Observable<SetupPhaseSnapshot>
    /** Every transition, for consumers reacting to edges. */
    readonly events$: Observable<SetupPhaseEvent>
    /** Transitions INTO a specific phase. */
    onEnter(phase: SetupPhase): Observable<SetupPhaseEvent>
    /** The phase as a stream of phase names (ignores detail/flag churn). */
    readonly phase$: Observable<SetupPhase>
    record(
        phase: Exclude<SetupPhase, 'failed'>,
        detail: string,
        flags?: { apiUp?: boolean; apiReady?: boolean }
    ): void
    fail(reason: string, flags?: { apiUp?: boolean; apiReady?: boolean }): void
    reset(): void
    isReady(): boolean
}

export class SetupPhaseService extends Context.Service<
    SetupPhaseService,
    SetupPhaseShape
>()('setup/SetupPhaseService') {}

/**
 * Single source of truth for the setup app's lifecycle phase, published as an
 * RxJS event stream.
 *
 * WHY events rather than getters: the compose gate (`GET /setup/health`), the
 * wizard's read model (`GET /setup/state`) and the orchestration steps all need
 * this state, and they run on different code paths. With getters, every
 * consumer that wants to REACT has to poll. With a `BehaviorSubject`, a consumer
 * subscribes once and is told — and a late subscriber still gets the current
 * value immediately, so there is no "subscribe after the interesting moment"
 * race.
 *
 * The phase is only ever moved by the service that does the work; nothing here
 * guesses or infers.
 *
 * WHY NOT `@deployer/lifecycle`'s `AppLifecycle`
 * Both are RxJS phase state machines, but they answer different questions and
 * must not be merged:
 *
 *   - `AppLifecycle` describes ONE Nest process booting: config → DB
 *     probe → mesh join → serving. Its phases end when that process is up.
 *   - This service describes a MULTI-PROCESS handover: found/join the swarm,
 *     drive the API to provision, retarget the ingress, then exit. Its terminal
 *     phase (`ready`) means "compose may now start `apps/api`" — a statement
 *     about OTHER processes, not about this one.
 *
 * Folding them together would put the API's bootstrap vocabulary inside this
 * app's public readiness contract (compose parses only this one's phase), and
 * would couple the app being retired to the app that outlives it.
 */
export function makeSetupPhase(): SetupPhaseShape {
    const logger = new Logger('SetupPhaseService')
    const INITIAL: SetupPhaseSnapshot = {
        phase: 'awaiting',
        detail: 'Setup has not started yet',
        apiUp: false,
        apiReady: false,
        updatedAt: new Date(0).toISOString(),
    }

    /**
     * `BehaviorSubject`, not `Subject`: the gate may be probed before any
     * transition has occurred, and a plain Subject would make that first read
     * block forever waiting for an event that already "happened" at construction.
     */
    const state$ = new BehaviorSubject<SetupPhaseSnapshot>({
        ...INITIAL,
        updatedAt: new Date().toISOString(),
    })

    /**
     * Transitions only — for consumers that react to EDGES, not to state.
     *
     * A plain `Subject`, NOT a `BehaviorSubject`: replaying the last edge to a
     * late subscriber would re-fire edge-triggered work (e.g. "on failure, start
     * recovery" running again for a failure already handled). State replays via
     * `snapshot$`; edges are consumed once, by whoever is listening.
     */
    const transitions$ = new Subject<SetupPhaseEvent>()
    const events$ = transitions$.asObservable()

    /**
     * Publish one transition: update state, then notify.
     *
     * The transition event is emitted AFTER the state subject so a subscriber
     * that reads `current()` inside its `events$` handler sees the new value, not
     * the one it just replaced.
     */
    const publish = (
        phase: SetupPhase,
        detail: string,
        flags: { apiUp?: boolean; apiReady?: boolean },
        isFailure = false
    ): void => {
        const previous = state$.value
        const snapshot: SetupPhaseSnapshot = {
            phase,
            detail,
            apiUp: flags.apiUp ?? previous.apiUp,
            apiReady: flags.apiReady ?? previous.apiReady,
            updatedAt: new Date().toISOString(),
        }

        state$.next(snapshot)
        transitions$.next({
            from: previous.phase,
            to: phase,
            snapshot,
            at: snapshot.updatedAt,
        })

        if (isFailure) {
            // ERROR, not WARN: a failed setup blocks the whole platform.
            logger.error(`Setup FAILED: ${detail}`)
        } else {
            logger.log(`Setup phase ${previous.phase} → ${phase}: ${detail}`)
        }
    }

    return {
        current: () => ({ ...state$.value }),
        snapshot$: state$.asObservable(),
        events$,
        // A subscriber arriving while already IN `phase` still gets that entry once: Nest runs boot hooks in an order
        // unrelated to dependencies, and on a restart the gate opens inside its own hook before the handover subscribes.
        onEnter: (phase) =>
            defer(() => {
                const current = state$.value
                const live = events$.pipe(filter((event) => event.to === phase))
                return current.phase === phase
                    ? merge(
                          of<SetupPhaseEvent>({
                              from: current.phase,
                              to: phase,
                              snapshot: current,
                              at: current.updatedAt,
                          }),
                          live
                      )
                    : live
            }).pipe(distinctUntilChanged((a, b) => a.at === b.at)),
        phase$: state$.pipe(
            map((snapshot) => snapshot.phase),
            distinctUntilChanged()
        ),

        /**
         * Record a progress signal.
         *
         * `failed` is sticky on purpose: a phase that later looks "provisioning" again
         * must not silently erase an error the operator has not seen yet. Clearing it
         * is an explicit act (a retry), never a side effect of progress.
         */
        record: (phase, detail, flags = {}) => {
            if (state$.value.phase === 'failed') {
                logger.warn(
                    `Ignoring "${phase}" — still in the failed state until the operator retries`
                )
                return
            }
            publish(phase, detail, flags)
        },

        /** Record a terminal failure with the reason that caused it. */
        fail: (reason, flags = {}) => {
            publish('failed', reason, flags, true)
        },

        /**
         * Clear a previous failure so the flow can run again. Re-running is safe: the swarm init is idempotent and
         * the DB provisioner skips work already done, so resetting the PHASE is all that is needed.
         */
        reset: () => {
            publish(
                'awaiting',
                'Setup was reset and is waiting to start again',
                { apiReady: false }
            )
            logger.log('Setup phase reset — ready to re-run')
        },

        /**
         * The GATE, as compose consumes it. Open from `launching` onward — NOT only at `ready`.
         *
         * An earlier design treated `ready` (the API is green and the ingress retargeted) as the gate, which made
         * setup's health a statement about the API. Compose starts the API *behind* this healthcheck, so that is a
         * cycle. `launching` is a fact about THIS process: the wizard finished collecting and persisted its choices.
         * The phases AFTER `launching` still report ready: a `503` there would tear the API back down mid-provision.
         */
        isReady: () => {
            switch (state$.value.phase) {
                case 'launching':
                case 'provisioning':
                case 'handover':
                case 'ready':
                    return true
                default:
                    return false
            }
        },
    }
}
