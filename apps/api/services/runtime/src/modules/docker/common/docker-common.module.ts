import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { DockerRepositoriesModule } from "../repositories/docker-repositories.module";
import { DockerContainersModule } from "../domains/containers/docker-containers.module";
import { DockerRuntimeEventsSourceService } from "./events/docker-runtime-events-source.service";
import { DockerRuntimeEventsStreamService } from "./events/docker-runtime-events-stream.service";
import { DockerRuntimeActivityPersistenceService } from "./events/docker-runtime-activity-persistence.service";
import { SystemMeshTopicService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { DockerRuntimeMeshRelayService } from "./mesh/docker-runtime-mesh-relay.service";
import { DockerRuntimeStreamOrchestratorService } from "./runtime/docker-runtime-stream-orchestrator.service";

@Module({
  imports: [MeshCoreModule, CoreDockerModule, EventsModule, DockerRepositoriesModule, DockerContainersModule],
  providers: [
    DockerRuntimeEventsSourceService,
    {
      provide: DockerRuntimeMeshRelayService,
      useFactory: (
        topics: SystemMeshTopicService,
        topology: SystemMeshTopologyService,
        runtimeEvents: DockerRuntimeEventsSourceService,
      ) => new DockerRuntimeMeshRelayService(topics, topology, runtimeEvents),
      inject: [SystemMeshTopicService, SystemMeshTopologyService, DockerRuntimeEventsSourceService],
    },
    DockerRuntimeEventsStreamService,
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeStreamOrchestratorService,
  ],
  exports: [
    DockerRuntimeEventsSourceService,
    DockerRuntimeMeshRelayService,
    DockerRuntimeEventsStreamService,
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeStreamOrchestratorService,
  ],
})
export class DockerCommonModule {}