import { Module } from '@nestjs/common';
import { EnvironmentController } from './controllers/environment.controller';
import { EnvironmentService } from './services/environment.service';
import { EnvironmentRepository } from './repositories/environment.repository';

@Module({
  controllers: [EnvironmentController],
  providers: [EnvironmentService, EnvironmentRepository],
  exports: [EnvironmentService, EnvironmentRepository],
})
export class EnvironmentModule {}