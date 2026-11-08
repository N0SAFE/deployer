import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import {
    createModuleContext,
    EffectHost,
    effectHostProvider,
    type EffectHostShape,
} from '@deployer/nest-effect'
import { CoreDockerModule } from '@deployer/shared/core/modules/docker/docker.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '@deployer/shared/core/modules/events/base/index'
import { EventsModule } from '@deployer/shared/core/modules/events/events.module'

import { runtimeReplicaId } from '../../../../core/mesh/runtime-replica-id'
import { DockerRepositoriesModule } from '../../repositories/docker-repositories.module'
import { DockerRepository } from '../../repositories/facade/docker.repository'

import { DockerContainerMetricsStreamService } from './events/docker-container-metrics-stream.service'
import {
    DOCKER_NODE_MESH,
    NODE_AGENT,
    dockerNodeMeshOver,
    type NodeAgent,
} from './mesh/docker-node-mesh'
import {
    LOCAL_NODE_OPERATIONS,
    makeLocalNodeOperations,
} from './mesh/local-node-operations'
import {
    ContainersLocalPort,
    ContainersMeshPort,
    DockerContainerResolution,
} from './orchestration/docker-container-resolution'
import { DockerContainersOrchestratorService } from './orchestration/docker-containers-orchestrator.service'
import { DockerContainers } from './orchestration/docker-containers.service'
import {
    ContainerAccessMeshPort,
    DockerContainerAccess,
} from './runtime/docker-container-access'
import { DockerContainerOps } from './runtime/docker-container-ops'
import { containerStreamsOver } from './runtime/docker-container-streams'
import { DockerTerminalSessions } from './runtime/docker-terminal-sessions'

export class DockerContainersModule extends createModuleContext({
    imports: [CoreDockerModule, EventsModule, DockerRepositoriesModule],
    providers: [
        effectHostProvider(),
        // Built by factories rather than by decorator: they take collaborators, not Nest metadata.
        { provide: DockerContainerOps, useClass: DockerContainerOps.live },
        {
            provide: DockerTerminalSessions,
            useValue: DockerTerminalSessions.live,
        },
        { provide: ContainerAccessMeshPort, useExisting: DOCKER_NODE_MESH },
        {
            provide: DockerContainerAccess,
            useClass: DockerContainerAccess.live,
        },
        {
            provide: DockerContainerMetricsStreamService,
            useFactory: (
                engine: DockerEngineShape,
                pool: CoreEventStreamPoolServiceShape
            ) => new DockerContainerMetricsStreamService(engine, pool),
            inject: [DockerEngine, CoreEventStreamPoolService],
        },
        // The runtime asks the other nodes through the agent of its own node. The holder is empty until `joinRuntimeMesh` fills it,
        // and a runtime with no agent is simply alone on its node: every question to the mesh answers with nobody.
        {
            provide: NODE_AGENT,
            useFactory: (): NodeAgent => ({
                link: undefined,
                selfReplicaId: runtimeReplicaId(),
            }),
        },
        {
            provide: DOCKER_NODE_MESH,
            useFactory: (holder: NodeAgent) => dockerNodeMeshOver(holder),
            inject: [NODE_AGENT],
        },
        // Container resolution is a constant Effect service; the Nest providers it reads come in as ports.
        { provide: ContainersMeshPort, useExisting: DOCKER_NODE_MESH },
        { provide: ContainersLocalPort, useExisting: DockerRepository },
        {
            provide: DockerContainerResolution,
            useClass: DockerContainerResolution.live,
        },
        {
            provide: LOCAL_NODE_OPERATIONS,
            useFactory: (host: EffectHostShape, repository: DockerRepository) =>
                makeLocalNodeOperations(host, repository),
            inject: [EffectHost, DockerRepository],
        },
        // The container surface: unary calls live on `DockerContainers` (each yields its collaborator); the streams keep
        // the RxJS shape and the host is only the adapter's runtime touchpoint.
        {
            provide: DockerContainersOrchestratorService,
            useFactory: (host: EffectHostShape) =>
                new DockerContainersOrchestratorService.live(
                    containerStreamsOver(host)
                ),
            inject: [EffectHost],
        },
        { provide: DockerContainers, useValue: DockerContainers.live },
    ],
    exports: [
        LOCAL_NODE_OPERATIONS,
        NODE_AGENT,
        DOCKER_NODE_MESH,
        DockerContainerMetricsStreamService,
        DockerContainerResolution,
        DockerContainersOrchestratorService,
        DockerContainers,
        // The ports `DockerContainerResolution` and `DockerContainerAccess` read: a controller hands them back through
        // `Effect.context` inside its own module scope, so the module that provides them must export them.
        ContainersMeshPort,
        ContainersLocalPort,
        DockerContainerAccess,
        ContainerAccessMeshPort,
        DockerContainerOps,
        DockerTerminalSessions,
    ],
}) {}
