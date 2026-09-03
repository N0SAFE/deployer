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
import { TraefikPlatformConfigService } from './services/traefik-platform-config.service';
import { TraefikConfigRefresher } from './services/traefik-config-refresher.service';
import { DatabaseModule } from '../database/database.module';
import { EventsModule } from '@/core/modules/events/events.module';
import { SupervisorsModule } from '../supervisors/supervisors.module';
import { CorePlatformIngressModule } from '../platform-ingress/platform-ingress.module';
import { CoreDockerModule } from '../docker/docker.module';
import { EnvService } from '@/config/env/env.service';

/**
 * CORE MODULE: Traefik
 * Provides all Traefik-related services and infrastructure.
 *
 * This is the CONFIG hander for the live Traefik instance:
 *   - `TraefikPlatformConfigService` rewrites the dynamic files the running
 *     Traefik watches (platform api/web routes + DB-driven domain routes +
 *     per-service configs); `TraefikConfigRefresher` is the fire-and-forget
 *     update trigger (config write → process re-converge).
 *   - The Traefik SUPERVISOR only ensures the process (container/network/
 *     entry port/liveness) — it never writes config (see traefik-supervisor).
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
    SupervisorsModule,
  ],
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
    // Live-instance config handler (core-owned).
    TraefikPlatformConfigService,
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
    TraefikPlatformConfigService,
    TraefikConfigRefresher,
    // Repositories
    TraefikRepository,
    TraefikTemplateRepository,
  ],
})
export class TraefikCoreModule {}
