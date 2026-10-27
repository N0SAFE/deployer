import { Injectable } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@deployer/runtime-contracts/modules/docker/runtime/shared";
import type { DockerImageRuntimeEvent } from "@deployer/contracts-entities";
import { DockerRuntimeEventsSourceService } from "../docker-runtime-events-source.service";

@Injectable()
export class DockerImageRuntimeEventsService {
  constructor(
    private readonly dockerRuntimeEventsSourceService: DockerRuntimeEventsSourceService,
  ) {}

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerImageRuntimeEvent> {
    return this.dockerRuntimeEventsSourceService.stream(query).pipe(
      filter((event): event is DockerImageRuntimeEvent => event.source === "image"),
    );
  }
}
