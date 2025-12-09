import { Module, forwardRef } from '@nestjs/common';
import { DeploymentWebSocketGateway } from './gateways/deployment.gateway';
import { WebSocketEventService } from './services/websocket-event.service';
import { DeploymentController } from './controllers/deployment.controller';
import { CoreModule } from '@/core/core.module';

/**
 * FEATURE MODULE: WebSocket
 * Provides real-time deployment updates via WebSocket
 * 
 * Dependencies (Core Modules):
 * - DockerService: Injected from global DockerModule (no import needed)
 * - OrchestrationModule: For DeploymentQueueService
 */
@Module({
  imports: [
    forwardRef(() => CoreModule),
  ],
    controllers: [DeploymentController],
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
