import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { OrchestrationModule } from '../../core/modules/orchestration/orchestration.module';  // Import for DeploymentQueueService
// Services
import { WebSocketEventService } from './services/websocket-event.service';
// import { DeploymentQueueService } from '../jobs/services/deployment-queue.service';  // Now in OrchestrationModule
// Gateways
import { DeploymentWebSocketGateway } from './gateways/deployment.gateway';
@Module({
    imports: [
        CoreModule, // Import CoreModule to provide DockerService
        OrchestrationModule,  // Import OrchestrationModule to provide DeploymentQueueService
    ],
    controllers: [],
    providers: [
        DeploymentWebSocketGateway,
        WebSocketEventService,
        // DeploymentQueueService,  // Now provided by OrchestrationModule
    ],
    exports: [
        DeploymentWebSocketGateway,
        WebSocketEventService,
        // DeploymentQueueService,  // Now exported by OrchestrationModule
    ],
})
export class WebSocketModule {
}
