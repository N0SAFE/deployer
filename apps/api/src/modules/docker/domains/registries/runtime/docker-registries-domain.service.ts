import { Injectable } from "@nestjs/common";
import type { DockerRegistryListInput } from "@repo/api-contracts/modules/docker/registries/list";
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service";

@Injectable()
export class DockerRegistriesDomainService {
  constructor(private readonly dockerContainerResolutionService: DockerContainerResolutionService) {}

  listRegistries(input: DockerRegistryListInput) {
    return this.dockerContainerResolutionService.listRegistries(input);
  }
}
