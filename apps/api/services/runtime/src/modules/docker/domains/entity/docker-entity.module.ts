import {
    createModuleContext,
    EffectHost,
    effectHostProvider,
    type EffectHostShape,
} from '@deployer/nest-effect'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '@deployer/shared/core/modules/events/base/index'
import { EventsModule as CoreEventsModule } from '@deployer/shared/core/modules/events/events.module'

import { DockerCatalogModule } from '../../catalog/docker-catalog.module'
import { DockerCommonModule } from '../../common/docker-common.module'
import {
    DockerRuntimeEventsStreamService,
    type DockerRuntimeEventsStreamShape,
} from '../../common/events/docker-runtime-events-stream.service'
import { DockerContainersModule } from '../containers/docker-containers.module'
import { DockerImagesModule } from '../images/docker-images.module'

import { DockerEntityCachePort } from './orchestration/docker-entity-cache.port'
import { DockerEntityCacheService } from './orchestration/docker-entity-cache.service'
import { DockerEntityDomainService } from './orchestration/docker-entity-domain.service'
import {
    DockerEntityOrchestratorService,
    entityChunkLog,
} from './orchestration/docker-entity-orchestrator.service'
import { entityStreamsOver } from './orchestration/docker-entity-streams'
import { DockerEntity } from './orchestration/docker-entity.service'

export class DockerEntityModule extends createModuleContext({
    imports: [
        CoreEventsModule,
        DockerCommonModule,
        DockerContainersModule,
        DockerImagesModule,
        DockerCatalogModule,
    ],
    providers: [
        effectHostProvider(),
        // Built by factories rather than by decorator.
        {
            provide: DockerEntityCacheService,
            useFactory: () => new DockerEntityCacheService(),
        },
        {
            provide: DockerEntityCachePort,
            useExisting: DockerEntityCacheService,
        },
        // The entity reads and the unary facade are constant Effect services: they yield their collaborators on every call.
        {
            provide: DockerEntityDomainService,
            useClass: DockerEntityDomainService.live,
        },
        {
            provide: DockerEntityOrchestratorService,
            useFactory: (
                host: EffectHostShape,
                events: DockerRuntimeEventsStreamShape,
                pool: CoreEventStreamPoolServiceShape,
                cache: DockerEntityCacheService
            ) =>
                new DockerEntityOrchestratorService.live(
                    entityStreamsOver({
                        host,
                        events,
                        pool,
                        cache,
                        log: entityChunkLog,
                    })
                ),
            inject: [
                EffectHost,
                DockerRuntimeEventsStreamService,
                CoreEventStreamPoolService,
                DockerEntityCacheService,
            ],
        },
        { provide: DockerEntity, useClass: DockerEntity.live },
    ],
    exports: [
        DockerEntityCacheService,
        // The ports the domain's methods read: a controller hands them back through `Effect.context` inside its own
        // module scope, so the module that provides them must export them.
        DockerEntityCachePort,
        DockerEntityDomainService,
        DockerEntityOrchestratorService,
        DockerEntity,
    ],
}) {}
