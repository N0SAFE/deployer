import { Module, forwardRef } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './services/project.service';
import { ProjectRepository } from './repositories/project.repository';
import { ProjectAdapter } from './adapters/project-adapter.service';
import { CoreModule } from '@/core/core.module';

@Module({
    imports: [forwardRef(() => CoreModule)],
    controllers: [ProjectController],
    providers: [ProjectService, ProjectRepository, ProjectAdapter],
    exports: [ProjectService] // Export ProjectService for use in other modules
})
export class ProjectModule {
}
