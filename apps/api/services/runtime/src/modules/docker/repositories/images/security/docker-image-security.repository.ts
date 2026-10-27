import { Injectable } from "@nestjs/common";
import { DockerRepository } from "../../facade/docker.repository";

@Injectable()
export class DockerImageSecurityRepository {
  constructor(private readonly dockerRepository: DockerRepository) {}

  streamImageSecurityScan(
    ...args: Parameters<DockerRepository["streamImageSecurityScan"]>
  ): ReturnType<DockerRepository["streamImageSecurityScan"]> {
    return this.dockerRepository.streamImageSecurityScan(...args);
  }

  getPersistedImageSecurityScan(
    ...args: Parameters<DockerRepository["getPersistedImageSecurityScan"]>
  ): ReturnType<DockerRepository["getPersistedImageSecurityScan"]> {
    return this.dockerRepository.getPersistedImageSecurityScan(...args);
  }

  ensureImageAutoScanEligibility(
    ...args: Parameters<DockerRepository["ensureImageAutoScanEligibility"]>
  ): ReturnType<DockerRepository["ensureImageAutoScanEligibility"]> {
    return this.dockerRepository.ensureImageAutoScanEligibility(...args);
  }

  reconcileImageLifecycleWithActiveSet(
    ...args: Parameters<DockerRepository["reconcileImageLifecycleWithActiveSet"]>
  ): ReturnType<DockerRepository["reconcileImageLifecycleWithActiveSet"]> {
    return this.dockerRepository.reconcileImageLifecycleWithActiveSet(...args);
  }
}
