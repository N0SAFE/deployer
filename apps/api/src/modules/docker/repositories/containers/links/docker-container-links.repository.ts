import { Injectable } from "@nestjs/common";
import type { DockerContainerLinkPath } from "@repo/contracts-entities";
import { DockerRepository } from "../../facade/docker.repository";

@Injectable()
export class DockerContainerLinksRepository {
  constructor(private readonly dockerRepository: DockerRepository) {}

  attachContainerLinks(
    ...args: Parameters<DockerRepository["attachContainerLinks"]>
  ): ReturnType<DockerRepository["attachContainerLinks"]> {
    return this.dockerRepository.attachContainerLinks(...args);
  }
}
