import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { EventsModule } from "@/core/modules/events/events.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainerMetricsStreamService } from "./events/docker-container-metrics-stream.service";
import { DockerContainerMeshService } from "./mesh/docker-container-mesh.service";
import { DockerContainerRuntimeMeshService } from "./mesh/docker-container-runtime-mesh.service";
import { DockerMeshHandlerRegistrar } from "./mesh/docker-mesh-handler-registrar.service";
import { DockerContainerResolutionService } from "./orchestration/docker-container-resolution.service";
import { DockerContainersOrchestratorService } from "./orchestration/docker-containers-orchestrator.service";
import { DockerContainerLogsDomainService } from "./runtime/docker-container-logs-domain.service";
import { DockerContainerRuntimeService } from "./runtime/docker-container-runtime.service";
import { DockerContainerShellDomainService } from "./runtime/docker-container-shell-domain.service";

@Module({
  imports: [MeshCoreModule, CoreDockerModule, EventsModule, DockerRepositoriesModule],
  providers: [
    DockerContainerRuntimeService,
    DockerContainerLogsDomainService,
    DockerContainerShellDomainService,
    DockerContainerMetricsStreamService,
    DockerContainerMeshService,
    DockerContainerRuntimeMeshService,
    DockerContainerResolutionService,
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
    DockerContainerResolutionService,
    DockerContainersOrchestratorService,
  ],
})
export class DockerContainersModule {}