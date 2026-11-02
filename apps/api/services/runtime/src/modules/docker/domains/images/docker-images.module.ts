import { createModuleContext } from "@deployer/nest-effect";
import { EnvModule } from "@deployer/shared/config/env/env.module";

import { DockerCommonModule } from "../../common/docker-common.module";
import { DockerRepositoriesModule } from "../../repositories/docker-repositories.module";
import { DockerContainersModule } from "../containers/docker-containers.module";

import { DockerImagesApplicationService } from "./application/docker-images-application.service";
import { DockerImagesOrchestratorService } from "./orchestration/docker-images-orchestrator.service";
import { DockerImageCatalogPort, DockerImages } from "./orchestration/docker-images.service";
import { DockerImageAutoScanListenerService } from "./queue/docker-image-auto-scan-listener.service";
import { DockerImageSecurityScanService } from "./security/docker-image-security-scan.service";

export class DockerImagesModule extends createModuleContext({
  imports: [DockerCommonModule, DockerRepositoriesModule, DockerContainersModule,
		EnvModule,
	],
  providers: [
    DockerImageSecurityScanService,
    DockerImagesApplicationService,
    // The Effect face of the image catalog: a port over the Promise application service, so a handler's `R` names it.
    { provide: DockerImageCatalogPort, useExisting: DockerImagesApplicationService },
    { provide: DockerImages, useValue: DockerImages.live },
    DockerImagesOrchestratorService,
    DockerImageAutoScanListenerService,
  ],
  exports: [
    DockerImageSecurityScanService,
    DockerImagesApplicationService,
    // The Effect face of the image catalog: a port over the Promise application service, so a handler's `R` names it.
    { provide: DockerImageCatalogPort, useExisting: DockerImagesApplicationService },
    { provide: DockerImages, useValue: DockerImages.live },
    DockerImagesOrchestratorService,
    DockerImageAutoScanListenerService,
  ],
}) {}