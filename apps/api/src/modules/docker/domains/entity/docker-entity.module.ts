import { Module } from "@nestjs/common"
import { EventsModule as CoreEventsModule } from "@/core/modules/events/events.module"
import { DockerCommonModule } from "../../common/docker-common.module"
import { DockerContainersModule } from "../containers/docker-containers.module"
import { DockerImagesModule } from "../images/docker-images.module"
import { DockerNetworksModule } from "../networks/docker-networks.module"
import { DockerVolumesModule } from "../volumes/docker-volumes.module"
import { DockerEntityCacheService } from "./orchestration/docker-entity-cache.service"
import { DockerEntityDomainService } from "./orchestration/docker-entity-domain.service"
import { DockerEntityOrchestratorService } from "./orchestration/docker-entity-orchestrator.service"

@Module({
  imports: [
    CoreEventsModule,
    DockerCommonModule,
    DockerContainersModule,
    DockerImagesModule,
    DockerNetworksModule,
    DockerVolumesModule,
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
