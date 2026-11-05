import { Context, Effect } from "effect";
import { Observable, Subject, filter, firstValueFrom } from "rxjs";

import { makeSupervisorEventBus, matchesEventFilter, type SupervisorEvent, type SupervisorEventBusShape, type SupervisorEventFilter } from "@deployer/supervision";

/**
 * The supervisor event bus as the app sees it: the Effect bus (`core`) plus an Observable of the same events for RxJS
 * consumers (the streaming/observability surface). Supervisors publish through `core`; the Observable sees them too.
 */
export type SupervisorEventBusFacade = {
	/** The Effect bus the supervisors and the orchestrator run on. */
	readonly core: SupervisorEventBusShape;
	readonly events$: Observable<SupervisorEvent>;
	readonly of: (filterSpec?: SupervisorEventFilter) => Observable<SupervisorEvent>;
	readonly once: (filterSpec?: SupervisorEventFilter) => Promise<SupervisorEvent>;
	readonly emit: (event: SupervisorEvent) => void;
};

/** One bus per container: built once, it owns the RxJS subject. */
export function makeSupervisorEventBusFacade(): SupervisorEventBusFacade {
	const subject = new Subject<SupervisorEvent>();
	const inner = Effect.runSync(makeSupervisorEventBus());
	const core: SupervisorEventBusShape = {
		...inner,
		emit: (event: SupervisorEvent) =>
			Effect.sync(() => {
				subject.next(event);
			}).pipe(Effect.flatMap(() => inner.emit(event))),
	};
	const events$ = subject.asObservable();
	const of = (filterSpec: SupervisorEventFilter = {}) => events$.pipe(filter((event) => matchesEventFilter(event, filterSpec)));
	return {
		core,
		events$,
		of,
		once: (filterSpec = {}) => firstValueFrom(of(filterSpec)),
		emit: (event) => {
			Effect.runSync(core.emit(event));
		},
	};
}

export class SupervisorEventBus extends Context.Service<SupervisorEventBus, SupervisorEventBusFacade>()("shared/SupervisorEventBus") {}
