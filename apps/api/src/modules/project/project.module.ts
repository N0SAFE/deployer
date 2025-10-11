import { Module } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ServiceController } from './controllers/service.controller';
import { ProjectService } from './services/project.service';
import { CoreModule } from '@/core/core.module';

@Module({
    imports: [CoreModule],
    controllers: [ProjectController, ServiceController],
    providers: [ProjectService]
})
export class ProjectModule {
}
