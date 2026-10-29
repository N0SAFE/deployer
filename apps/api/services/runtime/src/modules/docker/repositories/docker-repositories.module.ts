import { Module } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { CoreDockerModule } from "@deployer/shared/core/modules/docker/docker.module";
import { DockerRepository } from "./facade/docker.repository";
import { DockerContainerLinks } from "./containers/links/docker-container-links";
import { DockerImageCatalogRepository } from "./images/catalog/docker-image-catalog.repository";
import { DockerImageSecurityRepository } from "./images/security/docker-image-security.repository";
import { DockerRuntimeActivities } from "./runtime/docker-runtime-activities";
import { DockerNetworksRepository } from "./networks/docker-networks.repository";
import { DockerVolumesRepository } from "./volumes/docker-volumes.repository";
import { DockerImageLifecycleRepository } from "./images/lifecycle/docker-image-lifecycle.repository";
import { DockerContainerLinksLookup } from "./containers/links/docker-container-links-lookup.repository";
import { DockerContainersRepository } from "./containers/engine/docker-containers.repository";
import { DockerRuntimeActivitiesStore } from "./runtime/docker-runtime-activities.store";
import { DockerImageScansStore } from "./images/security/docker-image-scans.store";
import { DockerImagesRepository } from "./images/engine/docker-images.repository";
import { ContainerDockerodeNormalizer } from "../shared/container-dockerode-normalizer.service";

@Module({
  imports: [DatabaseModule, CoreDockerModule],
  providers: [
    DockerRepository,
    ContainerDockerodeNormalizer,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    // The Effect repositories over the engine are provided under their own tags.
    { provide: DockerNetworksRepository, useValue: DockerNetworksRepository.live },
    { provide: DockerImagesRepository, useValue: DockerImagesRepository.live },
    { provide: DockerImageLifecycleRepository, useValue: DockerImageLifecycleRepository.live },
    { provide: DockerVolumesRepository, useValue: DockerVolumesRepository.live },
    { provide: DockerImageScansStore, useValue: DockerImageScansStore.live },
    { provide: DockerRuntimeActivitiesStore, useValue: DockerRuntimeActivitiesStore.live },
    { provide: DockerRuntimeActivities, useValue: DockerRuntimeActivities.live },
    { provide: DockerContainersRepository, useValue: DockerContainersRepository.live },
    { provide: DockerContainerLinksLookup, useValue: DockerContainerLinksLookup.live },
    { provide: DockerContainerLinks, useValue: DockerContainerLinks.live },
  ],
  exports: [
    DockerRepository,
    ContainerDockerodeNormalizer,
    DockerContainerLinks,
    DockerImageCatalogRepository,
    DockerImageSecurityRepository,
    DockerRuntimeActivities,
    DockerNetworksRepository,
    DockerVolumesRepository,
    DockerImagesRepository,
    DockerImageLifecycleRepository,
    DockerContainerLinksLookup,
    DockerContainersRepository,
    DockerRuntimeActivitiesStore,
    DockerImageScansStore,
  ],
})
export class DockerRepositoriesModule {}