import { Module } from "@nestjs/common"
import { EventsModule as CoreEventsModule } from "@deployer/shared/core/modules/events/events.module"
import { DockerCommonModule } from "../../common/docker-common.module"
import { DockerContainersModule } from "../containers/docker-containers.module"
import { DockerImagesModule } from "../images/docker-images.module"
import { DockerCatalogModule } from "../../catalog/docker-catalog.module"
import { DockerEntityCacheService } from "./orchestration/docker-entity-cache.service"
import { DockerEntityDomainService } from "./orchestration/docker-entity-domain.service"
import { DockerEntityOrchestratorService } from "./orchestration/docker-entity-orchestrator.service"

@Module({
  imports: [
    CoreEventsModule,
    DockerCommonModule,
    DockerContainersModule,
    DockerImagesModule,
    DockerCatalogModule,
  ],
  providers: [
    DockerEntityCacheService,
    DockerEntityDomainService,
    DockerEntityOrchestratorService,
  ],
  exports: [
    DockerEntityCacheService,
    DockerEntityDomainService,
    DockerEntityOrchestratorService,
  ],
})
export class DockerEntityModule {}
