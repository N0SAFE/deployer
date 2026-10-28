import { Injectable } from "@nestjs/common";
import { Cause, Effect, Fiber, Stream } from "effect";
import { Observable, filter } from "rxjs";
import {
	makeAppLifecycle,
	type AppLifecycleEvent,
	type AppLifecyclePhase,
	type AppLifecycleShape,
	type TransitionDetails,
} from "@deployer/lifecycle";

/**
 * The Promise-free face of `@deployer/lifecycle` for Nest callers that read the phase synchronously
 * and report transitions as plain calls. It holds no state or logic of its own: everything runs
 * through `effect`, which Effect code can use directly.
 */
@Injectable()
export class AppLifecycleService {
	/** The Effect lifecycle this host exposes. */
	readonly effect: AppLifecycleShape = makeAppLifecycle();

	/** Current lifecycle phase. */
	get phase(): AppLifecyclePhase {
		return this.effect.stateNow().phase;
	}

	/**
	 * Every lifecycle change as an RxJS stream: RxJS is the streaming surface for Nest callers, the
	 * Effect `events` stream is its source. Each subscriber sees changes from the moment it subscribes.
	 */
	get events(): Observable<AppLifecycleEvent> {
		return new Observable<AppLifecycleEvent>((subscriber) => {
			const fiber = Effect.runFork(
				this.effect.events.pipe(
					Stream.runForEach((event) => Effect.sync(() => { subscriber.next(event); })),
					Effect.matchCause({
						onSuccess: () => { subscriber.complete(); },
						onFailure: (cause) => { subscriber.error(Cause.squash(cause)); },
					}),
				),
			);
			return () => {
				void Effect.runPromise(Fiber.interrupt(fiber));
			};
		});
	}

	/** The changes that move to `event.phase`. */
	on(event: { phase: AppLifecyclePhase }): Observable<AppLifecycleEvent> {
		return this.events.pipe(filter((change) => change.phase === event.phase));
	}

	/** Moves to `phase`; never exits the process. */
	transition(phase: AppLifecyclePhase, details?: TransitionDetails): void {
		this.effect.transitionNow(phase, details);
	}

	markReady(): void {
		this.effect.markReadyNow();
	}

	markError(error: string): void {
		this.effect.markErrorNow(error);
	}

	/** Records a probed database URL and its reachability; subscribers are told. */
	markDatabaseProbe(url: string, reachable: boolean): void {
		this.effect.markDatabaseProbeNow(url, reachable);
	}

	markMeshConnected(connected: boolean): void {
		this.effect.markMeshConnectedNow(connected);
	}
}
