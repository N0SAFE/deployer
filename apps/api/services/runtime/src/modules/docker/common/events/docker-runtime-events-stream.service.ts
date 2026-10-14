import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Observable, ReplaySubject, type Subscription } from "rxjs";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";
import { AppLogger } from "@repo/logger";
import { DockerRuntimeMeshRelayService } from "../mesh/docker-runtime-mesh-relay.service";

@Injectable()
export class DockerRuntimeEventsStreamService implements OnModuleInit, OnModuleDestroy {
	private readonly apiLogger = new AppLogger("api").scope(DockerRuntimeEventsStreamService.name);
	private readonly debugLogger = this.apiLogger.createContextFilterLogger({
		defaultClassName: DockerRuntimeEventsStreamService.name,
		filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
		channel: "docker-runtime-events-stream",
	});

	private readonly runtimeEvents$ = new ReplaySubject<DockerRuntimeEvent>(1);
	private runtimeEventRelaySubscription: Subscription | null = null;
	private relayedEventCount = 0;

	constructor(
		private readonly dockerRuntimeMeshRelayService: DockerRuntimeMeshRelayService,
	) {}

	onModuleInit(): void {
		if (this.runtimeEventRelaySubscription) {
			return;
		}

		this.runtimeEventRelaySubscription = this.dockerRuntimeMeshRelayService.observeRuntimeEvents().subscribe({
			next: (event) => {
				this.relayedEventCount += 1;
				this.runtimeEvents$.next(event);

				if (this.shouldTraceEvent(this.relayedEventCount)) {
					this.debug("onModuleInit", {
						phase: "runtime_event_relayed",
						count: this.relayedEventCount,
						source: event.source,
						action: event.action,
						actorId: event.actorId,
						eventId: event.eventId,
					});
				}
			},
			error: (error: unknown) => {
				this.debug("onModuleInit", {
					phase: "runtime_event_relay_error",
					message: error instanceof Error ? error.message : String(error),
				});
			},
		});

		this.debug("onModuleInit", {
			phase: "runtime_event_relay_started",
		});
	}

	onModuleDestroy(): void {
		this.runtimeEventRelaySubscription?.unsubscribe();
		this.runtimeEventRelaySubscription = null;
		this.runtimeEvents$.complete();

		this.debug("onModuleDestroy", {
			phase: "runtime_event_relay_stopped",
			relayedEventCount: this.relayedEventCount,
		});
	}

	observeEvents(): Observable<DockerRuntimeEvent> {
		return this.runtimeEvents$.asObservable();
	}

	private shouldTraceEvent(count: number): boolean {
		return count <= 20 || count % 100 === 0;
	}

	private debug(source: unknown, context?: Record<string, unknown>): void {
		this.debugLogger.debug(source, context);
	}
}