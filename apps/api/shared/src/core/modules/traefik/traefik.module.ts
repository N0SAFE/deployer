import { createModuleContext, effectHostProvider } from '@deployer/nest-effect'
import {
    SupervisorOrchestrator,
    type SupervisorOrchestratorShape,
} from '@deployer/supervision'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { DatabaseModule } from '../database/database.module'
import { CoreDockerModule } from '../docker/docker.module'
import { CoreEdgeModule } from '../edge/edge.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '../events/base/index'
import { EventsModule } from '../events/events.module'
import { CorePlatformIngressModule } from '../platform-ingress/platform-ingress.module'
import { HostnameService } from '../platform-ingress/services/hostname.service'
import { SupervisorsModule } from '../supervision/index'

import { TraefikIngressConfigController } from './controllers/traefik-ingress-config.controller'
import { TraefikEventService } from './events/traefik-event.service'
import { TraefikTemplateRepository } from './repositories/traefik-template.repository'
import { TraefikRepository } from './repositories/traefik.repository'
import { TraefikConfigRefresher } from './services/traefik-config-refresher.service'
import { TraefikFileSystemService } from './services/traefik-file-system.service'
import { TraefikIngressConfigService } from './services/traefik-ingress-config.service'
import { TraefikMiddlewareLibraryService } from './services/traefik-middleware-library.service'
import { TraefikSyncService } from './services/traefik-sync.service'
import { TraefikTemplateService } from './services/traefik-template.service'
import { TraefikValidationService } from './services/traefik-validation.service'
import { TraefikVariableResolverService } from './services/traefik-variable-resolver.service'
import { TraefikService } from './services/traefik.service'

/**
 * CORE MODULE: Traefik
 * Provides all Traefik-related services and infrastructure.
 *
 * This is the CONFIG owner for the live ingress:
 *   - `TraefikIngressConfigService` builds the dynamic configuration every
 *     ingress task POLLS (`TraefikIngressConfigController`, Traefik's HTTP
 *     provider) — platform routes, DB-driven domain routes and per-service
 *     configs, attached to the lanes their visibility allows.
 *   - `TraefikConfigRefresher` re-converges the ingress processes after an
 *     operator action, so a lane change takes effect now rather than on the
 *     next sweep.
 *   - The Traefik SUPERVISOR only ensures the process (service/entrypoints/
 *     doors/liveness) — it never builds routes (see traefik-supervisor).
 *
 * Services exported: ...
 */
export class TraefikCoreModule extends createModuleContext({
    imports: [
        DatabaseModule,
        EventsModule,
        // The platform helpers (hostname, route builder, web target, route source)
        // and the supervisor framework (orchestrator for process re-converge).
        CorePlatformIngressModule,
        CoreDockerModule,
        // ── WHY THE EDGE MODULE IS IMPORTED (it is @Global, and still required) ──
        // `TraefikIngressConfigService` injects `EdgeProviderRegistry`. A `@Global`
        // module's providers are only registered once the module has been imported
        // SOMEWHERE in the graph — importing it here makes this module assembly
        // correct on its own instead of depending on a sibling happening to register
        // it. That implicit dependency is why this failed as
        // `Nest can't resolve dependencies of the TraefikIngressConfigService …
        // EdgeProviderRegistry` in every app that did not also happen to import
        // ProvidersModule.
        CoreEdgeModule,
        SupervisorsModule.forRoot(),
        // `EnvModule` IS IMPORTED EXPLICITLY: services below inject `EnvService`,
        // so it must be resolvable from THIS module's scope rather than assumed to
        // be registered globally elsewhere.
        EnvModule,
    ],
    controllers: [TraefikIngressConfigController],
    providers: [
        effectHostProvider(),
        // Services
        { provide: TraefikTemplateService, useClass: TraefikTemplateService.live },
        {
            provide: TraefikVariableResolverService,
            useValue: TraefikVariableResolverService.live,
        },
        {
            // The base paths are the one value `live` cannot yield: a synchronous convention map, read
            // from the existing env accessor and handed to the constructor.
            provide: TraefikFileSystemService,
            useFactory: (env: EnvService) =>
                new TraefikFileSystemService.live({
                    basePath: env.get('TRAEFIK_CONFIG_BASE_PATH'),
                    backupPath: env.get('TRAEFIK_BACKUP_PATH'),
                }),
            inject: [EnvService],
        },
        { provide: TraefikSyncService, useClass: TraefikSyncService.live },
        { provide: TraefikService, useClass: TraefikService.live },
        {
            provide: TraefikValidationService,
            useValue: TraefikValidationService.live,
        },
        {
            provide: TraefikMiddlewareLibraryService,
            useValue: TraefikMiddlewareLibraryService.live,
        },
        {
            provide: TraefikEventService,
            useFactory: (pool?: CoreEventStreamPoolServiceShape) =>
                new TraefikEventService(pool),
            inject: [{ token: CoreEventStreamPoolService, optional: true }],
        },
        // Live-ingress config (served to Traefik's HTTP provider).
        {
            // `live` yields every platform collaborator; the env accessor and the hostname grammar
            // are constructor-supplied, because both are synchronous reads.
            provide: TraefikIngressConfigService,
            useFactory: (env: EnvService, hostnames: HostnameService) =>
                new TraefikIngressConfigService.live(env, hostnames),
            inject: [EnvService, HostnameService],
        },
        {
            // `refresh()` returns void (callers fire and forget), so it cannot yield the
            // orchestrator: it arrives as a constructor argument instead.
            provide: TraefikConfigRefresher,
            useFactory: (orchestrator: SupervisorOrchestratorShape) =>
                new TraefikConfigRefresher.live(orchestrator),
            inject: [SupervisorOrchestrator],
        },
        // Repositories
        { provide: TraefikRepository, useClass: TraefikRepository.live },
        {
            provide: TraefikTemplateRepository,
            useClass: TraefikTemplateRepository.live,
        },
    ],
    exports: [
        // Services
        TraefikTemplateService,
        TraefikVariableResolverService,
        TraefikService,
        TraefikSyncService,
        TraefikFileSystemService,
        TraefikValidationService,
        TraefikMiddlewareLibraryService,
        TraefikEventService,
        TraefikIngressConfigService,
        TraefikConfigRefresher,
        // Repositories
        TraefikRepository,
        TraefikTemplateRepository,
    ],
}) {}
