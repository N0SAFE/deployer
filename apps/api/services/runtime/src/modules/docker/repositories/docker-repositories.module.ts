import {
    CONTAINER_LINK_RESOLVER,
    DockerEngine,
    DockerHost,
    ScannerPool,
    type DockerEngineShape,
    type DockerHostShape,
    type IContainerLinkResolver,
    type ScannerPoolShape,
} from '@deployer/docker'
import { createModuleContext } from '@deployer/nest-effect'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import {
    GlobalDatabaseService,
    type GlobalDatabaseServiceShape,
} from '@deployer/shared/core/modules/database/services/global-database.service'
import { CoreDockerModule } from '@deployer/shared/core/modules/docker/docker.module'

import { RuntimeDb } from '../../../core/database/runtime-db'
import { ContainerDockerodeNormalizer } from '../shared/container-dockerode-normalizer.service'

import {
    DockerContainersRepository,
    type DockerContainersRepositoryShape,
} from './containers/engine/docker-containers.repository'
import { DockerContainerLinks } from './containers/links/docker-container-links'
import {
    DockerContainerLinksLookup,
    type DockerContainerLinksLookupShape,
} from './containers/links/docker-container-links-lookup.repository'
import { DockerRepository } from './facade/docker.repository'
import { DockerImageCatalogRepository } from './images/catalog/docker-image-catalog.repository'
import {
    DockerImagesRepository,
    type DockerImagesRepositoryShape,
} from './images/engine/docker-images.repository'
import {
    DockerImageLifecycleRepository,
    type DockerImageLifecycleRepositoryShape,
} from './images/lifecycle/docker-image-lifecycle.repository'
import {
    DockerImageScansStore,
    type DockerImageScansStoreShape,
} from './images/security/docker-image-scans.store'
import { DockerImageSecurityRepository } from './images/security/docker-image-security.repository'
import {
    DockerNetworksRepository,
    type DockerNetworksRepositoryShape,
} from './networks/docker-networks.repository'
import { DockerRuntimeActivities } from './runtime/docker-runtime-activities'
import {
    DockerRuntimeActivitiesStore,
    type DockerRuntimeActivitiesStoreShape,
} from './runtime/docker-runtime-activities.store'
import {
    DockerVolumesRepository,
    type DockerVolumesRepositoryShape,
} from './volumes/docker-volumes.repository'

export class DockerRepositoriesModule extends createModuleContext({
    imports: [DatabaseModule, CoreDockerModule],
    providers: [
        {
            provide: DockerRepository,
            useFactory: (
                engine: DockerEngineShape,
                scannerPool: ScannerPoolShape,
                host: DockerHostShape,
                database: GlobalDatabaseServiceShape,
                normalizer: ContainerDockerodeNormalizer,
                linkResolver: IContainerLinkResolver | undefined,
                networks: DockerNetworksRepositoryShape,
                volumes: DockerVolumesRepositoryShape,
                images: DockerImagesRepositoryShape,
                lifecycle: DockerImageLifecycleRepositoryShape,
                containers: DockerContainersRepositoryShape,
                activities: DockerRuntimeActivitiesStoreShape,
                scans: DockerImageScansStoreShape,
                linkLookup: DockerContainerLinksLookupShape
            ) =>
                new DockerRepository(
                    engine,
                    scannerPool,
                    host,
                    database,
                    normalizer,
                    linkResolver,
                    networks,
                    volumes,
                    images,
                    lifecycle,
                    containers,
                    activities,
                    scans,
                    linkLookup
                ),
            inject: [
                DockerEngine,
                ScannerPool,
                DockerHost,
                GlobalDatabaseService,
                ContainerDockerodeNormalizer,
                { token: CONTAINER_LINK_RESOLVER, optional: true },
                DockerNetworksRepository,
                DockerVolumesRepository,
                DockerImagesRepository,
                DockerImageLifecycleRepository,
                DockerContainersRepository,
                DockerRuntimeActivitiesStore,
                DockerImageScansStore,
                DockerContainerLinksLookup,
            ],
        },
        // The Effect repositories below `yield* RuntimeDb` when a method runs; the tag is a constant over the global
        // `RuntimeDatabasePort`, so binding it here gives this module's request scope the database it reads.
        { provide: RuntimeDb, useValue: RuntimeDb.live },
        {
            provide: ContainerDockerodeNormalizer,
            useFactory: () => new ContainerDockerodeNormalizer(),
        },
        {
            provide: DockerImageCatalogRepository,
            useFactory: (repository: DockerRepository) =>
                new DockerImageCatalogRepository(repository),
            inject: [DockerRepository],
        },
        {
            provide: DockerImageSecurityRepository,
            useFactory: (repository: DockerRepository) =>
                new DockerImageSecurityRepository(repository),
            inject: [DockerRepository],
        },
        // The Effect repositories over the engine are provided under their own tags.
        {
            provide: DockerNetworksRepository,
            useClass: DockerNetworksRepository.live,
        },
        {
            provide: DockerImagesRepository,
            useClass: DockerImagesRepository.live,
        },
        {
            provide: DockerImageLifecycleRepository,
            useClass: DockerImageLifecycleRepository.live,
        },
        {
            provide: DockerVolumesRepository,
            useClass: DockerVolumesRepository.live,
        },
        {
            provide: DockerImageScansStore,
            useClass: DockerImageScansStore.live,
        },
        {
            provide: DockerRuntimeActivitiesStore,
            useClass: DockerRuntimeActivitiesStore.live,
        },
        {
            provide: DockerRuntimeActivities,
            useClass: DockerRuntimeActivities.live,
        },
        {
            provide: DockerContainersRepository,
            useClass: DockerContainersRepository.live,
        },
        {
            provide: DockerContainerLinksLookup,
            useClass: DockerContainerLinksLookup.live,
        },
        {
            provide: DockerContainerLinks,
            useClass: DockerContainerLinks.live,
        },
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
