import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EffectRuntime } from "@deployer/nest-effect";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { Effect } from "effect";
import { defer, from, mergeMap } from "rxjs";

import { ServiceService } from "./service.service";

/**
 * Publishes the service namespace on the core event bus.
 *
 * The transport is RxJS, but building a query needs the Effect services, so each
 * subscription runs {@link ServiceService.streamCoreAdapter} against the app-wide
 * runtime. Registration happens at boot so another service can subscribe before
 * the first service request arrives.
 */
@Injectable()
export class ServiceEventAdapter implements OnModuleInit {
	constructor(
		private readonly coreEventSync: CoreEventSyncService,
		private readonly runtime: EffectRuntime,
	) {}

	onModuleInit(): void {
		this.coreEventSync.registerNamespaceAdapter("service", ({ definition, replay, replayLimit }) =>
			defer(() =>
				from(
					this.runtime.runPromise(
						Effect.gen(function* () {
							const services = yield* ServiceService;
							return yield* services.streamCoreAdapter(definition, replay, replayLimit);
						}),
					),
				),
			).pipe(mergeMap((stream$) => stream$)),
		);
	}
}
