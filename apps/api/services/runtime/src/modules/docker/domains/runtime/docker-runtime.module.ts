import { Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { DockerCommonModule } from "../../common/docker-common.module";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { SwarmActivityEnricherService } from "../../common/events/swarm-activity-enricher.service";
import { DockerRuntimeActivityDomainService } from "./orchestration/docker-runtime-activity-domain.service";
import { DockerRuntimeOrchestratorService } from "./orchestration/docker-runtime-orchestrator.service";

@Module({
  imports: [DockerCommonModule, DockerContainersModule, DockerRepositoriesModule],
  providers: [
    DockerRuntimeActivityDomainService,
    { provide: SwarmActivityEnricherService, useFactory: (engine: DockerEngineShape) => new SwarmActivityEnricherService(engine), inject: [DockerEngine] },
    DockerRuntimeOrchestratorService,
  ],
  exports: [
    DockerRuntimeActivityDomainService,
    DockerRuntimeOrchestratorService,
  ],
})
export class DockerRuntimeModule {}