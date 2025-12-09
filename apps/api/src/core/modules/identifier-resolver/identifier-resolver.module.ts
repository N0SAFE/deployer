import { Module } from '@nestjs/common';
import { IdentifierResolverService } from './services/identifier-resolver.service';
import { ProjectRepository } from '@/modules/project/repositories/project.repository';
import { EnvironmentRepository } from '../environment/repositories/environment.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    IdentifierResolverService,
    ProjectRepository,
    EnvironmentRepository,
  ],
  exports: [
    IdentifierResolverService,
    ProjectRepository,
    EnvironmentRepository,
  ],
})
export class IdentifierResolverModule {}
