import { Module } from "@nestjs/common";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerNetworksOrchestratorService } from "./orchestration/docker-networks-orchestrator.service";
import { DockerNetworksDomainService } from "./runtime/docker-networks-domain.service";

@Module({
  imports: [DockerContainersModule],
  providers: [DockerNetworksDomainService, DockerNetworksOrchestratorService],
  exports: [DockerNetworksDomainService, DockerNetworksOrchestratorService],
})
export class DockerNetworksModule {}