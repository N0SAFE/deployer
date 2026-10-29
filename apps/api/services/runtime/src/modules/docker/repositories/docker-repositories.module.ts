import { Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { DockerRepository } from "./facade/docker.repository";
import { DockerContainerLinksRepository } from "./containers/links/docker-container-links.repository";
import { DockerImageCatalogRepository } from "./images/catalog/docker-image-catalog.repository";
import { DockerImageSecurityRepository } from "./images/security/docker-image-security.repository";
import { DockerRuntimeActivityRepository } from "./runtime/docker-runtime-activity.repository";
import { DockerNetworksRepository, makeDockerNetworksRepository } from "./networks/docker-networks.repository";
import { DockerVolumesRepository, makeDockerVolumesRepository } from "./volumes/docker-volumes.repository";
import { ContainerDockerodeNormalizer } from "../shared/container-dockerode-normalizer.service";

@Module({
  imports: [DatabaseModule, CoreDockerModule],
  providers: [
    DockerRepository,
    ContainerDockerodeNormalizer,
    DockerContainerLinksRepository,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    DockerRuntimeActivityRepository,
    // The Effect repositories over the engine are provided under their own tags.
    { provide: DockerNetworksRepository, useFactory: (engine: DockerEngineShape) => makeDockerNetworksRepository(engine), inject: [DockerEngine] },
    { provide: DockerVolumesRepository, useFactory: (engine: DockerEngineShape) => makeDockerVolumesRepository(engine), inject: [DockerEngine] },
  ],
  exports: [
    DockerRepository,
    ContainerDockerodeNormalizer,
    DockerContainerLinksRepository,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    DockerRuntimeActivityRepository,
    DockerNetworksRepository,
    DockerVolumesRepository,
  ],
})
export class DockerRepositoriesModule {}