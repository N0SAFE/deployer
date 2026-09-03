import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TraefikCoreModule } from '@/core/modules/traefik/traefik.module';

// Services
import { DomainVerificationService } from './services/domain-verification.service';
import { DomainConflictService } from './services/domain-conflict.service';
import { ServiceDomainMappingService } from './services/service-domain-mapping.service';
import { DomainRoutingService } from './services/domain-routing.service';

// Repositories
import { ProjectDomainRepository } from './repositories/project-domain.repository';
import { ServiceDomainMappingRepository } from './repositories/service-domain-mapping.repository';

/**
 * CORE MODULE: Domain Infrastructure
 * 
 * Provides ONLY domain services and repositories. NO controllers.
 * 
 * Core modules should ONLY provide services (no controllers, no processors).
 * Feature modules contain controllers, processors, and application logic.
 * 
 * Services provided:
 * - DomainVerificationService: Domain verification (DNS, TXT records)
 * - DomainConflictService: Subdomain conflict detection
 * - ServiceDomainMappingService: Service-to-domain mappings
 * 
 * Repositories provided:
 * - ProjectDomainRepository: Project domain data access
 * - ServiceDomainMappingRepository: Service domain mapping data access
 * 
 * Controllers have been moved to DomainControllerModule (feature module).
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
    TraefikCoreModule,
  ],
  controllers: [],  // NO CONTROLLERS - moved to DomainControllerModule (feature)
  providers: [
    // Services
    DomainVerificationService,
    DomainConflictService,
    ServiceDomainMappingService,
    DomainRoutingService,
    
    // Repositories
    ProjectDomainRepository,
    ServiceDomainMappingRepository,
  ],
  exports: [
    // Export services for use in other modules (e.g., ServiceContext, Deployment)
    DomainVerificationService,
    DomainConflictService,
    ServiceDomainMappingService,
    DomainRoutingService,
    
    // Export repositories for use in other modules
    ProjectDomainRepository,
    ServiceDomainMappingRepository,
  ],
})
export class CoreDomainModule {}
