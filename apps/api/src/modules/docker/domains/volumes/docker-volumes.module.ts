import { Module } from "@nestjs/common";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerVolumesOrchestratorService } from "./orchestration/docker-volumes-orchestrator.service";
import { DockerVolumesDomainService } from "./runtime/docker-volumes-domain.service";

@Module({
  imports: [DockerContainersModule],
  providers: [DockerVolumesDomainService, DockerVolumesOrchestratorService],
  exports: [DockerVolumesDomainService, DockerVolumesOrchestratorService],
})
export class DockerVolumesModule {}