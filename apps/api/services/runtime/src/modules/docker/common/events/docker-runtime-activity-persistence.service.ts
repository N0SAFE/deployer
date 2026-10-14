import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Subscription, concatMap, from, EMPTY, catchError } from "rxjs";
import { AppLogger } from "@repo/logger";
import { DockerRuntimeEventsStreamService } from "./docker-runtime-events-stream.service";
import { DockerRuntimeActivityRepository } from "../../repositories/runtime/docker-runtime-activity.repository";

@Injectable()
export class DockerRuntimeActivityPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly apiLogger = new AppLogger("api").scope(DockerRuntimeActivityPersistenceService.name);
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerRuntimeActivityPersistenceService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-runtime-activity-persistence",
  });

  private runtimeEventSubscription: Subscription | null = null;

  constructor(
    private readonly dockerRuntimeEventsStreamService: DockerRuntimeEventsStreamService,
    private readonly dockerRuntimeActivityRepository: DockerRuntimeActivityRepository,
  ) {}

  onModuleInit(): void {
    if (this.runtimeEventSubscription) {
      return;
    }

    // Use concatMap to process events SEQUENTIALLY — prevents pool exhaustion
    // by ensuring each database insert completes before the next begins.
    // The fire-and-forget pattern (void + .catch()) caused concurrent inserts
    // that exhausted the 20-connection pool during event bursts (e.g. scan
    // progress updates), leading to cascading timeouts on all database queries.
    this.runtimeEventSubscription = this.dockerRuntimeEventsStreamService
      .observeEvents()
      .pipe(
        concatMap((event) =>
          from(this.dockerRuntimeActivityRepository.persistRuntimeActivityEvent(event)).pipe(
            catchError((error: unknown) => {
              this.debugLogger.debug("persist_runtime_activity_failed", {
                message: error instanceof Error ? error.message : String(error),
                source: event.source,
                action: event.action,
                eventId: event.eventId,
              });
              return EMPTY;
            }),
          ),
        ),
        catchError((error: unknown) => {
          this.debugLogger.debug("runtime_event_stream_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  onModuleDestroy(): void {
    this.runtimeEventSubscription?.unsubscribe();
    this.runtimeEventSubscription = null;
  }
}
