import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';

// Controllers
import { OrganizationDomainController } from './controllers/organization-domain.controller';
import { ProjectDomainController } from './controllers/project-domain.controller';
import { ServiceDomainController } from './controllers/service-domain.controller';

// Services
import { DomainVerificationService } from './services/domain-verification.service';
import { DomainConflictService } from './services/domain-conflict.service';
import { OrganizationDomainService } from './services/organization-domain.service';
import { ServiceDomainMappingService } from './services/service-domain-mapping.service';

// Repositories
import { OrganizationDomainRepository } from './repositories/organization-domain.repository';
import { ProjectDomainRepository } from './repositories/project-domain.repository';
import { ServiceDomainMappingRepository } from './repositories/service-domain-mapping.repository';

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(), // Enable cron jobs for auto-verification
  ],
  controllers: [
    OrganizationDomainController,
    ProjectDomainController,
    ServiceDomainController,
  ],
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
export class DomainModule {}
