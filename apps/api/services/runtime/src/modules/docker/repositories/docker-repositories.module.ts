import { createModuleContext } from "@deployer/nest-effect";
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
import { RuntimeDb } from "../../../core/database/runtime-db";

export class DockerRepositoriesModule extends createModuleContext({
  imports: [DatabaseModule, CoreDockerModule],
  providers: [
    DockerRepository,
    // The Effect repositories below `yield* RuntimeDb` when a method runs; the tag is a constant over the global
    // `RuntimeDatabasePort`, so binding it here gives this module's request scope the database it reads.
    { provide: RuntimeDb, useValue: RuntimeDb.live },
    { provide: ContainerDockerodeNormalizer, useFactory: () => new ContainerDockerodeNormalizer() },
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
    // The Effect repositories above `yield* RuntimeDb` when a method runs; a module that provides one of them (or a
    // service whose shape reads it) must be able to see the database, exactly like a controller's handler.
    RuntimeDb,
  ],
}) {}