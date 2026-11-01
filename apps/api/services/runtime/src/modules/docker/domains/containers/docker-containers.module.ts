import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { createModuleContext } from "@deployer/nest-effect";
import { EffectRuntime } from "@deployer/nest-effect";
import { DockerContainerOps } from "./runtime/docker-container-ops";
import { DockerTerminalSessions } from "./runtime/docker-terminal-sessions";
import { ContainerAccessMeshPort, DockerContainerAccess } from "./runtime/docker-container-access";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainerMetricsStreamService } from "./events/docker-container-metrics-stream.service";
import { DockerRepository } from "../../repositories/facade/docker.repository";
import {
  ContainersLocalPort,
  ContainersMeshPort,
  DockerContainerResolution,
} from "./orchestration/docker-container-resolution";
import { DockerContainersOrchestratorService } from "./orchestration/docker-containers-orchestrator.service";
import { DockerContainers, DockerContainersPort } from "./orchestration/docker-containers.service";
import { LOCAL_NODE_OPERATIONS, makeLocalNodeOperations } from "./mesh/local-node-operations";
import { runtimeReplicaId } from "../../../../core/mesh/runtime-replica-id";
import { DOCKER_NODE_MESH, NODE_AGENT, dockerNodeMeshOver, type NodeAgent } from "./mesh/docker-node-mesh";

export class DockerContainersModule extends createModuleContext({
  imports: [CoreDockerModule, EventsModule, DockerRepositoriesModule],
  providers: [
    // Built by factories rather than by decorator: they take collaborators, not Nest metadata.
    { provide: DockerContainerOps, useValue: DockerContainerOps.live },
    { provide: DockerTerminalSessions, useValue: DockerTerminalSessions.live },
    { provide: ContainerAccessMeshPort, useExisting: DOCKER_NODE_MESH },
    { provide: DockerContainerAccess, useValue: DockerContainerAccess.live },
    {
      provide: DockerContainerMetricsStreamService,
      useFactory: (engine: DockerEngineShape, pool: CoreEventStreamPoolService) => new DockerContainerMetricsStreamService(engine, pool),
      inject: [DockerEngine, CoreEventStreamPoolService],
    },
    // The runtime asks the other nodes through the agent of its own node. The holder is empty until `joinRuntimeMesh` fills it,
    // and a runtime with no agent is simply alone on its node: every question to the mesh answers with nobody.
    { provide: NODE_AGENT, useFactory: (): NodeAgent => ({ link: undefined, selfReplicaId: runtimeReplicaId() }) },
    { provide: DOCKER_NODE_MESH, useFactory: (holder: NodeAgent) => dockerNodeMeshOver(holder), inject: [NODE_AGENT] },
    // Container resolution is a constant Effect service; the Nest providers it reads come in as ports.
    { provide: ContainersMeshPort, useExisting: DOCKER_NODE_MESH },
    { provide: ContainersLocalPort, useExisting: DockerRepository },
    { provide: DockerContainerResolution, useValue: DockerContainerResolution.live },
    {
      provide: LOCAL_NODE_OPERATIONS,
      useFactory: (runtime: EffectRuntime, repository: DockerRepository) => makeLocalNodeOperations(runtime, repository),
      inject: [EffectRuntime, DockerRepository],
    },
    DockerContainersOrchestratorService,
    // The Effect face of the container surface: a port over the Promise orchestrator, so a handler's `R` names it.
    { provide: DockerContainersPort, useExisting: DockerContainersOrchestratorService },
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
    // The port behind `DockerContainers`, so the module that declares the controller can see it.
    DockerContainersPort,
    // The ports `DockerContainerResolution`'s methods read: a controller hands them back through `Effect.context`
    // inside its own module scope, so the module that provides them must export them.
    ContainersMeshPort,
    ContainersLocalPort,
  ],
}) {}