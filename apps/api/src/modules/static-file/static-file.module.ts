import { Module } from '@nestjs/common';
import { StaticFileController } from './controllers/static-file.controller';
import { CoreModule } from '@/core/core.module';

@Module({
    imports: [
        CoreModule,
    ],
    controllers: [StaticFileController],
})
export class StaticFileModule {
}
