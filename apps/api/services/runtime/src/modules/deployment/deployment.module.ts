import type { Context } from "effect";

import { CONTAINER_LINK_RESOLVER } from "@deployer/docker";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createModuleContext, effectHostProvider, EffectHost, serviceLifecycle, type EffectHostShape } from "@deployer/nest-effect";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { DeploymentCoreModule } from "@deployer/shared/core/modules/deployment/deployment-core.module";
import { CoreDomainModule } from "@deployer/shared/core/modules/domain/domain.module";
import { CoreEgressModule } from "@deployer/shared/core/modules/egress/egress.module";
import { EventsModule } from "@deployer/shared/core/modules/events/events.module";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { CoreEventSyncService } from "@deployer/shared/core/modules/events/index";
import { LocalEventOutboxRepository } from "@deployer/shared/core/modules/events/outbox/local-event-outbox.repository";
import { DeploymentProviderBuilderRunnerStateMachineService, type DeploymentStateMachineShape } from "@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import { ApprovalGuard } from "@deployer/shared/core/modules/approval/approval.guard";
import { RuntimeConfigurationAccessorService } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";
import { DomainRoutingService } from "@deployer/shared/core/modules/domain/services/domain-routing.service";
import { EgressService } from "@deployer/shared/core/modules/egress/egress.service";
import { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";
import { TraefikConfigRefresher, type TraefikConfigRefresherShape } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import { EnvService } from "@deployer/shared/config/env/env.module";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";
import { GitModule } from "@deployer/shared/core/modules/git/git/git.module";
import { GitService } from "@deployer/shared/core/modules/git/git/services/git.service";
import { ProjectCoreModule } from "@deployer/shared/core/modules/project/project-core.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { SwarmCluster } from "@deployer/swarm";

import { RuntimeDb, runtimeDbOver } from "../../core/database/runtime-db";
import { ProviderDomainsModule } from "../providers/providers.module";
import { RunnersDomainModule } from "../runners/runners.module";

import { BUILDER_STRATEGIES, BuilderRegistry, makeBuilderRegistry } from "./builders/builder-registry.service";
import { BuilderGitPort, BuilderStateMachinePort } from "./builders/builders.ports";
import { DeploymentArtifactBuilder } from "./builders/deployment-artifact-builder.service";
import { makeBuildpackFamilyBuilderStrategy } from "./builders/strategies/buildpack-family-builder.strategy";
import { makeDockerComposeBuilderStrategy } from "./builders/strategies/docker-compose-builder.strategy";
import { makeDockerfileBuilderStrategy } from "./builders/strategies/dockerfile-builder.strategy";
import { DeploymentController } from "./controllers/deployment.controller";
import { DeploymentEventService } from "./events/deployment-event.service";
import {
    DeploymentReadModelProjectorService,
    makeDeploymentReadModelProjector,
} from "./events/deployment-read-model-projector.service";
import { DeploymentStreamOrchestratorService } from "./mesh/services/deployment-stream-orchestrator.service";
import { PreviewEnvOverlayService } from "./preview/preview-env-overlay.service";
import { DeploymentQueueEventService } from "./queue/deployment-queue-event.service";
import {
    DeploymentQueueLifecycle,
    makeDeploymentQueueLifecycle,
} from "./queue/deployment-queue-lifecycle.service";
import { makeDeploymentQueueRepository } from "./queue/repositories/deployment-queue.repository";
import {
    DeploymentLogsPort,
    DeploymentRepositoryPort,
    DeploymentStreamsPort,
    OrphanedDeploymentsPort,
    ProjectorOutboxPort,
    QueueDeploymentsPort,
    QueueEnvPort,
} from "./deployment.ports";
import { DeploymentRepository } from "./repositories/deployment.repository";
import { DeploymentService, makeDeploymentService } from "./services/deployment.service";
import { ApiTriggerSource } from "./triggers/api-trigger.source";
import { GithubPushTriggerSource } from "./triggers/github-push-trigger.source";
import { DeploymentTriggerRegistry, makeDeploymentTriggerRegistry } from "./triggers/deployment-trigger-registry.service";
import { DeploymentEventTriggerService } from "./triggers/deployment-event-trigger.service";
import { SystemDeploymentsPort, TriggerServiceLinkPort } from "./triggers/deployment-trigger.ports";

import type { BuilderStrategy } from "./builders/base/builder-strategy.interface";
import {
    DeploymentExecutionWorkflow,
    makeDeploymentExecutionWorkflow,
} from "./services/deployment-execution-workflow.service";
import { DeploymentQueueWorker, makeDeploymentQueueWorker } from "./queue/deployment-queue.worker.service";
import {
    DeploymentQueueReconciliation,
    makeDeploymentQueueReconciliation,
} from "./queue/deployment-queue-reconciliation.service";
import { DeploymentStorageProvidersModule } from "./storage/storage-providers.module";
import { StoragePolicyResolverRegistry } from "./storage/policy/storage-policy-resolver-registry.service";
import { StorageProviderRegistry } from "./storage/storage-provider-registry.service";
import { CodeProviderRegistry } from "../providers/code/shared/code-provider-registry.service";
import { UploadBundleRegistry } from "../providers/code/upload/services/upload-bundle-registry.service";
import { RuntimeRunnerRegistry } from "../runners/runtime-runner-registry.service";
import { DeploymentContainerLinkService } from "./services/container-link.service";



export class DeploymentDomainModule extends createModuleContext({
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
        DeploymentCoreModule,
        ProjectCoreModule,
        ProviderDomainsModule,
        RunnersDomainModule,
        DeploymentStorageProvidersModule,
        GitModule,
        EventsModule,
        TraefikCoreModule,
        // D-6: NO Bull — the queue is the typed in-process lifecycle store +
        // this module's typed worker (DeploymentQueueWorker), driven by
        // the jobQueued$ RxJS channel. No Redis/queue IO to configure.
    ],
    controllers: [DeploymentController],
    providers: [
        {
            provide: DeploymentRepository,
            useFactory: (database: GlobalDatabaseService) => new DeploymentRepository(database),
            inject: [GlobalDatabaseService],
        },
        // The event buses are typed plain classes built over the shared stream pool.
        {
            provide: DeploymentEventService,
            useFactory: (pool?: CoreEventStreamPoolService) => new DeploymentEventService(pool),
            inject: [{ token: CoreEventStreamPoolService, optional: true }],
        },
        {
            provide: DeploymentQueueEventService,
            useFactory: (pool?: CoreEventStreamPoolService) => new DeploymentQueueEventService(pool),
            inject: [{ token: CoreEventStreamPoolService, optional: true }],
        },
        CoreEventSyncService,
        // The execution workflow and the deployment core are Effect services built over these ports. The core keeps
        // in-memory state, so it is built once (`useFactory`) and registers its event namespace in `onStart`.
        { provide: DeploymentRepositoryPort, useExisting: DeploymentRepository },
        {
            provide: DeploymentExecutionWorkflow,
            useFactory: (
                deploymentRepository: Context.Service.Shape<typeof DeploymentRepositoryPort>,
                runtimeRunnerRegistry: Context.Service.Shape<typeof RuntimeRunnerRegistry>,
                host: EffectHostShape,
                deploymentEventService: DeploymentEventService,
                domainRoutingService: DomainRoutingService,
                egress: EgressService,
            ) =>
                makeDeploymentExecutionWorkflow({
                    deploymentRepository,
                    runtimeRunnerRegistry,
                    host,
                    deploymentEventService,
                    domainRoutingService,
                    egress,
                }),
            inject: [
                DeploymentRepositoryPort,
                RuntimeRunnerRegistry,
                EffectHost,
                DeploymentEventService,
                DomainRoutingService,
                EgressService,
            ],
        },
        {
            provide: DeploymentService,
            useFactory: (
                deploymentRepository: Context.Service.Shape<typeof DeploymentRepositoryPort>,
                deploymentEventService: DeploymentEventService,
                coreEventSyncService: CoreEventSyncService,
                codeProviders: Context.Service.Shape<typeof CodeProviderRegistry>,
                storageProviders: Context.Service.Shape<typeof StorageProviderRegistry>,
                storagePolicies: Context.Service.Shape<typeof StoragePolicyResolverRegistry>,
                workflow: Context.Service.Shape<typeof DeploymentExecutionWorkflow>,
                queue: Context.Service.Shape<typeof DeploymentQueueLifecycle>,
                deploymentStateMachineService: DeploymentStateMachineShape,
                uploadBundles: Context.Service.Shape<typeof UploadBundleRegistry>,
                projectAccessService: Context.Service.Shape<typeof ProjectAccessService>,
                domainRoutingService: DomainRoutingService,
                runtimeConfigurationAccessor: RuntimeConfigurationAccessorService,
                ingressRefresher: TraefikConfigRefresherShape,
                host: EffectHostShape,
                approvalGuard: Context.Service.Shape<typeof ApprovalGuard>,
            ) =>
                makeDeploymentService({
                    deploymentRepository,
                    deploymentEventService,
                    coreEventSyncService,
                    codeProviders,
                    storageProviders,
                    storagePolicies,
                    workflow,
                    queue,
                    deploymentStateMachineService,
                    uploadBundles,
                    projectAccessService,
                    domainRoutingService,
                    runtimeConfigurationAccessor,
                    ingressRefresher,
                    host,
                    approvalGuard,
                }),
            inject: [
                DeploymentRepositoryPort,
                DeploymentEventService,
                CoreEventSyncService,
                CodeProviderRegistry,
                StorageProviderRegistry,
                StoragePolicyResolverRegistry,
                DeploymentExecutionWorkflow,
                DeploymentQueueLifecycle,
                DeploymentProviderBuilderRunnerStateMachineService,
                UploadBundleRegistry,
                ProjectAccessService,
                DomainRoutingService,
                RuntimeConfigurationAccessorService,
                TraefikConfigRefresher,
                EffectHost,
                ApprovalGuard,
            ],
        },
        serviceLifecycle(DeploymentService),
        // What the queue, event and stream services need from the not-yet-migrated deployment core: ports bound
        // with `useExisting`, so migrating the core is a rebinding here.
        { provide: DeploymentLogsPort, useExisting: DeploymentRepository },
        { provide: OrphanedDeploymentsPort, useExisting: DeploymentRepository },
        { provide: QueueDeploymentsPort, useExisting: DeploymentService },
        { provide: DeploymentStreamsPort, useExisting: DeploymentService },
        { provide: ProjectorOutboxPort, useExisting: LocalEventOutboxRepository },
        { provide: QueueEnvPort, useExisting: EnvService },
        {
            provide: DeploymentReadModelProjectorService,
            useFactory: (
                outbox: Context.Service.Shape<typeof ProjectorOutboxPort>,
                logs: Context.Service.Shape<typeof DeploymentLogsPort>,
            ) => makeDeploymentReadModelProjector({ outbox, logs }),
            inject: [ProjectorOutboxPort, DeploymentLogsPort],
        },
        // The queue: durable store + typed events (`DeploymentQueueLifecycle`), the worker that executes jobs, and the
        // boot reconciliation. Each declares its own start/run/stop; `serviceLifecycle` binds them to the app's.
        {
            provide: DeploymentQueueLifecycle,
            useFactory: (database: GlobalDatabaseService, events: DeploymentQueueEventService) =>
                makeDeploymentQueueLifecycle({
                    repository: makeDeploymentQueueRepository(runtimeDbOver(database)),
                    events,
                }),
            inject: [GlobalDatabaseService, DeploymentQueueEventService],
        },
        serviceLifecycle(DeploymentQueueLifecycle),
        {
            provide: DeploymentQueueWorker,
            useFactory: (
                deployments: Context.Service.Shape<typeof QueueDeploymentsPort>,
                lifecycle: Context.Service.Shape<typeof DeploymentQueueLifecycle>,
                host: EffectHostShape,
                env?: Context.Service.Shape<typeof QueueEnvPort>,
            ) => makeDeploymentQueueWorker({ deployments, lifecycle, host, env }),
            inject: [QueueDeploymentsPort, DeploymentQueueLifecycle, EffectHost, { token: QueueEnvPort, optional: true }],
        },
        serviceLifecycle(DeploymentQueueWorker),
        {
            provide: DeploymentQueueReconciliation,
            useFactory: (
                deployments: Context.Service.Shape<typeof OrphanedDeploymentsPort>,
                queue: Context.Service.Shape<typeof DeploymentQueueLifecycle>,
                swarm?: Context.Service.Shape<typeof SwarmCluster>,
            ) => makeDeploymentQueueReconciliation({ deployments, queue, swarm }),
            inject: [OrphanedDeploymentsPort, DeploymentQueueLifecycle, { token: SwarmCluster, optional: true }],
        },
        serviceLifecycle(DeploymentQueueReconciliation),
        { provide: DeploymentStreamOrchestratorService, useValue: DeploymentStreamOrchestratorService.live },
        // The artifact builder is a constant Effect service over these ports.
        { provide: BuilderGitPort, useExisting: GitService },
        { provide: BuilderStateMachinePort, useExisting: DeploymentProviderBuilderRunnerStateMachineService },
        { provide: DeploymentArtifactBuilder, useValue: DeploymentArtifactBuilder.live },
        // Builder strategies: one array under one token. A new builder is one factory function plus one entry
        // in this array; the registry and its callers stay untouched.
        {
            provide: BUILDER_STRATEGIES,
            useFactory: (engine: DockerEngineShape): BuilderStrategy[] => [
                makeDockerfileBuilderStrategy(engine),
                makeDockerComposeBuilderStrategy(engine),
                // The buildpack family builds from the GENERATED Dockerfile; without custom
                // commands it rejects with an actionable message instead of "Dockerfile not found".
                makeBuildpackFamilyBuilderStrategy("nixpacks", engine),
                makeBuildpackFamilyBuilderStrategy("buildpack", engine),
                makeBuildpackFamilyBuilderStrategy("railpack", engine),
            ],
            inject: [DockerEngine],
        },
        { provide: BuilderRegistry, useFactory: makeBuilderRegistry, inject: [BUILDER_STRATEGIES] },
        serviceLifecycle(BuilderRegistry),
        // Trigger sources: a new origin of deployments (a schedule, a registry webhook) is a class plus one entry here.
        // The registry is started and stopped by `serviceLifecycle`, which needs the Effect host.
        effectHostProvider(),
        {
            provide: DeploymentTriggerRegistry,
            useFactory: () => makeDeploymentTriggerRegistry([new ApiTriggerSource(), new GithubPushTriggerSource()]),
        },
        serviceLifecycle(DeploymentTriggerRegistry),
        { provide: TriggerServiceLinkPort, useExisting: DeploymentRepository },
        { provide: RuntimeDb, useValue: RuntimeDb.live },
        { provide: SystemDeploymentsPort, useExisting: DeploymentService },
        { provide: DeploymentEventTriggerService, useClass: DeploymentEventTriggerService.live },
        { provide: PreviewEnvOverlayService, useValue: PreviewEnvOverlayService.live },
        { provide: DeploymentContainerLinkService, useValue: DeploymentContainerLinkService.live },
        { provide: CONTAINER_LINK_RESOLVER, useExisting: DeploymentContainerLinkService },
    ],
    exports: [
        DeploymentService,
        DeploymentRepository,
        DeploymentEventService,
        DeploymentReadModelProjectorService,
        PreviewEnvOverlayService,
    ],
}) {}
