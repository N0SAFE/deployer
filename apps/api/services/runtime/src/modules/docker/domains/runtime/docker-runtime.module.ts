import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createModuleContext } from "@deployer/nest-effect";

import { DockerCatalogModule } from "../../catalog/docker-catalog.module";
import { DockerCommonModule } from "../../common/docker-common.module";
import { SwarmActivityEnricherService } from "../../common/events/swarm-activity-enricher.service";
import { DockerRuntimeStreamOrchestratorService } from "../../common/runtime/docker-runtime-stream-orchestrator.service";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainersModule } from "../containers/docker-containers.module";

import { DockerRuntimeActivityDomainService } from "./orchestration/docker-runtime-activity-domain.service";
import { DockerRuntimeActivity } from "./orchestration/docker-runtime-activity.service";
import { DockerRuntimeOrchestratorService } from "./orchestration/docker-runtime-orchestrator.service";

export class DockerRuntimeModule extends createModuleContext({
  imports: [DockerCatalogModule, DockerCommonModule, DockerContainersModule, DockerRepositoriesModule],
  providers: [
    {
      provide: DockerRuntimeActivityDomainService,
      useFactory: (streams: DockerRuntimeStreamOrchestratorService, enricher: SwarmActivityEnricherService) =>
        new DockerRuntimeActivityDomainService(streams, enricher),
      inject: [DockerRuntimeStreamOrchestratorService, SwarmActivityEnricherService],
    },
    { provide: DockerRuntimeActivity, useValue: DockerRuntimeActivity.live },
    { provide: SwarmActivityEnricherService, useFactory: (engine: DockerEngineShape) => new SwarmActivityEnricherService(engine), inject: [DockerEngine] },
    {
      provide: DockerRuntimeOrchestratorService,
      useFactory: (domain: DockerRuntimeActivityDomainService, streams: DockerRuntimeStreamOrchestratorService) =>
        new DockerRuntimeOrchestratorService(domain, streams),
      inject: [DockerRuntimeActivityDomainService, DockerRuntimeStreamOrchestratorService],
    },
  ],
  exports: [
    DockerRuntimeActivity,
    DockerRuntimeActivityDomainService,
    DockerRuntimeOrchestratorService,
  ],
}) {}