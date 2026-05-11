import { Injectable } from "@nestjs/common";
import { merge, type Observable } from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";
import { DockerContainerRuntimeEventsService } from "./container/docker-container-runtime-events.service";
import { DockerImageRuntimeEventsService } from "./image/docker-image-runtime-events.service";
import { DockerNetworkRuntimeEventsService } from "./network/docker-network-runtime-events.service";
import { DockerVolumeRuntimeEventsService } from "./volume/docker-volume-runtime-events.service";
import { DockerStackRuntimeEventsService } from "./stack/docker-stack-runtime-events.service";
import { DockerRuntimeSystemEventsService } from "./system/docker-runtime-system-events.service";

@Injectable()
export class DockerDomainRuntimeEventsService {
  constructor(
    private readonly dockerContainerRuntimeEventsService: DockerContainerRuntimeEventsService,
    private readonly dockerImageRuntimeEventsService: DockerImageRuntimeEventsService,
    private readonly dockerNetworkRuntimeEventsService: DockerNetworkRuntimeEventsService,
    private readonly dockerVolumeRuntimeEventsService: DockerVolumeRuntimeEventsService,
    private readonly dockerStackRuntimeEventsService: DockerStackRuntimeEventsService,
    private readonly dockerRuntimeSystemEventsService: DockerRuntimeSystemEventsService,
  ) {}

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
    return merge(
      this.dockerContainerRuntimeEventsService.stream(query),
      this.dockerImageRuntimeEventsService.stream(query),
      this.dockerNetworkRuntimeEventsService.stream(query),
      this.dockerVolumeRuntimeEventsService.stream(query),
      this.dockerStackRuntimeEventsService.stream(query),
      this.dockerRuntimeSystemEventsService.stream(query),
    );
  }
}
