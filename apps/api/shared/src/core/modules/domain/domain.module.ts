import {
    createGlobalModule,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'

import { DatabaseModule } from '../database/database.module'
import { DatabasePort } from '../database/storage'
import { TraefikCoreModule } from '../traefik/traefik.module'

import {
    makeProjectDomainRepository,
    ProjectDomainRepository,
} from './repositories/project-domain.repository'
import { ServiceDomainMappingRepository } from './repositories/service-domain-mapping.repository'
import { DomainConflictService } from './services/domain-conflict.service'
import { DomainRoutingService } from './services/domain-routing.service'
import {
    DomainVerificationService,
    makeDomainVerificationService,
} from './services/domain-verification.service'
import { ServiceDomainMappingService } from './services/service-domain-mapping.service'

import type { Context } from 'effect'

/**
 * CORE MODULE: Domain Infrastructure
 *
 * Provides ONLY domain services and repositories. NO controllers (they live in the feature module).
 *
 * Services: DomainVerificationService (DNS ownership, hourly sweep), DomainConflictService (subdomain conflicts),
 * ServiceDomainMappingService (service ↔ domain mappings), DomainRoutingService (mappings → Traefik routes).
 * Repositories: ProjectDomainRepository, ServiceDomainMappingRepository.
 *
 * The stateless ones are constants (`X.live`) that read their ports per call; the verification service owns a timer,
 * so it is built once and declares its lifetime (`serviceLifecycle`).
 */
export const CoreDomainModule = createGlobalModule({
    imports: [DatabaseModule, TraefikCoreModule],
    controllers: [],
    providers: [
        effectHostProvider(),
        // Repositories
        {
            provide: ProjectDomainRepository,
            useValue: ProjectDomainRepository.live,
        },
        {
            provide: ServiceDomainMappingRepository,
            useValue: ServiceDomainMappingRepository.live,
        },
        // Services
        {
            provide: ServiceDomainMappingService,
            useValue: ServiceDomainMappingService.live,
        },
        {
            provide: DomainConflictService,
            useValue: DomainConflictService.live,
        },
        { provide: DomainRoutingService, useClass: DomainRoutingService.live },
        {
            provide: DomainVerificationService,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) =>
                makeDomainVerificationService(
                    makeProjectDomainRepository({ database })
                ),
            inject: [DatabasePort],
        },
        serviceLifecycle(DomainVerificationService),
    ],
    exports: [
        DomainVerificationService,
        DomainConflictService,
        ServiceDomainMappingService,
        DomainRoutingService,
        ProjectDomainRepository,
        ServiceDomainMappingRepository,
    ],
})
