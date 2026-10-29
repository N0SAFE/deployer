import type { EffectRuntime } from "@deployer/nest-effect";
import type { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { defer, from, map, mergeMap } from "rxjs";

import { streamProjectEvents, toStreamQueryInput } from "./project-stream";

export const PROJECT_EVENT_REGISTRATION = Symbol("project:event-registration");

/**
 * Publishes the project namespace on the core event bus.
 *
 * The transport is RxJS, but building a query needs the Effect services, so each
 * subscription runs {@link streamProjectEvents} against the app-wide runtime.
 * It is a registration, not a service: the module's provider calls it once when it is built.
 */
export function registerProjectEventAdapter(coreEventSync: CoreEventSyncService, runtime: EffectRuntime): true {
	coreEventSync.registerNamespaceAdapter("project", ({ definition, replay, replayLimit }) =>
		defer(() =>
			from(runtime.runPromise(streamProjectEvents(toStreamQueryInput(definition, replay, replayLimit)))),
		).pipe(
			mergeMap((events) => from(events)),
			map((event) => ({
				eventName: event.type,
				payload: event,
				replayed: event.replayed,
				emittedAt: event.emittedAt,
			})),
		),
	);
	return true;
}
