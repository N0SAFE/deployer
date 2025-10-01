import { Module } from '@nestjs/common';
// DeploymentQueueService moved to OrchestrationModule to be with Bull queue
// import { DeploymentQueueService } from './services/deployment-queue.service';
// Remove the duplicate deployment processor - now unified in OrchestrationModule
// import { DeploymentProcessor } from './processors/deployment.processor';
import { DatabaseModule } from '../../core/modules/database/database.module';
import { TraefikModule } from '../traefik/traefik.module';
import { StorageModule } from '../storage/storage.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { CoreModule } from '../../core/core.module';
@Module({
    imports: [
        DatabaseModule,
        TraefikModule,
        StorageModule,
        WebSocketModule,
        CoreModule,
    ],
    // Core services are provided and exported by CoreModule — do not redeclare them here
    providers: [],
    exports: [
        // DeploymentQueueService moved to OrchestrationModule - import OrchestrationModule instead
    ],
})
export class JobsModule {
}
