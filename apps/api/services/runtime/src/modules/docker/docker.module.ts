import { createModuleContext } from "@deployer/nest-effect";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { DockerController } from "./controllers/docker.controller";
import { DockerCommonModule } from "./common/docker-common.module";
import { DockerRepositoriesModule } from "./repositories/docker-repositories.module";
import { DockerContainersModule } from "./domains/containers/docker-containers.module";
import { DockerRuntimeModule } from "./domains/runtime/docker-runtime.module";
import { DockerImagesModule } from "./domains/images/docker-images.module";
import { DockerCatalogModule } from "./catalog/docker-catalog.module";
import { DockerEntityModule } from "./domains/entity/docker-entity.module";

export class DockerDomainModule extends createModuleContext({
  imports: [
    MeshCoreModule,
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
