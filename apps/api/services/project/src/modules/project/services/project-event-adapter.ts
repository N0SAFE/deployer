import { defer, from, map, mergeMap } from "rxjs";

import type { EffectHost } from "@deployer/nest-effect";
import type { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";

import { streamProjectEvents, toStreamQueryInput } from "./project-stream";

export const PROJECT_EVENT_REGISTRATION = Symbol("project:event-registration");

/**
 * Publishes the project namespace on the core event bus.
 *
 * The transport is RxJS, but building a query needs the Effect services, so each
 * subscription runs {@link streamProjectEvents} on the Effect host.
 * It is a registration, not a service: the module's provider calls it once when it is built.
 */
export function registerProjectEventAdapter(coreEventSync: CoreEventSyncService, host: EffectHost["Service"]): true {
	coreEventSync.registerNamespaceAdapter("project", ({ definition, replay, replayLimit }) =>
		defer(() =>
			from(host.run(streamProjectEvents(toStreamQueryInput(definition, replay, replayLimit)))),
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
