import { createModuleContext } from "@deployer/nest-effect";
import { EffectRuntime } from "@deployer/nest-effect";
import { DockerContainerOps } from "./runtime/docker-container-ops";
import { DockerTerminalSessions } from "./runtime/docker-terminal-sessions";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainerMetricsStreamService } from "./events/docker-container-metrics-stream.service";
import { DockerContainerMeshService } from "./mesh/docker-container-mesh.service";
import { DockerContainerRuntimeMeshService } from "./mesh/docker-container-runtime-mesh.service";
import { DockerMeshHandlerRegistrar } from "./mesh/docker-mesh-handler-registrar.service";
import { SystemMeshTopicService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { MeshInternalRequestService } from "@deployer/shared/core/modules/mesh/services/mesh-internal-request.service";
import { DockerRepository } from "../../repositories/facade/docker.repository";
import {
  ContainersLocalPort,
  ContainersMeshPort,
  DockerContainerResolution,
  MeshHeadersPort,
  MeshTopologyPort,
} from "./orchestration/docker-container-resolution";
import { DockerContainersOrchestratorService } from "./orchestration/docker-containers-orchestrator.service";
import { DockerContainerLogsDomainService } from "./runtime/docker-container-logs-domain.service";
import { DockerContainerRuntimeService } from "./runtime/docker-container-runtime.service";
import { DockerContainerShellDomainService } from "./runtime/docker-container-shell-domain.service";

export class DockerContainersModule extends createModuleContext({
  imports: [MeshCoreModule, CoreDockerModule, EventsModule, DockerRepositoriesModule],
  providers: [
    // Built by factories rather than by decorator: they take collaborators, not Nest metadata.
    { provide: DockerContainerOps, useValue: DockerContainerOps.live },
    { provide: DockerTerminalSessions, useValue: DockerTerminalSessions.live },
    { provide: DockerContainerRuntimeService, useFactory: (runtime: EffectRuntime) => new DockerContainerRuntimeService(runtime), inject: [EffectRuntime] },
    {
      provide: DockerContainerLogsDomainService,
      useFactory: (runtime: DockerContainerRuntimeService, mesh: DockerContainerRuntimeMeshService) =>
        new DockerContainerLogsDomainService(runtime, mesh),
      inject: [DockerContainerRuntimeService, DockerContainerRuntimeMeshService],
    },
    {
      provide: DockerContainerShellDomainService,
      useFactory: (runtime: DockerContainerRuntimeService, mesh: DockerContainerRuntimeMeshService) =>
        new DockerContainerShellDomainService(runtime, mesh),
      inject: [DockerContainerRuntimeService, DockerContainerRuntimeMeshService],
    },
    DockerContainerMetricsStreamService,
    // The mesh services compose a namespace over the topic and topology services; they are built here, not injected by decorator.
    {
      provide: DockerContainerMeshService,
      useFactory: (topics: SystemMeshTopicService, topology: SystemMeshTopologyService) =>
        new DockerContainerMeshService(topics, topology),
      inject: [SystemMeshTopicService, SystemMeshTopologyService],
    },
    {
      provide: DockerContainerRuntimeMeshService,
      useFactory: (topics: SystemMeshTopicService, topology: SystemMeshTopologyService) =>
        new DockerContainerRuntimeMeshService(topics, topology),
      inject: [SystemMeshTopicService, SystemMeshTopologyService],
    },
    // Container resolution is a constant Effect service; the Nest providers it reads come in as ports.
    { provide: ContainersMeshPort, useExisting: DockerContainerMeshService },
    { provide: ContainersLocalPort, useExisting: DockerRepository },
    { provide: MeshTopologyPort, useExisting: SystemMeshTopologyService },
    { provide: MeshHeadersPort, useExisting: MeshInternalRequestService },
    { provide: DockerContainerResolution, useValue: DockerContainerResolution.live },
    DockerMeshHandlerRegistrar,
    DockerContainersOrchestratorService,
  ],
  exports: [
    DockerContainerRuntimeService,
    DockerContainerLogsDomainService,
    DockerContainerShellDomainService,
    DockerContainerMetricsStreamService,
    DockerContainerMeshService,
    DockerContainerRuntimeMeshService,
    DockerContainerResolution,
    DockerContainersOrchestratorService,
  ],
}) {}