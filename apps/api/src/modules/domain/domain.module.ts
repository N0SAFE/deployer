import { Module, forwardRef } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';

// Import controllers
import { OrganizationDomainController } from './controllers/organization-domain.controller';
import { ProjectDomainController } from './controllers/project-domain.controller';
import { ServiceDomainController } from './controllers/service-domain.controller';

/**
 * FEATURE MODULE: Domain Controllers
 * 
 * This module provides the application logic layer for domain management:
 * - Organization domain management (add, list, verify, delete)
 * - Project domain management (assign, list, update, remove)
 * - Service domain mapping (subdomain routing, SSL, primary domain)
 * 
 * Core modules should ONLY provide services (no controllers, no processors).
 * Feature modules contain controllers, processors, and application logic.
 * 
 * Imports CoreModule to access all core services including:
 * - DomainVerificationService
 * - DomainConflictService
 * - OrganizationDomainService
 * - ServiceDomainMappingService
 * - All domain repositories
 */
@Module({
    imports: [
        // Core modules (all services available)
        forwardRef(() => CoreModule),
    ],
    controllers: [
        OrganizationDomainController,
        ProjectDomainController,
        ServiceDomainController,
    ],
    providers: [],
    exports: [],
})
export class DomainControllerModule {}
