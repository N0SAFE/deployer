import { Injectable } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import type { DockerContainerRuntimeEvent } from "@repo/contracts-entities";
import { DockerRuntimeEventsSourceService } from "../docker-runtime-events-source.service";

@Injectable()
export class DockerContainerRuntimeEventsService {
  constructor(
    private readonly dockerRuntimeEventsSourceService: DockerRuntimeEventsSourceService,
  ) {}

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerContainerRuntimeEvent> {
    return this.dockerRuntimeEventsSourceService.stream(query).pipe(
      filter((event): event is DockerContainerRuntimeEvent => event.source === "container"),
    );
  }
}
