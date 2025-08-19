import { Module } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ServiceController } from './controllers/service.controller';
import { CoreModule } from '../../core/core.module';
import { DatabaseModule } from '../../core/modules/db/database.module';

@Module({
  imports: [CoreModule, DatabaseModule],
  controllers: [ProjectController, ServiceController],
})
export class ProjectModule {}
