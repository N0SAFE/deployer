import { Injectable } from "@nestjs/common";
import { makeSupervisorEventBus, matchesEventFilter, type SupervisorEvent, type SupervisorEventBusShape, type SupervisorEventFilter } from "@deployer/supervision";
import { Effect } from "effect";
import { Observable, Subject, filter, firstValueFrom } from "rxjs";

/**
 * The Nest face of the supervisor event bus: the Effect bus (`core`) plus an Observable of the same
 * events for RxJS consumers. Supervisors publish through `core`; the Observable sees them too.
 */
@Injectable()
export class SupervisorEventBus {
	private readonly subject = new Subject<SupervisorEvent>();

	/** The Effect bus the supervisors and the orchestrator run on. */
	readonly core: SupervisorEventBusShape = (() => {
		const inner = Effect.runSync(makeSupervisorEventBus());
		return {
			...inner,
			emit: (event: SupervisorEvent) =>
				Effect.sync(() => {
					this.subject.next(event);
				}).pipe(Effect.flatMap(() => inner.emit(event))),
		};
	})();

	get events$(): Observable<SupervisorEvent> {
		return this.subject.asObservable();
	}

	of(filterSpec: SupervisorEventFilter = {}): Observable<SupervisorEvent> {
		return this.events$.pipe(filter((event) => matchesEventFilter(event, filterSpec)));
	}

	once(filterSpec: SupervisorEventFilter = {}): Promise<SupervisorEvent> {
		return firstValueFrom(this.of(filterSpec));
	}

	emit(event: SupervisorEvent): void {
		Effect.runSync(this.core.emit(event));
	}
}
