import { Module } from "@nestjs/common";
import { DockerCommonModule } from "../../common/docker-common.module";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerRuntimeActivityProjectorService } from "../../common/events/docker-runtime-activity-projector.service";
import { DockerRuntimeActivityDomainService } from "./orchestration/docker-runtime-activity-domain.service";
import { DockerRuntimeOrchestratorService } from "./orchestration/docker-runtime-orchestrator.service";

@Module({
  imports: [DockerCommonModule, DockerContainersModule, DockerRepositoriesModule],
  providers: [
    DockerRuntimeActivityDomainService,
    DockerRuntimeActivityProjectorService,
    DockerRuntimeOrchestratorService,
  ],
  exports: [
    DockerRuntimeActivityDomainService,
    DockerRuntimeActivityProjectorService,
    DockerRuntimeOrchestratorService,
  ],
})
export class DockerRuntimeModule {}