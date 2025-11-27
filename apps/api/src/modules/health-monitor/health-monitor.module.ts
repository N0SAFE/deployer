import { Module, forwardRef } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { HealthMonitorController } from './controllers/health-monitor.controller';

@Module({
    imports: [forwardRef(() => CoreModule)],
    controllers: [HealthMonitorController],
})
export class HealthMonitorModule {
}