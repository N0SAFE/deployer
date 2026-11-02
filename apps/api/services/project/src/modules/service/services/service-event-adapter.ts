import { Effect } from "effect";
import { defer, from, mergeMap } from "rxjs";

import type { EffectHost } from "@deployer/nest-effect";
import type { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";

import { ServiceService } from "./service.service";

export const SERVICE_EVENT_REGISTRATION = Symbol("service:event-registration");

/**
 * Publishes the service namespace on the core event bus.
 *
 * The transport is RxJS, but building a query needs the Effect services, so each
 * subscription runs {@link ServiceService.streamCoreAdapter} on the Effect host.
 * It is a registration, not a service: the module's provider calls it once when it is built, so another
 * service can subscribe before the first service request arrives.
 */
export function registerServiceEventAdapter(coreEventSync: CoreEventSyncService, host: EffectHost["Service"]): true {
	coreEventSync.registerNamespaceAdapter("service", ({ definition, replay, replayLimit }) =>
		defer(() =>
			from(
				host.run(
					Effect.gen(function* () {
						const services = yield* ServiceService;
						return yield* services.streamCoreAdapter(definition, replay, replayLimit);
					}),
				),
			),
		).pipe(mergeMap((stream$) => stream$)),
	);
	return true;
}
