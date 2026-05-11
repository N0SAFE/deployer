import { Injectable } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import type { DockerServiceRuntimeEvent } from "@repo/contracts-entities";
import { DockerRuntimeEventsSourceService } from "../docker-runtime-events-source.service";

@Injectable()
export class DockerStackRuntimeEventsService {
  constructor(
    private readonly dockerRuntimeEventsSourceService: DockerRuntimeEventsSourceService,
  ) {}

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerServiceRuntimeEvent> {
    return this.dockerRuntimeEventsSourceService.stream(query).pipe(
      filter((event): event is DockerServiceRuntimeEvent => event.source === "service"),
    );
  }
}
