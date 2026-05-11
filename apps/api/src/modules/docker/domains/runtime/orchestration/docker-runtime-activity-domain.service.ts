import { Injectable } from "@nestjs/common";
import type {
  DockerRuntimeActivityDetailQueryInput,
  DockerRuntimeActivityListInput,
} from "@repo/api-contracts/modules/docker/runtime/activity";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";
import { DockerRuntimeStreamOrchestratorService } from "../../../common/runtime/docker-runtime-stream-orchestrator.service";
import { DockerRuntimeActivityRepository } from "../../../repositories/runtime/docker-runtime-activity.repository";

@Injectable()
export class DockerRuntimeActivityDomainService {
  constructor(
    private readonly dockerContainerResolutionService: DockerContainerResolutionService,
    private readonly dockerRuntimeStreamOrchestratorService: DockerRuntimeStreamOrchestratorService,
    private readonly dockerRuntimeActivityRepository: DockerRuntimeActivityRepository,
  ) {}

  getRuntimeSnapshot() {
    return this.dockerContainerResolutionService.getRuntimeCatalogSnapshot();
  }

  stream(input: DockerRuntimeEventsStreamQueryInput) {
    return this.dockerRuntimeStreamOrchestratorService.stream(input);
  }

  listRuntimeActivities(input: DockerRuntimeActivityListInput) {
    return this.dockerRuntimeActivityRepository.listRuntimeActivities(input);
  }

  getRuntimeActivityById(input: DockerRuntimeActivityDetailQueryInput) {
    return this.dockerRuntimeActivityRepository.getRuntimeActivityById(input);
  }
}
