import { Module, forwardRef } from '@nestjs/common';
import { StaticFileController } from './controllers/static-file.controller';
import { CoreModule } from '@/core/core.module';

@Module({
    imports: [
        forwardRef(() => CoreModule),
    ],
    controllers: [StaticFileController],
})
export class StaticFileModule {
}
