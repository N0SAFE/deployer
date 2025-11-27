import { Module } from '@nestjs/common';
import { TraefikTemplateService } from './services/traefik-template.service';
import { TraefikVariableResolverService } from './services/traefik-variable-resolver.service';
import { TraefikService } from './services/traefik.service';
import { TraefikSyncService } from './services/traefik-sync.service';
import { TraefikFileSystemService } from './services/traefik-file-system.service';
import { TraefikValidationService } from './services/traefik-validation.service';
import { TraefikRepository } from './repositories/traefik.repository';
import { TraefikTemplateRepository } from './repositories/traefik-template.repository';
import { DatabaseModule } from '../database/database.module';

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
 * - TraefikRepository: Database operations for Traefik configs
 * 
 * Dependencies:
 * - DatabaseModule: Database access
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    TraefikTemplateService,
    TraefikVariableResolverService,
    TraefikService,
    TraefikSyncService,
    TraefikFileSystemService,
    TraefikValidationService,
    TraefikRepository,
    TraefikTemplateRepository,
  ],
  exports: [
    TraefikTemplateService,
    TraefikVariableResolverService,
    TraefikService,
    TraefikSyncService,
    TraefikFileSystemService,
    TraefikValidationService,
    TraefikRepository,
    TraefikTemplateRepository,
  ],
})
export class TraefikCoreModule {}
