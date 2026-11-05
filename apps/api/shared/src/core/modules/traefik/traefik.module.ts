import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import { createModuleContext, effectHostProvider } from '@deployer/nest-effect'
import { SupervisorOrchestrator } from '@deployer/supervision'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { DatabaseModule } from '../database/database.module'
import { DatabasePort } from '../database/storage'
import { CoreDockerModule } from '../docker/docker.module'
import {
    EdgeProviderRegistry,
    type EdgeProviderRegistryShape,
} from '../edge/edge-provider.registry'
import { CoreEdgeModule } from '../edge/edge.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '../events/base/index'
import { EventsModule } from '../events/events.module'
import { CorePlatformIngressModule } from '../platform-ingress/platform-ingress.module'
import { HostnameService } from '../platform-ingress/services/hostname.service'
import {
    IngressLanesService,
    type IngressLanesServiceShape,
} from '../platform-ingress/services/ingress-lanes.service'
import {
    PlatformConfigService,
    type PlatformConfigServiceShape,
} from '../platform-ingress/services/platform-config.service'
import {
    PlatformRoutesSource,
    type PlatformRoutesSourceShape,
} from '../platform-ingress/services/platform-routes-source.service'
import {
    PlatformWebTargetService,
    type PlatformWebTargetServiceShape,
} from '../platform-ingress/services/platform-web-target.service'
import { SupervisorsModule } from '../supervision/index'

import { TraefikIngressConfigController } from './controllers/traefik-ingress-config.controller'
import { TraefikEventService } from './events/traefik-event.service'
import {
    makeTraefikTemplateRepository,
    TraefikTemplateRepository,
} from './repositories/traefik-template.repository'
import {
    makeTraefikRepository,
    TraefikRepository,
} from './repositories/traefik.repository'
import {
    TraefikConfigRefresher,
    makeTraefikConfigRefresher,
} from './services/traefik-config-refresher.service'
import {
    makeTraefikFileSystem,
    TraefikFileSystemService,
} from './services/traefik-file-system.service'
import {
    makeTraefikIngressConfigService,
    TraefikIngressConfigService,
} from './services/traefik-ingress-config.service'
import { TraefikMiddlewareLibraryService } from './services/traefik-middleware-library.service'
import {
    makeTraefikSync,
    TraefikSyncService,
} from './services/traefik-sync.service'
import {
    makeTraefikTemplateService,
    TraefikTemplateService,
} from './services/traefik-template.service'
import { TraefikValidationService } from './services/traefik-validation.service'
import { TraefikVariableResolverService } from './services/traefik-variable-resolver.service'
import { makeTraefikService, TraefikService } from './services/traefik.service'

import type { Context } from 'effect'

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
const makeTraefikSyncFromPorts = (
    repository: Context.Service.Shape<typeof TraefikRepository>,
    fileSystem: Context.Service.Shape<typeof TraefikFileSystemService>
) => makeTraefikSync({ repository, fileSystem })

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
        {
            provide: TraefikTemplateService,
            useFactory: makeTraefikTemplateService,
            inject: [TraefikTemplateRepository],
        },
        {
            provide: TraefikVariableResolverService,
            useValue: TraefikVariableResolverService.live,
        },
        {
            provide: TraefikFileSystemService,
            useFactory: (
                env: EnvService,
                repository: Context.Service.Shape<typeof TraefikRepository>
            ) =>
                makeTraefikFileSystem(
                    {
                        basePath: env.get('TRAEFIK_CONFIG_BASE_PATH'),
                        backupPath: env.get('TRAEFIK_BACKUP_PATH'),
                    },
                    repository
                ),
            inject: [EnvService, TraefikRepository],
        },
        {
            provide: TraefikSyncService,
            useFactory: makeTraefikSyncFromPorts,
            inject: [TraefikRepository, TraefikFileSystemService],
        },
        {
            provide: TraefikService,
            useFactory: (
                repository: Context.Service.Shape<typeof TraefikRepository>,
                fileSystem: Context.Service.Shape<
                    typeof TraefikFileSystemService
                >,
                sync: Context.Service.Shape<typeof TraefikSyncService>
            ) => makeTraefikService({ repository, fileSystem, sync }),
            inject: [
                TraefikRepository,
                TraefikFileSystemService,
                TraefikSyncService,
            ],
        },
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
            provide: TraefikIngressConfigService,
            useFactory: (
                env: EnvService,
                dockerEngine: DockerEngineShape,
                hostnames: HostnameService,
                lanes: IngressLanesServiceShape,
                webTarget: PlatformWebTargetServiceShape,
                routesSource: PlatformRoutesSourceShape,
                traefikRepository: Context.Service.Shape<
                    typeof TraefikRepository
                >,
                platformConfig: PlatformConfigServiceShape,
                edges: EdgeProviderRegistryShape
            ) =>
                makeTraefikIngressConfigService({
                    env,
                    dockerEngine,
                    hostnames,
                    lanes,
                    webTarget,
                    routesSource,
                    traefikRepository,
                    platformConfig,
                    edges,
                }),
            inject: [
                EnvService,
                DockerEngine,
                HostnameService,
                IngressLanesService,
                PlatformWebTargetService,
                PlatformRoutesSource,
                TraefikRepository,
                PlatformConfigService,
                EdgeProviderRegistry,
            ],
        },
        {
            provide: TraefikConfigRefresher,
            useFactory: makeTraefikConfigRefresher,
            inject: [SupervisorOrchestrator],
        },
        // Repositories
        {
            provide: TraefikRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeTraefikRepository({ database }),
            inject: [DatabasePort],
        },
        {
            provide: TraefikTemplateRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeTraefikTemplateRepository({ database }),
            inject: [DatabasePort],
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
