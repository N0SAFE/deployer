import { Injectable } from "@nestjs/common";
import { DockerRepository } from "../facade/docker.repository";

@Injectable()
export class DockerRuntimeActivityRepository {
  constructor(private readonly dockerRepository: DockerRepository) {}

  listRuntimeActivities(
    ...args: Parameters<DockerRepository["listRuntimeActivities"]>
  ): ReturnType<DockerRepository["listRuntimeActivities"]> {
    return this.dockerRepository.listRuntimeActivities(...args);
  }

  getRuntimeActivityById(
    ...args: Parameters<DockerRepository["getRuntimeActivityById"]>
  ): ReturnType<DockerRepository["getRuntimeActivityById"]> {
    return this.dockerRepository.getRuntimeActivityById(...args);
  }

  persistRuntimeActivityEvent(
    ...args: Parameters<DockerRepository["persistRuntimeActivityEvent"]>
  ): ReturnType<DockerRepository["persistRuntimeActivityEvent"]> {
    return this.dockerRepository.persistRuntimeActivityEvent(...args);
  }
}
