import { Module } from '@nestjs/common';
// DeploymentQueueService moved to OrchestrationModule to be with Bull queue
// import { DeploymentQueueService } from './services/deployment-queue.service';
// Remove the duplicate deployment processor - now unified in OrchestrationModule
// import { DeploymentProcessor } from './processors/deployment.processor';
import { DatabaseModule } from '../../core/modules/db/database.module';
import { TraefikModule } from '../traefik/traefik.module';
import { StorageModule } from '../storage/storage.module';
import { WebSocketModule } from '../websocket/websocket.module';
// Import needed core services directly
import { DockerService } from '../../core/services/docker.service';
import { GitService } from '../../core/services/git.service';
import { DeploymentService } from '../../core/services/deployment.service';
import { StaticFileService } from '../../core/services/static-file.service';
@Module({
    imports: [
        DatabaseModule,
        TraefikModule,
        StorageModule,
        WebSocketModule,
    ],
    providers: [
        // DeploymentQueueService moved to OrchestrationModule to be with Bull queue
        DockerService,
        GitService,
        DeploymentService,
        StaticFileService,
    ],
    exports: [
        // DeploymentQueueService moved to OrchestrationModule - import OrchestrationModule instead
    ],
})
export class JobsModule {
}
