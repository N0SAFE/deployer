import { Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { EffectRuntime } from "@deployer/nest-effect";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { DockerContainerMetricsStreamService } from "../domains/containers/events/docker-container-metrics-stream.service";
import { DockerRepository } from "../repositories/facade/docker.repository";
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
    {
      provide: DockerRuntimeEventsSourceService,
      useFactory: (engine: DockerEngineShape, pool: CoreEventStreamPoolService) => new DockerRuntimeEventsSourceService(engine, pool),
      inject: [DockerEngine, CoreEventStreamPoolService],
    },
    {
      provide: DockerRuntimeMeshRelayService,
      useFactory: (
        topics: SystemMeshTopicService,
        topology: SystemMeshTopologyService,
        runtimeEvents: DockerRuntimeEventsSourceService,
      ) => new DockerRuntimeMeshRelayService(topics, topology, runtimeEvents),
      inject: [SystemMeshTopicService, SystemMeshTopologyService, DockerRuntimeEventsSourceService],
    },
    {
      provide: DockerRuntimeEventsStreamService,
      useFactory: (relay: DockerRuntimeMeshRelayService) => new DockerRuntimeEventsStreamService(relay),
      inject: [DockerRuntimeMeshRelayService],
    },
    {
      provide: DockerRuntimeActivityPersistenceService,
      useFactory: (events: DockerRuntimeEventsStreamService, runtime: EffectRuntime) =>
        new DockerRuntimeActivityPersistenceService(events, runtime),
      inject: [DockerRuntimeEventsStreamService, EffectRuntime],
    },
    {
      provide: DockerRuntimeStreamOrchestratorService,
      useFactory: (
        events: DockerRuntimeEventsStreamService,
        runtime: EffectRuntime,
        metrics: DockerContainerMetricsStreamService,
        repository: DockerRepository,
      ) => new DockerRuntimeStreamOrchestratorService(events, runtime, metrics, repository),
      inject: [DockerRuntimeEventsStreamService, EffectRuntime, DockerContainerMetricsStreamService, DockerRepository],
    },
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