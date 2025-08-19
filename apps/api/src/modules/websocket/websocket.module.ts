import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

// Controllers
import { DeploymentController } from './controllers/deployment.controller';

// Services
import { WebSocketEventService } from './services/websocket-event.service';
import { DeploymentQueueService } from '../jobs/services/deployment-queue.service';

// Gateways
import { DeploymentWebSocketGateway } from './gateways/deployment.gateway';

@Module({
  imports: [
    // Bull Queue for deployment jobs
    BullModule.registerQueue({
      name: 'deployment',
    }),
  ],
  controllers: [DeploymentController],
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
export class WebSocketModule {}