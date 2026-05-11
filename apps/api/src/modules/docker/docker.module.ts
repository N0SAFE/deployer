import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { DockerController } from "./controllers/docker.controller";
import { DockerCommonModule } from "./common/docker-common.module";
import { DockerRepositoriesModule } from "./repositories/docker-repositories.module";
import { DockerContainersModule } from "./domains/containers/docker-containers.module";
import { DockerRuntimeModule } from "./domains/runtime/docker-runtime.module";
import { DockerImagesModule } from "./domains/images/docker-images.module";
import { DockerNetworksModule } from "./domains/networks/docker-networks.module";
import { DockerVolumesModule } from "./domains/volumes/docker-volumes.module";
import { DockerRegistriesModule } from "./domains/registries/docker-registries.module";
import { DockerStacksModule } from "./domains/stacks/docker-stacks.module";

@Module({
  imports: [
    MeshCoreModule,
    DockerCommonModule,
    DockerRepositoriesModule,
    DockerContainersModule,
    DockerRuntimeModule,
    DockerImagesModule,
    DockerNetworksModule,
    DockerVolumesModule,
    DockerRegistriesModule,
    DockerStacksModule,
  ],
  controllers: [DockerController],
  providers: [],
  exports: [
    DockerCommonModule,
    DockerRepositoriesModule,
    DockerContainersModule,
    DockerRuntimeModule,
    DockerImagesModule,
    DockerNetworksModule,
    DockerVolumesModule,
    DockerRegistriesModule,
    DockerStacksModule,
  ],
})
export class DockerModule {}
