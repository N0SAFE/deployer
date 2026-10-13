import { Module } from '@nestjs/common';
import { TraefikTemplateService } from '@/core/modules/traefik/services/traefik-template.service';
import { TraefikVariableResolverService } from '@/core/modules/traefik/services/traefik-variable-resolver.service';
import { TraefikService } from '@/core/modules/traefik/services/traefik.service';
import { TraefikSyncService } from '@/core/modules/traefik/services/traefik-sync.service';
import { TraefikFileSystemService } from '@/core/modules/traefik/services/traefik-file-system.service';
import { TraefikValidationService } from '@/core/modules/traefik/services/traefik-validation.service';
import { TraefikMiddlewareLibraryService } from '@/core/modules/traefik/services/traefik-middleware-library.service';
import { TraefikRepository } from '@/core/modules/traefik/repositories/traefik.repository';
import { TraefikTemplateRepository } from '@/core/modules/traefik/repositories/traefik-template.repository';
import { TraefikEventService } from '@/core/modules/traefik/events/traefik-event.service';
import { TraefikIngressConfigService } from '@/core/modules/traefik/services/traefik-ingress-config.service';
import { TraefikIngressConfigController } from '@/core/modules/traefik/controllers/traefik-ingress-config.controller';
import { TraefikConfigRefresher } from '@/core/modules/traefik/services/traefik-config-refresher.service';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { EventsModule } from '@/core/modules/events/events.module';
import { SupervisorsModule } from "@deployer/nest-supervisor-core/supervisors.module";
import { CorePlatformIngressModule } from '@/core/modules/platform-ingress/platform-ingress.module';
import { CoreDockerModule } from '@/core/modules/docker/docker.module';
import { CoreEdgeModule } from '@/core/modules/edge/edge.module';
import { EnvModule, EnvService } from "@/config/env/env.module";

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
@Module({
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
    // Services
    TraefikTemplateService,
    TraefikVariableResolverService,
    TraefikService,
    TraefikSyncService,
    {
      provide: TraefikFileSystemService,
      useFactory: (envService: EnvService, traefikRepository: TraefikRepository) =>
        new TraefikFileSystemService(envService, traefikRepository),
      inject: [EnvService, TraefikRepository],
    },
    TraefikValidationService,
    TraefikMiddlewareLibraryService,
    TraefikEventService,
    // Live-ingress config (served to Traefik's HTTP provider).
    TraefikIngressConfigService,
    TraefikConfigRefresher,
    // Repositories
    TraefikRepository,
    TraefikTemplateRepository,
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
})
export class TraefikCoreModule {}
