import { Module } from "@nestjs/common";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { DeploymentCoreModule } from "@deployer/shared/core/modules/deployment/deployment-core.module";
import { CoreEgressModule } from "@deployer/shared/core/modules/egress/egress.module";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { ProjectCoreModule } from "@deployer/shared/core/modules/project/project-core.module";
import { DeploymentController } from "./controllers/deployment.controller";
import { DeploymentRepository } from "./repositories/deployment.repository";
import { DeploymentService } from "./services/deployment.service";
import { ApiTriggerSource } from "./triggers/api-trigger.source";
import { GithubPushTriggerSource } from "./triggers/github-push-trigger.source";
import {
    DEPLOYMENT_TRIGGER_SOURCES,
    DeploymentTriggerRegistryService,
} from "./triggers/deployment-trigger-registry.service";
import { DeploymentEventTriggerService } from "./triggers/deployment-event-trigger.service";
import type { DeploymentTriggerSource } from "./triggers/base/deployment-trigger-source.interface";
import { DeploymentEventService } from "./events/deployment-event.service";
import { DeploymentReadModelProjectorService } from "./events/deployment-read-model-projector.service";
import { DeploymentExecutionWorkflowService } from "./services/deployment-execution-workflow.service";
import { DeploymentQueueLifecycleService } from "./queue/deployment-queue-lifecycle.service";
import { DeploymentQueueWorkerService } from "./queue/deployment-queue.worker.service";
import { DeploymentQueueEventService } from "./queue/deployment-queue-event.service";
import { DeploymentQueueReconciliationService } from "./queue/deployment-queue-reconciliation.service";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/index";
import { ProviderDomainsModule } from "../providers/providers.module";
import { RunnersDomainModule } from "../runners/runners.module";
import { DeploymentMeshService } from "./mesh/services/deployment-mesh.service";
import { DeploymentsMeshService } from "./mesh/services/deployments.mesh.service";
import { DeploymentStreamBridgeService } from "./mesh/services/deployment-stream-bridge.service";
import { DeploymentStreamOrchestratorService } from "./mesh/services/deployment-stream-orchestrator.service";
import { DeploymentMeshHandlerRegistrar } from "./mesh/registrars/deployment-mesh-handler-registrar.service";
import { PreviewEnvOverlayService } from "./preview/preview-env-overlay.service";
import { DeploymentStorageProvidersModule } from "./storage/storage-providers.module";
import { GitModule } from "@deployer/shared/core/modules/git/git/git.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { CONTAINER_LINK_RESOLVER } from "@deployer/nest-docker/services/container-link-resolver.interface";
import { DeploymentContainerLinkService } from "./services/container-link.service";
import { DeploymentArtifactBuilderService } from "./builders/deployment-artifact-builder.service";
import { BUILDER_STRATEGIES, BuilderRegistryService } from "./builders/builder-registry.service";
import { DockerfileBuilderStrategy } from "./builders/strategies/dockerfile-builder.strategy";
import { DockerComposeBuilderStrategy } from "./builders/strategies/docker-compose-builder.strategy";
import { BuildpackFamilyBuilderStrategy } from "./builders/strategies/buildpack-family-builder.strategy";
import type { BuilderStrategy } from "./builders/base/builder-strategy.interface";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";

@Module({
    imports: [
        DatabaseModule,
        ConfigurationCoreModule,
        // ── WHY A @Global MODULE STILL HAS TO BE IMPORTED ───────────────────
        // `DeploymentService` injects `DomainRoutingService`, provided by
        // `CoreDomainModule`. Global only means "visible everywhere once
        // registered" — the module must still be imported ONCE. The monolith got
        // it transitively through `ProjectModule`, which this service does not
        // serve.
        //
        // Without it the boot fails naming `DomainRoutingService` and
        // `DeploymentDomainModule`, neither of which is the actual problem.
        CoreDomainModule,
        // Post-deploy external probe goes through the egress policy; this service does not
        // get CoreReachabilityModule, so it imports the egress module itself.
        CoreEgressModule,
        MeshCoreModule,
        DeploymentCoreModule,
        ProjectCoreModule,
        ProviderDomainsModule,
        RunnersDomainModule,
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
        // Builder strategies: one array under one token. A new builder is one class plus one entry
        // in this factory and its `inject` list; the registry and its callers stay untouched.
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
                // The buildpack family builds from the GENERATED Dockerfile; without custom
                // commands it rejects with an actionable message instead of "Dockerfile not found".
                new BuildpackFamilyBuilderStrategy("nixpacks", dockerService),
                new BuildpackFamilyBuilderStrategy("buildpack", dockerService),
                new BuildpackFamilyBuilderStrategy("railpack", dockerService),
            ],
            inject: [DockerfileBuilderStrategy, DockerComposeBuilderStrategy, DockerService],
        },
        {
            provide: BuilderRegistryService,
            useFactory: (strategies: BuilderStrategy[]) => new BuilderRegistryService(strategies),
            inject: [BUILDER_STRATEGIES],
        },
        // Trigger sources: one array under one token, same shape as the builders above. A new
        // origin of deployments (a schedule, a registry webhook) is a class plus one entry here.
        ApiTriggerSource,
        GithubPushTriggerSource,
        {
            provide: DEPLOYMENT_TRIGGER_SOURCES,
            useFactory: (api: ApiTriggerSource, githubPush: GithubPushTriggerSource): DeploymentTriggerSource[] => [
                api,
                githubPush,
            ],
            inject: [ApiTriggerSource, GithubPushTriggerSource],
        },
        DeploymentTriggerRegistryService,
        DeploymentEventTriggerService,
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
export class DeploymentDomainModule {}
