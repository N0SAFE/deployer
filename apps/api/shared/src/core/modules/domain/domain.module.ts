import { createGlobalModule, effectHostProvider, serviceLifecycle } from "@deployer/nest-effect";

import { DatabaseModule } from "../database/database.module";
import { GlobalDatabaseService } from "../database/services/global-database.service";
import { TraefikRepository } from "../traefik/repositories/traefik.repository";
import { TraefikSyncService } from "../traefik/services/traefik-sync.service";
import { TraefikVariableResolverService } from "../traefik/services/traefik-variable-resolver.service";
import { TraefikService } from "../traefik/services/traefik.service";
import { TraefikCoreModule } from "../traefik/traefik.module";

import {
  DomainDatabase,
  RoutingTraefikCertificates,
  RoutingTraefikRepository,
  RoutingTraefikSync,
  RoutingTraefikVariables,
} from "./domain.ports";
import { makeProjectDomainRepository, ProjectDomainRepository } from "./repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "./repositories/service-domain-mapping.repository";
import { DomainConflictService } from "./services/domain-conflict.service";
import { DomainRoutingService } from "./services/domain-routing.service";
import { DomainVerificationService, makeDomainVerificationService } from "./services/domain-verification.service";
import { ServiceDomainMappingService } from "./services/service-domain-mapping.service";

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
    // Ports
    { provide: DomainDatabase, useExisting: GlobalDatabaseService },
    { provide: RoutingTraefikRepository, useExisting: TraefikRepository },
    { provide: RoutingTraefikSync, useExisting: TraefikSyncService },
    { provide: RoutingTraefikCertificates, useExisting: TraefikService },
    { provide: RoutingTraefikVariables, useExisting: TraefikVariableResolverService },
    // Repositories
    { provide: ProjectDomainRepository, useValue: ProjectDomainRepository.live },
    { provide: ServiceDomainMappingRepository, useValue: ServiceDomainMappingRepository.live },
    // Services
    { provide: ServiceDomainMappingService, useValue: ServiceDomainMappingService.live },
    { provide: DomainConflictService, useValue: DomainConflictService.live },
    { provide: DomainRoutingService, useValue: DomainRoutingService.live },
    {
      provide: DomainVerificationService,
      useFactory: (database: { readonly db: GlobalDatabaseService["db"] }) =>
        makeDomainVerificationService(makeProjectDomainRepository({ database })),
      inject: [DomainDatabase],
    },
    serviceLifecycle(DomainVerificationService),
  ],
  // The ports are exported too: a service's requirements name them, and a consumer's module must be able to resolve them.
  exports: [
    DomainDatabase,
    RoutingTraefikRepository,
    RoutingTraefikSync,
    RoutingTraefikCertificates,
    RoutingTraefikVariables,
    DomainVerificationService,
    DomainConflictService,
    ServiceDomainMappingService,
    DomainRoutingService,
    ProjectDomainRepository,
    ServiceDomainMappingRepository,
  ],
});
