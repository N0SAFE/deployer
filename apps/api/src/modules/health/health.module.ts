import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';
import { HealthRepository } from './repositories/health.repository';
import { DatabaseModule } from '../../core/modules/database/database.module';
import { ConfigurationCoreModule } from '@/core/modules/configuration/configuration-core.module';

@Module({
  imports: [DatabaseModule, ConfigurationCoreModule],
  controllers: [HealthController],
  providers: [HealthService, HealthRepository],
  exports: [HealthService, HealthRepository],
})
export class HealthModule {}
