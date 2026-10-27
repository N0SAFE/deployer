import { Module, type FactoryProvider } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
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
import { CONTAINER_LINK_RESOLVER } from "@deployer/nest-docker/services/container-link-resolver.interface";
import { DeploymentContainerLinkService } from "./services/container-link.service";
import { DeploymentArtifactBuilderService } from "./builders/deployment-artifact-builder.service";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { BUILDER_STRATEGIES, BuilderRegistryService } from "./builders/builder-registry.service";
import { DockerfileBuilderStrategy } from "./builders/strategies/dockerfile-builder.strategy";
import { DockerComposeBuilderStrategy } from "./builders/strategies/docker-compose-builder.strategy";
import { BuildpackFamilyBuilderStrategy } from "./builders/strategies/buildpack-family-builder.strategy";
import type { BuilderStrategy } from "./builders/base/builder-strategy.interface";
import {
    DEPLOYMENT_TRIGGER_SOURCES,
    DeploymentTriggerRegistryService,
} from "./triggers/deployment-trigger-registry.service";
import { ApiTriggerSource } from "./triggers/api-trigger.source";
import { GithubPushTriggerSource } from "./triggers/github-push-trigger.source";
import type { DeploymentTriggerSource } from "./triggers/base/deployment-trigger-source.interface";
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
        // ── BUILDER STRATEGIES: ONE ARRAY UNDER ONE TOKEN ───────────────────
        // Adding a builder (a remote builder, a future "buildkit-remote") is: write a
        // class implementing `BuilderStrategy`, then add it to this factory's return
        // array and its `inject` list. The registry, the artifact-builder service and
        // every caller stay untouched.
        //
        // This is what replaces the old inline `if (builder === …)` chain — the one
        // whose trailing comment ("nixpacks/buildpack/railpack remain containerized via
        // docker image build") described three builders that could never succeed.
        DockerfileBuilderStrategy,
        DockerComposeBuilderStrategy,
        {
            provide: BUILDER_STRATEGIES,
            useFactory: (
                dockerfile: DockerfileBuilderStrategy,
                compose: DockerComposeBuilderStrategy,
                dockerService: DockerService,
            ): BuilderStrategy[] => [
                dockerfile,
                compose,
                // The buildpack family produces its artifact from the GENERATED
                // Dockerfile, so it needs the same Docker service the dockerfile
                // strategy uses. Without custom commands it rejects with an
                // actionable message instead of "Dockerfile not found".
                new BuildpackFamilyBuilderStrategy("nixpacks", dockerService),
                new BuildpackFamilyBuilderStrategy("buildpack", dockerService),
                new BuildpackFamilyBuilderStrategy("railpack", dockerService),
            ],
            inject: [DockerfileBuilderStrategy, DockerComposeBuilderStrategy, DockerService],
        } satisfies FactoryProvider,
        {
            provide: BuilderRegistryService,
            useFactory: (strategies: BuilderStrategy[]) => new BuilderRegistryService(strategies),
            inject: [BUILDER_STRATEGIES],
        } satisfies FactoryProvider,
        // ── DEPLOYMENT TRIGGER SOURCES: ONE ARRAY UNDER ONE TOKEN ────────────
        // What can START a deployment. Adding "deploy on a schedule", a Docker Hub
        // webhook, or a GitLab push is: write a `DeploymentTriggerSource`, add it here.
        // No caller changes — which is the whole point, since these origins previously
        // lived inline in the webhook controller (where `push` was explicitly skipped)
        // and in `triggerDeployment`.
        ApiTriggerSource,
        GithubPushTriggerSource,
        {
            provide: DEPLOYMENT_TRIGGER_SOURCES,
            useFactory: (api: ApiTriggerSource, githubPush: GithubPushTriggerSource): DeploymentTriggerSource[] => [
                api,
                githubPush,
            ],
            inject: [ApiTriggerSource, GithubPushTriggerSource],
        } satisfies FactoryProvider,
        {
            provide: DeploymentTriggerRegistryService,
            useFactory: (sources: DeploymentTriggerSource[]) => new DeploymentTriggerRegistryService(sources),
            inject: [DEPLOYMENT_TRIGGER_SOURCES],
        } satisfies FactoryProvider,
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
