import { Injectable } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import type {
  DockerBuilderRuntimeEvent,
  DockerConfigRuntimeEvent,
  DockerDaemonRuntimeEvent,
  DockerNodeRuntimeEvent,
  DockerRuntimeEvent,
  DockerSecretRuntimeEvent,
  DockerUnknownRuntimeEvent,
} from "@repo/contracts-entities";
import { DockerRuntimeEventsSourceService } from "../docker-runtime-events-source.service";

type DockerRuntimeSystemEvent =
  | DockerBuilderRuntimeEvent
  | DockerConfigRuntimeEvent
  | DockerDaemonRuntimeEvent
  | DockerNodeRuntimeEvent
  | DockerSecretRuntimeEvent
  | DockerUnknownRuntimeEvent;

@Injectable()
export class DockerRuntimeSystemEventsService {
  constructor(
    private readonly dockerRuntimeEventsSourceService: DockerRuntimeEventsSourceService,
  ) {}

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeSystemEvent> {
    return this.dockerRuntimeEventsSourceService.stream(query).pipe(
      filter((event): event is DockerRuntimeSystemEvent => this.isSystemSource(event)),
    );
  }

  private isSystemSource(event: DockerRuntimeEvent): event is DockerRuntimeSystemEvent {
    switch (event.source) {
      case "builder":
      case "config":
      case "daemon":
      case "node":
      case "secret":
      case "unknown":
        return true;
      default:
        return false;
    }
  }
}
