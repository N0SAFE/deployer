/**
 * SupervisorEventBus — OBSERVABLE-based pub/sub for supervisor events,
 * aligned with the core events module (@repo/nest-events, RxJS).
 *
 * Every event is pushed through a `Subject` and exposed as `events$` — an
 * Observable consumers can pipe (filter, first, debounce, …) just like the
 * rest of the platform's event streams. See the shared events module
 * (`@repo/nest-events`) for the same pattern used on domain events.
 *
 *   bus.events$.pipe(filter(e => e.supervisorId === traefikId)).subscribe(...)
 *   await bus.once({ supervisorId, type: "health-snapshot" })
 *
 * Kept dependency-free apart from rxjs so `SupervisorsModule` stays a leaf
 * (unit harnesses never pull Docker/Env machinery).
 */

import { Injectable, Logger } from "@nestjs/common";
import { Observable, Subject, firstValueFrom } from "rxjs";
import { filter } from "rxjs/operators";

/** What happened to a supervisor. */
export type SupervisorEventType =
	| "registered"
	| "state-changed"
	| "reconciled"
	| "health-snapshot"
	| "removed";

/** A supervisor lifecycle/health event. */
export interface SupervisorEvent {
	/** The supervisor instance that emitted the event. */
	supervisorId: string;
	/** What happened. */
	type: SupervisorEventType;
	/** ISO 8601 timestamp. */
	at: string;
	/** Lifecycle state at emit time (state-changed/reconciled). */
	state?: "idle" | "converging" | "converged" | "degraded";
	/** Latest health snapshot (health-snapshot). */
	healthy?: boolean;
	/** Human detail (degradation reason, etc.). */
	detail?: string | null;
}

/** Filter a query by supervisor id and/or event type. */
export interface SupervisorEventFilter {
	supervisorId?: string;
	type?: SupervisorEventType;
}

@Injectable()
export class SupervisorEventBus {
	private readonly logger = new Logger(SupervisorEventBus.name);
	private readonly subject = new Subject<SupervisorEvent>();

	/**
	 * Stream of all supervisor events. Pipe it for filtering:
	 *
	 *   bus.events$.pipe(filter(e => e.type === "health-snapshot"))
	 */
	get events$(): Observable<SupervisorEvent> {
		return this.subject.asObservable();
	}

	/** Shorthand filter: `bus.of({ supervisorId })` returns a filtered stream. */
	of(filterSpec: SupervisorEventFilter = {}): Observable<SupervisorEvent> {
		return this.events$.pipe(
			filter((event) => {
				if (filterSpec.supervisorId !== undefined && filterSpec.supervisorId !== event.supervisorId) return false;
				if (filterSpec.type !== undefined && filterSpec.type !== event.type) return false;
				return true;
			}),
		);
	}

	/** Resolve with the FIRST matching event (one-shot). */
	async once(filterSpec: SupervisorEventFilter = {}): Promise<SupervisorEvent> {
		return await firstValueFrom(this.of(filterSpec));
	}

	/** Push an event into the stream. Callers are the supervisor framework. */
	emit(event: SupervisorEvent): void {
		try {
			this.subject.next(event);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Supervisor event push failed (${event.type}@${event.supervisorId}): ${msg}`);
		}
	}
}