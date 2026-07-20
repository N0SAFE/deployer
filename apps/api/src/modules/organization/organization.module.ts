import { Module } from '@nestjs/common';
import { OrganizationController } from './controllers/organization.controller';
import { OrganizationService } from './services/organization.service';
import { OrganizationRepository } from './repositories/organization.repository';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { ConfigurationCoreModule } from '@/core/modules/configuration/configuration-core.module';

@Module({
  imports: [ConfigurationCoreModule, DatabaseModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, OrganizationRepository],
  exports: [OrganizationService],
})
export class OrganizationModule {}
