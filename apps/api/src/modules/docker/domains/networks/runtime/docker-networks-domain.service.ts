import { Injectable } from "@nestjs/common";
import type { DockerNetworkListInput } from "@repo/api-contracts/modules/docker/networks/list";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";

@Injectable()
export class DockerNetworksDomainService {
  constructor(private readonly dockerContainerResolutionService: DockerContainerResolutionService) {}

  listNetworks(input: DockerNetworkListInput) {
    return this.dockerContainerResolutionService.listNetworks(input);
  }
}
