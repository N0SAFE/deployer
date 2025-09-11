import { Module } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ServiceController } from './controllers/service.controller';
import { ProjectService } from './services/project.service';
import { CoreModule } from '../../core/core.module';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { ServiceModule } from '../service/service.module';
import { TraefikModule } from '../traefik/traefik.module';

@Module({
    imports: [CoreModule, DatabaseModule, ServiceModule, TraefikModule],
    controllers: [ProjectController, ServiceController],
    providers: [ProjectService],
    exports: [ProjectService]
})
export class ProjectModule {
}
