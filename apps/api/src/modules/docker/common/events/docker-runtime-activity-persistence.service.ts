import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
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

    this.runtimeEventSubscription = this.dockerRuntimeEventsStreamService.observeEvents().subscribe({
      next: (event) => {
        void this.dockerRuntimeActivityRepository.persistRuntimeActivityEvent(event)
          .catch((error: unknown) => {
            this.debugLogger.debug("persist_runtime_activity_failed", {
              message: error instanceof Error ? error.message : String(error),
              source: event.source,
              action: event.action,
              eventId: event.eventId,
            });
          });
      },
      error: (error: unknown) => {
        this.debugLogger.debug("runtime_event_stream_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  onModuleDestroy(): void {
    this.runtimeEventSubscription?.unsubscribe();
    this.runtimeEventSubscription = null;
  }
}
