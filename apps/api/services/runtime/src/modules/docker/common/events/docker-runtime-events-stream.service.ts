import { Context, Effect } from "effect";
import { Observable, ReplaySubject, type Subscription } from "rxjs";

import type { DockerRuntimeEvent } from "@deployer/contracts-entities";
import { AppLogger } from "@deployer/logger";

import type { DockerRuntimeMeshRelayService } from "../mesh/docker-runtime-mesh-relay.service";

/** The mesh's runtime events as one replaying stream. It follows the relay for as long as the service is started. */
export type DockerRuntimeEventsStreamShape = {
	readonly onStart: () => Effect.Effect<void>;
	readonly onStop: () => Effect.Effect<void>;
	readonly observeEvents: () => Observable<DockerRuntimeEvent>;
};

export class DockerRuntimeEventsStreamService extends Context.Service<
	DockerRuntimeEventsStreamService,
	DockerRuntimeEventsStreamShape
>()("runtime/DockerRuntimeEventsStream") {
	static readonly make = makeDockerRuntimeEventsStream;
}

function makeDockerRuntimeEventsStream(
	relay: Pick<DockerRuntimeMeshRelayService, "observeRuntimeEvents">,
): DockerRuntimeEventsStreamShape {
	const debugLogger = new AppLogger("api").scope("DockerRuntimeEventsStreamService").createContextFilterLogger({
		defaultClassName: "DockerRuntimeEventsStreamService",
		filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
		channel: "docker-runtime-events-stream",
	});
	const runtimeEvents$ = new ReplaySubject<DockerRuntimeEvent>(1);
	let subscription: Subscription | null = null;
	let relayedEventCount = 0;

	// Trace the first events, then every hundredth.
	const shouldTrace = (count: number): boolean => count <= 20 || count % 100 === 0;

	return {
		observeEvents: () => runtimeEvents$.asObservable(),
		onStart: () =>
			Effect.sync(() => {
				if (subscription) {
					return;
				}

				subscription = relay.observeRuntimeEvents().subscribe({
					next: (event) => {
						relayedEventCount += 1;
						runtimeEvents$.next(event);

						if (shouldTrace(relayedEventCount)) {
							debugLogger.debug("onStart", {
								phase: "runtime_event_relayed",
								count: relayedEventCount,
								source: event.source,
								action: event.action,
								actorId: event.actorId,
								eventId: event.eventId,
							});
						}
					},
					error: (error: unknown) => {
						debugLogger.debug("onStart", {
							phase: "runtime_event_relay_error",
							message: error instanceof Error ? error.message : String(error),
						});
					},
				});

				debugLogger.debug("onStart", { phase: "runtime_event_relay_started" });
			}),
		onStop: () =>
			Effect.sync(() => {
				subscription?.unsubscribe();
				subscription = null;
				runtimeEvents$.complete();

				debugLogger.debug("onStop", { phase: "runtime_event_relay_stopped", relayedEventCount });
			}),
	};
}
