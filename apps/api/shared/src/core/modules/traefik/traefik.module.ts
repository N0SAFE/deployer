import { Module } from '@nestjs/common';
import { TraefikTemplateService } from './services/traefik-template.service';
import { TraefikVariableResolverService } from './services/traefik-variable-resolver.service';
import { TraefikService } from './services/traefik.service';
import { TraefikSyncService } from './services/traefik-sync.service';
import { TraefikFileSystemService } from './services/traefik-file-system.service';
import { TraefikValidationService } from './services/traefik-validation.service';
import { TraefikMiddlewareLibraryService } from './services/traefik-middleware-library.service';
import { TraefikRepository } from './repositories/traefik.repository';
import { TraefikTemplateRepository } from './repositories/traefik-template.repository';
import { TraefikEventService } from './events/traefik-event.service';
import { TraefikIngressConfigService } from './services/traefik-ingress-config.service';
import { TraefikIngressConfigController } from './controllers/traefik-ingress-config.controller';
import { TraefikConfigRefresher } from './services/traefik-config-refresher.service';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '@/core/modules/events/events.module';
import { SupervisorsModule } from "@repo/nest-supervisor-core/supervisors.module";
import { CorePlatformIngressModule } from '../platform-ingress/platform-ingress.module';
import { CoreDockerModule } from '../docker/docker.module';
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
