import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DeploymentProcessor } from './processors/deployment.processor';
import { DeploymentQueueService } from './services/deployment-queue.service';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { TraefikModule } from '../traefik/traefik.module';
import { CoreModule } from '../../core/core.module';
import { StorageModule } from '../storage/storage.module';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deployment',
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    DatabaseModule,
    TraefikModule,
    CoreModule,
    StorageModule,
    WebSocketModule,
  ],
  providers: [
    DeploymentProcessor,
    DeploymentQueueService,
  ],
  exports: [
    DeploymentQueueService,
  ],
})
export class JobsModule {}