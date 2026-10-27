import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EffectRuntime } from "@deployer/nest-effect";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/services/core-event-sync.service";
import { defer, from, map, mergeMap } from "rxjs";

import { streamProjectEvents, toStreamQueryInput } from "./project-stream";

/**
 * Publishes the project namespace on the core event bus.
 *
 * The transport is RxJS, but building a query needs the Effect services, so each
 * subscription runs {@link streamProjectEvents} against the app-wide runtime.
 * Registration happens at boot so another service can subscribe before the
 * first project request arrives.
 */
@Injectable()
export class ProjectEventAdapter implements OnModuleInit {
	constructor(
		private readonly coreEventSync: CoreEventSyncService,
		private readonly runtime: EffectRuntime,
	) {}

	onModuleInit(): void {
		this.coreEventSync.registerNamespaceAdapter("project", ({ definition, replay, replayLimit }) =>
			defer(() =>
				from(
					this.runtime.runPromise(
						streamProjectEvents(toStreamQueryInput(definition, replay, replayLimit)),
					),
				),
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
	}
}
