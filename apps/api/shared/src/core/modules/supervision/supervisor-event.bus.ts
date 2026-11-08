import { Context, Effect } from 'effect'
import { Observable, Subject, filter, firstValueFrom } from 'rxjs'

import {
    matchesEventFilter,
    SupervisorEventBus as PackageEventBus,
    type SupervisorEvent,
    type SupervisorEventBusShape,
    type SupervisorEventFilter,
} from '@deployer/supervision'

/**
 * The supervisor event bus as the app sees it: the Effect bus (`core`) plus an Observable of the same events for RxJS
 * consumers (the streaming/observability surface). Supervisors publish through `core`; the Observable sees them too.
 */
export type SupervisorEventBusFacade = {
    /** The Effect bus the supervisors and the orchestrator run on. */
    readonly core: SupervisorEventBusShape
    readonly events$: Observable<SupervisorEvent>
    readonly of: (
        filterSpec?: SupervisorEventFilter
    ) => Observable<SupervisorEvent>
    readonly once: (
        filterSpec?: SupervisorEventFilter
    ) => Promise<SupervisorEvent>
    readonly emit: (event: SupervisorEvent) => void
}

/** One bus per container: built once, it owns the RxJS subject. */
export function makeSupervisorEventBusFacade(): SupervisorEventBusFacade {
    const subject = new Subject<SupervisorEvent>()
    const inner = Effect.runSync(PackageEventBus.live)
    // The inner bus's methods live on its prototype, so they are delegated explicitly rather than
    // copied by a spread: only `emit` is replaced, and it must still reach the inner bus.
    const core: SupervisorEventBusShape = {
        emit: (event: SupervisorEvent) =>
            Effect.sync(() => {
                subject.next(event)
            }).pipe(Effect.flatMap(() => inner.emit(event))),
        events: inner.events,
        of: (filterSpec) => inner.of(filterSpec),
        once: (filterSpec) => inner.once(filterSpec),
    }
    const events$ = subject.asObservable()
    const of = (filterSpec: SupervisorEventFilter = {}) =>
        events$.pipe(filter((event) => matchesEventFilter(event, filterSpec)))
    return {
        core,
        events$,
        of,
        once: (filterSpec = {}) => firstValueFrom(of(filterSpec)),
        emit: (event) => {
            Effect.runSync(core.emit(event))
        },
    }
}

export class SupervisorEventBus extends Context.Service<
    SupervisorEventBus,
    SupervisorEventBusFacade
>()('shared/SupervisorEventBus') {}
