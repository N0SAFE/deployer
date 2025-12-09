import { Module } from '@nestjs/common';
import { CiCdController } from './controllers/ci-cd.controller';
import { CiCdService } from './services/ci-cd.service';
@Module({
    controllers: [CiCdController],
    providers: [CiCdService],
    exports: [CiCdService],
})
export class CiCdModule {
}
