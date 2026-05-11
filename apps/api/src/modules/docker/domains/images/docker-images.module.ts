import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { DockerCommonModule } from "../../common/docker-common.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainersModule } from "../containers/docker-containers.module";
import { DockerImageAutoScanListenerService } from "./queue/docker-image-auto-scan-listener.service";
import { DockerImagesOrchestratorService } from "./orchestration/docker-images-orchestrator.service";
import { DockerImageSecurityScanService } from "./security/docker-image-security-scan.service";
import { DockerImagesApplicationService } from "./application/docker-images-application.service";

@Module({
  imports: [MeshCoreModule, DockerCommonModule, DockerRepositoriesModule, DockerContainersModule],
  providers: [
    DockerImageSecurityScanService,
    DockerImagesApplicationService,
    DockerImagesOrchestratorService,
    DockerImageAutoScanListenerService,
  ],
  exports: [
    DockerImageSecurityScanService,
    DockerImagesApplicationService,
    DockerImagesOrchestratorService,
    DockerImageAutoScanListenerService,
  ],
})
export class DockerImagesModule {}