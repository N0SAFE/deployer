import { Module } from "@nestjs/common";
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
import { DeploymentQueueWorkerService } from "./queue/deployment-queue.worker.service";
import { DeploymentQueueEventService } from "./queue/deployment-queue-event.service";
import { DeploymentQueueReconciliationService } from "./queue/deployment-queue-reconciliation.service";
import { CoreEventSyncService } from "@/core/modules/events";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { RunnersModule } from "@/modules/runners/runners.module";
import { DeploymentMeshService } from "./mesh/services/deployment-mesh.service";
import { DeploymentsMeshService } from "./mesh/services/deployments.mesh.service";
import { DeploymentStreamBridgeService } from "./mesh/services/deployment-stream-bridge.service";
import { DeploymentStreamOrchestratorService } from "./mesh/services/deployment-stream-orchestrator.service";
import { DeploymentMeshHandlerRegistrar } from "./mesh/registrars/deployment-mesh-handler-registrar.service";
import { PreviewEnvOverlayService } from "./preview/preview-env-overlay.service";
import { DeploymentStorageProvidersModule } from "./storage/storage-providers.module";
import { GitModule } from "@/core/modules/git/git/git.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { CONTAINER_LINK_RESOLVER } from "@/core/modules/docker/services/container-link-resolver.interface";
import { DeploymentContainerLinkService } from "./services/container-link.service";
import { DeploymentArtifactBuilderService } from "./builders/deployment-artifact-builder.service";
import { EventsModule } from "@/core/modules/events/events.module";

@Module({
    imports: [
        DatabaseModule,
        ConfigurationCoreModule,
        MeshCoreModule,
        DeploymentCoreModule,
        ProjectCoreModule,
        ProvidersModule,
        RunnersModule,
        DeploymentStorageProvidersModule,
        GitModule,
        EventsModule,
        TraefikCoreModule,
        // D-6: NO Bull — the queue is the typed in-process lifecycle store +
        // this module's typed worker (DeploymentQueueWorkerService), driven by
        // the onJobQueued() RxJS channel. No Redis/queue IO to configure.
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
        DeploymentQueueWorkerService,
        DeploymentQueueReconciliationService,
        DeploymentQueueEventService,
        DeploymentMeshService,
        DeploymentStreamBridgeService,
        DeploymentStreamOrchestratorService,
        DeploymentMeshHandlerRegistrar,
        DeploymentArtifactBuilderService,
        PreviewEnvOverlayService,
        DeploymentContainerLinkService,
        DeploymentsMeshService,
        {
            provide: CONTAINER_LINK_RESOLVER,
            useExisting: DeploymentContainerLinkService,
        },
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
