import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createModuleContext } from "@deployer/nest-effect";

import { DockerCatalogModule } from "../../catalog/docker-catalog.module";
import { DockerCommonModule } from "../../common/docker-common.module";
import { SwarmActivityEnricherService } from "../../common/events/swarm-activity-enricher.service";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainersModule } from "../containers/docker-containers.module";

import { DockerRuntimeActivityDomainService } from "./orchestration/docker-runtime-activity-domain.service";
import { DockerRuntimeActivity } from "./orchestration/docker-runtime-activity.service";
import { DockerRuntimeOrchestratorService } from "./orchestration/docker-runtime-orchestrator.service";

export class DockerRuntimeModule extends createModuleContext({
  imports: [DockerCatalogModule, DockerCommonModule, DockerContainersModule, DockerRepositoriesModule],
  providers: [
    DockerRuntimeActivityDomainService,
    { provide: DockerRuntimeActivity, useValue: DockerRuntimeActivity.live },
    { provide: SwarmActivityEnricherService, useFactory: (engine: DockerEngineShape) => new SwarmActivityEnricherService(engine), inject: [DockerEngine] },
    DockerRuntimeOrchestratorService,
  ],
  exports: [
    DockerRuntimeActivity,
    DockerRuntimeActivityDomainService,
    DockerRuntimeOrchestratorService,
  ],
}) {}