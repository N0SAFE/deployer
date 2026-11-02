import { createModuleContext } from "@deployer/nest-effect";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";

import { DockerCatalogModule } from "./catalog/docker-catalog.module";
import { DockerCommonModule } from "./common/docker-common.module";
import { DockerController } from "./controllers/docker.controller";
import { DockerContainersModule } from "./domains/containers/docker-containers.module";
import { DockerEntityModule } from "./domains/entity/docker-entity.module";
import { DockerImagesModule } from "./domains/images/docker-images.module";
import { DockerRuntimeModule } from "./domains/runtime/docker-runtime.module";
import { DockerRepositoriesModule } from "./repositories/docker-repositories.module";

export class DockerDomainModule extends createModuleContext({
  imports: [
    CoreDockerModule, 
    DockerCommonModule,
    DockerRepositoriesModule,
    DockerContainersModule,
    DockerRuntimeModule,
    DockerImagesModule,
    DockerCatalogModule,
    DockerEntityModule,
  ],
  controllers: [DockerController],
  exports: [
    DockerCommonModule,
    DockerRepositoriesModule,
    DockerContainersModule,
    DockerRuntimeModule,
    DockerImagesModule,
    DockerCatalogModule,
    DockerEntityModule,
  ],
}) {}
