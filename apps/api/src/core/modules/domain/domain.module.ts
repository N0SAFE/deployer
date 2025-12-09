import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';

// Services
import { DomainVerificationService } from './services/domain-verification.service';
import { DomainConflictService } from './services/domain-conflict.service';
import { OrganizationDomainService } from './services/organization-domain.service';
import { ServiceDomainMappingService } from './services/service-domain-mapping.service';

// Repositories
import { OrganizationDomainRepository } from './repositories/organization-domain.repository';
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
 * - OrganizationDomainService: Organization domain management
 * - ServiceDomainMappingService: Service-to-domain mappings
 * 
 * Repositories provided:
 * - OrganizationDomainRepository: Organization domain data access
 * - ProjectDomainRepository: Project domain data access
 * - ServiceDomainMappingRepository: Service domain mapping data access
 * 
 * Controllers have been moved to DomainControllerModule (feature module).
 */
@Global()
@Module({
  imports: [
    DatabaseModule,
  ],
  controllers: [],  // NO CONTROLLERS - moved to DomainControllerModule (feature)
  providers: [
    // Services
    DomainVerificationService,
    DomainConflictService,
    OrganizationDomainService,
    ServiceDomainMappingService,
    
    // Repositories
    OrganizationDomainRepository,
    ProjectDomainRepository,
    ServiceDomainMappingRepository,
  ],
  exports: [
    // Export services for use in other modules (e.g., ServiceContext, Deployment)
    DomainVerificationService,
    DomainConflictService,
    OrganizationDomainService,
    ServiceDomainMappingService,
    
    // Export repositories for use in other modules
    OrganizationDomainRepository,
    ProjectDomainRepository,
    ServiceDomainMappingRepository,
  ],
})
export class CoreDomainModule {}
