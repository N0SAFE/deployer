import { Injectable } from "@nestjs/common";
import type { DockerVolumeListInput } from "@repo/runtime-contracts/modules/docker/volumes/list";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";

@Injectable()
export class DockerVolumesDomainService {
  constructor(private readonly dockerContainerResolutionService: DockerContainerResolutionService) {}

  listVolumes(input: DockerVolumeListInput) {
    return this.dockerContainerResolutionService.listVolumes(input);
  }
}
