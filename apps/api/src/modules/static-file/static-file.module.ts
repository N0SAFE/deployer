import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { TraefikModule } from '../traefik/traefik.module';
import { StaticFileService } from '../../core/services/static-file.service';
import { StaticFileController } from './controllers/static-file.controller';

@Module({
    imports: [
        CoreModule,
        TraefikModule,
    ],
    providers: [StaticFileService],
    controllers: [StaticFileController],
    exports: [StaticFileService],
})
export class StaticFileModule {
}
