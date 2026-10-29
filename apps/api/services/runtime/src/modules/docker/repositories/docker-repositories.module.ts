import { Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { DockerRepository } from "./facade/docker.repository";
import { DockerContainerLinksRepository } from "./containers/links/docker-container-links.repository";
import { DockerImageCatalogRepository } from "./images/catalog/docker-image-catalog.repository";
import { DockerImageSecurityRepository } from "./images/security/docker-image-security.repository";
import { DockerRuntimeActivityRepository } from "./runtime/docker-runtime-activity.repository";
import { DockerNetworksRepository } from "./networks/docker-networks.repository";
import { DockerVolumesRepository } from "./volumes/docker-volumes.repository";
import { DockerImageLifecycleRepository } from "./images/lifecycle/docker-image-lifecycle.repository";
import { DockerContainerLinksLookup } from "./containers/links/docker-container-links-lookup.repository";
import { DockerContainersRepository } from "./containers/engine/docker-containers.repository";
import { DockerImagesRepository } from "./images/engine/docker-images.repository";
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
    { provide: DockerNetworksRepository, useValue: DockerNetworksRepository.live },
    { provide: DockerImagesRepository, useValue: DockerImagesRepository.live },
    { provide: DockerImageLifecycleRepository, useValue: DockerImageLifecycleRepository.live },
    { provide: DockerVolumesRepository, useValue: DockerVolumesRepository.live },
    { provide: DockerContainersRepository, useValue: DockerContainersRepository.live },
    { provide: DockerContainerLinksLookup, useValue: DockerContainerLinksLookup.live },
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
    DockerImagesRepository,
    DockerImageLifecycleRepository,
    DockerContainerLinksLookup,
    DockerContainersRepository,
  ],
})
export class DockerRepositoriesModule {}