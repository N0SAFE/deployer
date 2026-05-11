import { Injectable } from "@nestjs/common";
import type { DockerStackListInput } from "@repo/api-contracts/modules/docker/stacks/list";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";

@Injectable()
export class DockerStacksDomainService {
  constructor(private readonly dockerContainerResolutionService: DockerContainerResolutionService) {}

  listStacks(input: DockerStackListInput) {
    return this.dockerContainerResolutionService.listStacks(input);
  }
}
