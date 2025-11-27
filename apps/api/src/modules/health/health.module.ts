import { Module, forwardRef } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';
import { HealthRepository } from './repositories/health.repository';
import { CoreModule } from '@/core/core.module';
@Module({
    imports: [forwardRef(() => CoreModule)],
    controllers: [HealthController],
    providers: [HealthService, HealthRepository],
    exports: [HealthService, HealthRepository],
})
export class HealthModule {}
