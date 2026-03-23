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
import { DatabaseModule } from '../database/database.module';
import { EnvService } from '@/config/env/env.service';

/**
 * CORE MODULE: Traefik
 * Provides all Traefik-related services and infrastructure
 * 
 * This is a CORE module - it provides Traefik infrastructure for the application.
 * 
 * Services exported:
 * - TraefikTemplateService: Template parsing and variable replacement
 * - TraefikVariableResolverService: Variable resolution for Traefik configs
 * - TraefikService: Main Traefik service for config management
 * - TraefikSyncService: Sync configurations to filesystem
 * - TraefikFileSystemService: Filesystem operations for Traefik configs
 * - TraefikValidationService: Validate Traefik configurations
 * - TraefikMiddlewareLibraryService: Pre-built middleware configurations
 * - TraefikEventService: Real-time event notifications for config changes
 * - TraefikRepository: Database operations for Traefik configs
 * - TraefikTemplateRepository: Database operations for Traefik templates
 * 
 * Dependencies:
 * - DatabaseModule: Database access
 */
@Module({
  imports: [DatabaseModule],
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
    // Repositories
    TraefikRepository,
    TraefikTemplateRepository,
  ],
})
export class TraefikCoreModule {}
