import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { OrchestrationModule } from '../../core/modules/orchestration/orchestration.module';  // Import for DeploymentQueueService
import { JobsModule } from '../jobs/jobs.module';
import { WebSocketModule } from '../websocket/websocket.module';
// Use the DB-backed DeploymentController implemented in the websocket module folder
import { DeploymentController as DeploymentHttpController } from '../websocket/controllers/deployment.controller';
@Module({
    imports: [CoreModule, OrchestrationModule, JobsModule, WebSocketModule],  // Add OrchestrationModule for DeploymentQueueService
    controllers: [DeploymentHttpController],
})
export class DeploymentModule {
}
