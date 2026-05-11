import { Module } from "@nestjs/common";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerStacksOrchestratorService } from "./orchestration/docker-stacks-orchestrator.service";
import { DockerStacksDomainService } from "./runtime/docker-stacks-domain.service";

@Module({
  imports: [DockerContainersModule],
  providers: [DockerStacksDomainService, DockerStacksOrchestratorService],
  exports: [DockerStacksDomainService, DockerStacksOrchestratorService],
})
export class DockerStacksModule {}