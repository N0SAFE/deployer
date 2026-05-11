import { Module } from "@nestjs/common";
import { DockerCommonModule } from "../../common/docker-common.module";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerRuntimeActivityDomainService } from "./orchestration/docker-runtime-activity-domain.service";
import { DockerRuntimeOrchestratorService } from "./orchestration/docker-runtime-orchestrator.service";

@Module({
  imports: [DockerCommonModule, DockerContainersModule, DockerRepositoriesModule],
  providers: [
    DockerRuntimeActivityDomainService,
    DockerRuntimeOrchestratorService,
  ],
  exports: [
    DockerRuntimeActivityDomainService,
    DockerRuntimeOrchestratorService,
  ],
})
export class DockerRuntimeModule {}