import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CoreModule } from '../../core/core.module';
// Services
import { WebSocketEventService } from './services/websocket-event.service';
import { DeploymentQueueService } from '../jobs/services/deployment-queue.service';
// Gateways
import { DeploymentWebSocketGateway } from './gateways/deployment.gateway';
@Module({
    imports: [
        CoreModule, // Import CoreModule to provide DockerService
        // Bull Queue for deployment jobs
        BullModule.registerQueue({
            name: 'deployment',
        }),
    ],
    controllers: [],
    providers: [
        DeploymentWebSocketGateway,
        WebSocketEventService,
        DeploymentQueueService,
    ],
    exports: [
        DeploymentWebSocketGateway,
        WebSocketEventService,
        DeploymentQueueService,
    ],
})
export class WebSocketModule {
}
