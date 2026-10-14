import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { DockerRepositoriesModule } from "../repositories/docker-repositories.module";
import { DockerContainersModule } from "../domains/containers/docker-containers.module";
import { DockerRuntimeEventsSourceService } from "./events/docker-runtime-events-source.service";
import { DockerDomainRuntimeEventsService } from "./events/docker-domain-runtime-events.service";
import { DockerContainerRuntimeEventsService } from "./events/container/docker-container-runtime-events.service";
import { DockerImageRuntimeEventsService } from "./events/image/docker-image-runtime-events.service";
import { DockerNetworkRuntimeEventsService } from "./events/network/docker-network-runtime-events.service";
import { DockerVolumeRuntimeEventsService } from "./events/volume/docker-volume-runtime-events.service";
import { DockerStackRuntimeEventsService } from "./events/stack/docker-stack-runtime-events.service";
import { DockerRuntimeSystemEventsService } from "./events/system/docker-runtime-system-events.service";
import { DockerRuntimeEventsStreamService } from "./events/docker-runtime-events-stream.service";
import { DockerRuntimeActivityPersistenceService } from "./events/docker-runtime-activity-persistence.service";
import { DockerRuntimeMeshRelayService } from "./mesh/docker-runtime-mesh-relay.service";
import { DockerRuntimeStreamOrchestratorService } from "./runtime/docker-runtime-stream-orchestrator.service";

@Module({
  imports: [MeshCoreModule, CoreDockerModule, EventsModule, DockerRepositoriesModule, DockerContainersModule],
  providers: [
    DockerRuntimeEventsSourceService,
    DockerContainerRuntimeEventsService,
    DockerImageRuntimeEventsService,
    DockerNetworkRuntimeEventsService,
    DockerVolumeRuntimeEventsService,
    DockerStackRuntimeEventsService,
    DockerRuntimeSystemEventsService,
    DockerDomainRuntimeEventsService,
    DockerRuntimeMeshRelayService,
    DockerRuntimeEventsStreamService,
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeStreamOrchestratorService,
  ],
  exports: [
    DockerRuntimeEventsSourceService,
    DockerContainerRuntimeEventsService,
    DockerImageRuntimeEventsService,
    DockerNetworkRuntimeEventsService,
    DockerVolumeRuntimeEventsService,
    DockerStackRuntimeEventsService,
    DockerRuntimeSystemEventsService,
    DockerDomainRuntimeEventsService,
    DockerRuntimeMeshRelayService,
    DockerRuntimeEventsStreamService,
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeStreamOrchestratorService,
  ],
})
export class DockerCommonModule {}