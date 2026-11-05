import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import {
    createModuleContext,
    effectHostProvider,
    EffectHost,
    serviceLifecycle,
    type EffectHostShape,
} from '@deployer/nest-effect'
import { CoreDockerModule } from '@deployer/shared/core/modules/docker/docker.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '@deployer/shared/core/modules/events/base/index'
import { EventsModule } from '@deployer/shared/core/modules/events/events.module'

import { DockerContainersModule } from '../domains/containers/docker-containers.module'
import { DockerContainerMetricsStreamService } from '../domains/containers/events/docker-container-metrics-stream.service'
import {
    DOCKER_NODE_MESH,
    type DockerNodeMesh,
} from '../domains/containers/mesh/docker-node-mesh'
import { DockerRepositoriesModule } from '../repositories/docker-repositories.module'
import { DockerRepository } from '../repositories/facade/docker.repository'

import { DockerRuntimeActivityPersistenceService } from './events/docker-runtime-activity-persistence.service'
import { DockerRuntimeEventsSourceService } from './events/docker-runtime-events-source.service'
import {
    DockerRuntimeEventsStreamService,
    type DockerRuntimeEventsStreamShape,
} from './events/docker-runtime-events-stream.service'
import { DockerRuntimeMeshRelayService } from './mesh/docker-runtime-mesh-relay.service'
import { DockerRuntimeStreamOrchestratorService } from './runtime/docker-runtime-stream-orchestrator.service'

export class DockerCommonModule extends createModuleContext({
    imports: [
        CoreDockerModule,
        EventsModule,
        DockerRepositoriesModule,
        DockerContainersModule,
    ],
    providers: [
        effectHostProvider(),
        {
            provide: DockerRuntimeEventsSourceService,
            useFactory: (
                engine: DockerEngineShape,
                pool: CoreEventStreamPoolServiceShape
            ) => new DockerRuntimeEventsSourceService(engine, pool),
            inject: [DockerEngine, CoreEventStreamPoolService],
        },
        {
            provide: DockerRuntimeMeshRelayService,
            useFactory: (
                runtimeEvents: DockerRuntimeEventsSourceService,
                mesh: DockerNodeMesh
            ) => new DockerRuntimeMeshRelayService(runtimeEvents, mesh),
            inject: [DockerRuntimeEventsSourceService, DOCKER_NODE_MESH],
        },
        {
            provide: DockerRuntimeEventsStreamService,
            useFactory: (relay: DockerRuntimeMeshRelayService) =>
                DockerRuntimeEventsStreamService.make(relay),
            inject: [DockerRuntimeMeshRelayService],
        },
        {
            provide: DockerRuntimeActivityPersistenceService,
            useFactory: (
                events: DockerRuntimeEventsStreamShape,
                host: EffectHostShape
            ) => DockerRuntimeActivityPersistenceService.make(events, host),
            inject: [DockerRuntimeEventsStreamService, EffectHost],
        },
        {
            provide: DockerRuntimeStreamOrchestratorService,
            useFactory: (
                events: DockerRuntimeEventsStreamShape,
                host: EffectHostShape,
                metrics: DockerContainerMetricsStreamService,
                repository: DockerRepository
            ) =>
                new DockerRuntimeStreamOrchestratorService(
                    events,
                    host,
                    metrics,
                    repository
                ),
            inject: [
                DockerRuntimeEventsStreamService,
                EffectHost,
                DockerContainerMetricsStreamService,
                DockerRepository,
            ],
        },
        // Both declare their lifetime in their shape; one generic runner binds it to the app's start and stop.
        serviceLifecycle(DockerRuntimeEventsStreamService),
        serviceLifecycle(DockerRuntimeActivityPersistenceService),
    ],
    exports: [
        DockerRuntimeEventsSourceService,
        DockerRuntimeMeshRelayService,
        DockerRuntimeEventsStreamService,
        DockerRuntimeActivityPersistenceService,
        DockerRuntimeStreamOrchestratorService,
    ],
}) {}
