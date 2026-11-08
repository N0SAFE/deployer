import {
    createModuleContext,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'

import { DockerCommonModule } from '../../common/docker-common.module'
import {
    DockerRuntimeEventsStreamService,
    type DockerRuntimeEventsStreamShape,
} from '../../common/events/docker-runtime-events-stream.service'
import { DockerRuntimeMeshRelayService } from '../../common/mesh/docker-runtime-mesh-relay.service'
import { DockerRuntimeStreamOrchestratorService } from '../../common/runtime/docker-runtime-stream-orchestrator.service'
import { DockerRepositoriesModule } from '../../repositories/docker-repositories.module'
import { DockerImageCatalogRepository } from '../../repositories/images/catalog/docker-image-catalog.repository'
import { DockerImageSecurityRepository } from '../../repositories/images/security/docker-image-security.repository'
import { DockerContainersModule } from '../containers/docker-containers.module'
import {
    DOCKER_NODE_MESH,
    type DockerNodeMesh,
} from '../containers/mesh/docker-node-mesh'

import { DockerImagesApplicationService } from './application/docker-images-application.service'
import { DockerImagesOrchestratorService } from './orchestration/docker-images-orchestrator.service'
import {
    DockerImageCatalogPort,
    DockerImages,
} from './orchestration/docker-images.service'
import { DockerImageAutoScanListenerService } from './queue/docker-image-auto-scan-listener.service'
import { DockerImageSecurityScanService } from './security/docker-image-security-scan.service'

export class DockerImagesModule extends createModuleContext({
    imports: [
        DockerCommonModule,
        DockerRepositoriesModule,
        DockerContainersModule,
        EnvModule,
    ],
    providers: [
        // The auto-scan listener starts through the generic lifecycle runner, which needs the host.
        effectHostProvider(),
        {
            provide: DockerImageSecurityScanService,
            useFactory: (
                repository: DockerImageSecurityRepository,
                relay: DockerRuntimeMeshRelayService
            ) => new DockerImageSecurityScanService(repository, relay),
            inject: [
                DockerImageSecurityRepository,
                DockerRuntimeMeshRelayService,
            ],
        },
        {
            provide: DockerImagesApplicationService,
            useFactory: (
                catalog: DockerImageCatalogRepository,
                streams: DockerRuntimeStreamOrchestratorService,
                scans: DockerImageSecurityScanService
            ) => new DockerImagesApplicationService(catalog, streams, scans),
            inject: [
                DockerImageCatalogRepository,
                DockerRuntimeStreamOrchestratorService,
                DockerImageSecurityScanService,
            ],
        },
        // The Effect face of the image catalog: a port over the Promise application service, so a handler's `R` names it.
        {
            provide: DockerImageCatalogPort,
            useExisting: DockerImagesApplicationService,
        },
        { provide: DockerImages, useClass: DockerImages.live },
        {
            provide: DockerImagesOrchestratorService,
            useFactory: (application: DockerImagesApplicationService) =>
                new DockerImagesOrchestratorService(application),
            inject: [DockerImagesApplicationService],
        },
        {
            provide: DockerImageAutoScanListenerService,
            useFactory: (
                mesh: DockerNodeMesh,
                events: DockerRuntimeEventsStreamShape,
                relay: DockerRuntimeMeshRelayService,
                application: DockerImagesApplicationService,
                security: DockerImageSecurityRepository,
                env: EnvService
            ) =>
                DockerImageAutoScanListenerService.make(
                    mesh,
                    events,
                    relay,
                    application,
                    security,
                    env
                ),
            inject: [
                DOCKER_NODE_MESH,
                DockerRuntimeEventsStreamService,
                DockerRuntimeMeshRelayService,
                DockerImagesApplicationService,
                DockerImageSecurityRepository,
                EnvService,
            ],
        },
        serviceLifecycle(DockerImageAutoScanListenerService),
    ],
    exports: [
        DockerImageSecurityScanService,
        DockerImagesApplicationService,
        DockerImageCatalogPort,
        DockerImages,
        DockerImagesOrchestratorService,
        DockerImageAutoScanListenerService,
    ],
}) {}
