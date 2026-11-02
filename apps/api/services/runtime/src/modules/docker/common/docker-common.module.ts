import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createModuleContext, effectHostProvider, EffectHost, type EffectHostShape } from "@deployer/nest-effect";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";

import { DockerContainersModule } from "../domains/containers/docker-containers.module";
import { DockerContainerMetricsStreamService } from "../domains/containers/events/docker-container-metrics-stream.service";
import { DOCKER_NODE_MESH, type DockerNodeMesh } from "../domains/containers/mesh/docker-node-mesh";
import { DockerRepositoriesModule } from "../repositories/docker-repositories.module";
import { DockerRepository } from "../repositories/facade/docker.repository";

import { DockerRuntimeActivityPersistenceService } from "./events/docker-runtime-activity-persistence.service";
import { DockerRuntimeEventsSourceService } from "./events/docker-runtime-events-source.service";
import { DockerRuntimeEventsStreamService } from "./events/docker-runtime-events-stream.service";
import { DockerRuntimeMeshRelayService } from "./mesh/docker-runtime-mesh-relay.service";
import { DockerRuntimeStreamOrchestratorService } from "./runtime/docker-runtime-stream-orchestrator.service";

export class DockerCommonModule extends createModuleContext({
  imports: [CoreDockerModule, EventsModule, DockerRepositoriesModule, DockerContainersModule],
  providers: [
    effectHostProvider(),
    {
      provide: DockerRuntimeEventsSourceService,
      useFactory: (engine: DockerEngineShape, pool: CoreEventStreamPoolService) => new DockerRuntimeEventsSourceService(engine, pool),
      inject: [DockerEngine, CoreEventStreamPoolService],
    },
    {
      provide: DockerRuntimeMeshRelayService,
      useFactory: (runtimeEvents: DockerRuntimeEventsSourceService, mesh: DockerNodeMesh) =>
        new DockerRuntimeMeshRelayService(runtimeEvents, mesh),
      inject: [DockerRuntimeEventsSourceService, DOCKER_NODE_MESH],
    },
    {
      provide: DockerRuntimeEventsStreamService,
      useFactory: (relay: DockerRuntimeMeshRelayService) => new DockerRuntimeEventsStreamService(relay),
      inject: [DockerRuntimeMeshRelayService],
    },
    {
      provide: DockerRuntimeActivityPersistenceService,
      useFactory: (events: DockerRuntimeEventsStreamService, host: EffectHostShape) =>
        new DockerRuntimeActivityPersistenceService(events, host),
      inject: [DockerRuntimeEventsStreamService, EffectHost],
    },
    {
      provide: DockerRuntimeStreamOrchestratorService,
      useFactory: (
        events: DockerRuntimeEventsStreamService,
        host: EffectHostShape,
        metrics: DockerContainerMetricsStreamService,
        repository: DockerRepository,
      ) => new DockerRuntimeStreamOrchestratorService(events, host, metrics, repository),
      inject: [DockerRuntimeEventsStreamService, EffectHost, DockerContainerMetricsStreamService, DockerRepository],
    },
  ],
  exports: [
    DockerRuntimeEventsSourceService,
    DockerRuntimeMeshRelayService,
    DockerRuntimeEventsStreamService,
    DockerRuntimeActivityPersistenceService,
    DockerRuntimeStreamOrchestratorService,
  ],
}) {}