import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { DeploymentCoreModule } from "@/core/modules/deployment/deployment-core.module";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { ProjectCoreModule } from "@/core/modules/project/project-core.module";
import { DeploymentController } from "./controllers/deployment.controller";
import { DeploymentRepository } from "./repositories/deployment.repository";
import { DeploymentService } from "./services/deployment.service";
import { DeploymentEventService } from "./events/deployment-event.service";
import { DeploymentReadModelProjectorService } from "./events/deployment-read-model-projector.service";
import { DeploymentExecutionWorkflowService } from "./services/deployment-execution-workflow.service";
import { DeploymentQueueLifecycleService } from "./queue/deployment-queue-lifecycle.service";
import { DeploymentBullQueueService } from "./queue/deployment-bull-queue.service";
import { DeploymentQueueEventService } from "./queue/deployment-queue-event.service";
import { DeploymentQueueProcessor } from "./queue/deployment-queue.processor";
import { CoreEventSyncService } from "@/core/modules/events";
import { DeploymentProvidersModule } from "./providers/providers.module";
import { DeploymentRunnersModule } from "./runners/runners.module";
import { DeploymentMeshService } from "./mesh/services/deployment-mesh.service";
import { DeploymentStreamBridgeService } from "./mesh/services/deployment-stream-bridge.service";
import { DeploymentStreamOrchestratorService } from "./mesh/services/deployment-stream-orchestrator.service";
import { DeploymentMeshHandlerRegistrar } from "./mesh/registrars/deployment-mesh-handler-registrar.service";
import { PreviewEnvOverlayService } from "./preview/preview-env-overlay.service";
import { DeploymentStorageProvidersModule } from "./storage/storage-providers.module";
import { GitModule } from "@/core/modules/git/git/git.module";
import { DeploymentArtifactBuilderService } from "./builders/deployment-artifact-builder.service";
import { EventsModule } from "@/core/modules/events/events.module";

@Module({
    imports: [
        DatabaseModule,
        ConfigurationCoreModule,
        MeshCoreModule,
        DeploymentCoreModule,
        ProjectCoreModule,
        DeploymentProvidersModule,
        DeploymentRunnersModule,
        DeploymentStorageProvidersModule,
        GitModule,
        EventsModule,
        BullModule.registerQueue({ name: "deployment" }),
    ],
    controllers: [DeploymentController],
    providers: [
        DeploymentService,
        DeploymentRepository,
        DeploymentEventService,
        DeploymentReadModelProjectorService,
        CoreEventSyncService,
        DeploymentExecutionWorkflowService,
        DeploymentQueueLifecycleService,
        DeploymentBullQueueService,
        DeploymentQueueEventService,
        DeploymentMeshService,
        DeploymentStreamBridgeService,
        DeploymentStreamOrchestratorService,
        DeploymentMeshHandlerRegistrar,
        DeploymentQueueProcessor,
        DeploymentArtifactBuilderService,
        PreviewEnvOverlayService,
    ],
    exports: [
        DeploymentService,
        DeploymentRepository,
        DeploymentEventService,
        DeploymentReadModelProjectorService,
        PreviewEnvOverlayService,
    ],
})
export class DeploymentModule {}
