import { Module } from "@nestjs/common";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerRegistriesOrchestratorService } from "./orchestration/docker-registries-orchestrator.service";
import { DockerRegistriesDomainService } from "./runtime/docker-registries-domain.service";

@Module({
  imports: [DockerContainersModule],
  providers: [DockerRegistriesDomainService, DockerRegistriesOrchestratorService],
  exports: [DockerRegistriesDomainService, DockerRegistriesOrchestratorService],
})
export class DockerRegistriesModule {}