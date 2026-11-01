# Nest services that should be Effect services

HealthRegistry was converted first (commit `48dcd0ff`) and is the reference: a `Context.Service` tag whose
`static live` class implements the shape, Effect-returning commands, and a small provider that owns any fiber
or timer through `EffectHost`.

## The rule

- A class that holds **domain state or rules** is a tag + `static live` class (see `apps/api/AGENTS.md`).
- A class that must stay Nest: controllers, guards, interceptors, filters, pipes, gateways, subscribers,
  strategies, resolvers, processors, module classes, CLI commands, and anything that only integrates Nest
  itself (`EffectRuntime`, `HealthRegistryCadence`).
- Construction that needs a live handle (a pool, an open socket, a path) is a constructor argument with a
  default, injected by a `useFactory` with an optional token — never a `static live` that reaches for globals.

## Inventory

166 classes still to convert.

| Area | To convert |
|---|---|
| `apps/api/services/runtime/src/modules/deployment` | 25 |
| `apps/api/shared/src/core/modules/traefik` | 12 |
| `apps/api/bff` | 9 |
| `apps/api/services/runtime/src/modules/docker` | 9 |
| `apps/api/services/runtime/src/modules/providers` | 6 |
| `apps/api/shared/src/core/modules/database` | 6 |
| `apps/api/shared/src/core/modules/domain` | 6 |
| `apps/api/shared/src/core/modules/events` | 6 |
| `apps/api/shared/src/core/modules/platform-ingress` | 6 |
| `apps/setup/src/modules/handover` | 6 |
| `apps/api/shared/src/core/modules/git` | 5 |
| `apps/api/shared/src/core/modules/mesh` | 5 |
| `apps/api/shared/src/core/modules/reachability` | 5 |
| `apps/setup/src/modules/wizard` | 5 |
| `apps/api/bff/src/cli/commands` | 4 |
| `apps/api/shared/src/core/modules/configuration` | 4 |
| `apps/api/shared/src/core/modules/setup` | 4 |
| `apps/api/shared/src/core/modules/deployment` | 3 |
| `apps/api/shared/src/core/modules/edge` | 3 |
| `apps/setup/src/modules/cluster` | 3 |
| `apps/api/bff/src/modules/shared` | 2 |
| `apps/api/shared` | 2 |
| `apps/api/shared/src/core/modules/auth` | 2 |
| `apps/api/shared/src/core/modules/mesh-node` | 2 |
| `apps/api/shared/src/core/modules/project` | 2 |
| `apps/api/shared/src/core/modules/supervision` | 2 |
| `apps/api/shared/src/core/modules/swarm` | 2 |
| `apps/setup/src/modules/health` | 2 |
| `apps/api/bff/src/cli/services` | 1 |
| `apps/api/bff/src/modules/console` | 1 |
| `apps/api/bff/src/modules/dashboard` | 1 |
| `apps/api/bff/src/modules/health` | 1 |
| `apps/api/services/fleet/src/modules/cluster` | 1 |
| `apps/api/services/fleet/src/modules/providers` | 1 |
| `apps/api/services` | 1 |
| `apps/api/services/runtime/src/modules/runners` | 1 |
| `apps/api/shared/src/core/modules/app-config` | 1 |
| `apps/api/shared/src/core/modules/bootstrap` | 1 |
| `apps/api/shared/src/core/modules/egress` | 1 |
| `apps/api/shared/src/core/modules/node-state` | 1 |
| `apps/api/shared/src/server/health` | 1 |
| `apps/api/shared/src/server/preflight` | 1 |
| `apps/api/shared/src/server/service-client.ts` | 1 |
| `apps/setup/src/modules/ingress` | 1 |
| `apps/setup/src/modules/progress` | 1 |
| `packages/nest/effect` | 1 |

## The list

### `apps/api/services/runtime/src/modules/deployment`

- `apps/api/services/runtime/src/modules/deployment/builders/builder-registry.service.ts` :: `BuilderRegistryService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/builders/deployment-artifact-builder.service.ts` :: `DeploymentArtifactBuilderService` — ctor
- `apps/api/services/runtime/src/modules/deployment/events/deployment-event.service.ts` :: `DeploymentEventService` — ctor
- `apps/api/services/runtime/src/modules/deployment/events/deployment-read-model-projector.service.ts` :: `DeploymentReadModelProjectorService` — ctor
- `apps/api/services/runtime/src/modules/deployment/mesh/services/deployment-stream-orchestrator.service.ts` :: `DeploymentStreamOrchestratorService` — ctor
- `apps/api/services/runtime/src/modules/deployment/preview/preview-env-overlay.service.ts` :: `PreviewEnvOverlayService`
- `apps/api/services/runtime/src/modules/deployment/queue/deployment-queue-event.service.ts` :: `DeploymentQueueEventService` — ctor
- `apps/api/services/runtime/src/modules/deployment/queue/deployment-queue-lifecycle.service.ts` :: `DeploymentQueueLifecycleService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/queue/deployment-queue-reconciliation.service.ts` :: `DeploymentQueueReconciliationService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/queue/deployment-queue.worker.service.ts` :: `DeploymentQueueWorkerService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/repositories/deployment.repository.ts` :: `DeploymentRepository` — ctor
- `apps/api/services/runtime/src/modules/deployment/services/container-link.service.ts` :: `DeploymentContainerLinkService`
- `apps/api/services/runtime/src/modules/deployment/services/deployment-execution-workflow.service.ts` :: `DeploymentExecutionWorkflowService` — ctor
- `apps/api/services/runtime/src/modules/deployment/services/deployment.service.ts` :: `DeploymentService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/storage/local/local-storage-provider.service.ts` :: `LocalStorageProviderService`
- `apps/api/services/runtime/src/modules/deployment/storage/nfs/nfs-storage-provider.service.ts` :: `NfsStorageProviderService`
- `apps/api/services/runtime/src/modules/deployment/storage/policy/runtime-configuration-storage-policy-resolver.service.ts` :: `RuntimeConfigurationStoragePolicyResolverService`
- `apps/api/services/runtime/src/modules/deployment/storage/policy/service-top-level-storage-policy-resolver.service.ts` :: `ServiceTopLevelStoragePolicyResolverService`
- `apps/api/services/runtime/src/modules/deployment/storage/policy/storage-policy-resolver-registry.service.ts` :: `StoragePolicyResolverRegistryService` — ctor
- `apps/api/services/runtime/src/modules/deployment/storage/s3/s3-storage-provider.service.ts` :: `S3StorageProviderService`
- `apps/api/services/runtime/src/modules/deployment/storage/storage-provider-registry.service.ts` :: `StorageProviderRegistryService` — ctor
- `apps/api/services/runtime/src/modules/deployment/storage/volume/volume-storage-provider.service.ts` :: `VolumeStorageProviderService`
- `apps/api/services/runtime/src/modules/deployment/triggers/api-trigger.source.ts` :: `ApiTriggerSource`
- `apps/api/services/runtime/src/modules/deployment/triggers/deployment-trigger-registry.service.ts` :: `DeploymentTriggerRegistryService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/deployment/triggers/github-push-trigger.source.ts` :: `GithubPushTriggerSource` — ctor

### `apps/api/shared/src/core/modules/traefik`

- `apps/api/shared/src/core/modules/traefik/events/traefik-event.service.ts` :: `TraefikEventService` — ctor
- `apps/api/shared/src/core/modules/traefik/repositories/traefik-template.repository.ts` :: `TraefikTemplateRepository` — ctor
- `apps/api/shared/src/core/modules/traefik/repositories/traefik.repository.ts` :: `TraefikRepository` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-config-refresher.service.ts` :: `TraefikConfigRefresher` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-file-system.service.ts` :: `TraefikFileSystemService` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-ingress-config.service.ts` :: `TraefikIngressConfigService` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-middleware-library.service.ts` :: `TraefikMiddlewareLibraryService`
- `apps/api/shared/src/core/modules/traefik/services/traefik-sync.service.ts` :: `TraefikSyncService` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-template.service.ts` :: `TraefikTemplateService` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-validation.service.ts` :: `TraefikValidationService` — ctor
- `apps/api/shared/src/core/modules/traefik/services/traefik-variable-resolver.service.ts` :: `TraefikVariableResolverService`
- `apps/api/shared/src/core/modules/traefik/services/traefik.service.ts` :: `TraefikService` — ctor

### `apps/api/bff`

- `apps/api/bff/src/clients/fleet/fleet.client.ts` :: `FleetClient` — ctor
- `apps/api/bff/src/clients/health/health.client.ts` :: `HealthClient` — ctor
- `apps/api/bff/src/clients/identity/analytics.client.ts` :: `AnalyticsClient` — ctor
- `apps/api/bff/src/clients/identity/identity.client.ts` :: `IdentityClient` — ctor
- `apps/api/bff/src/clients/project/project.client.ts` :: `ProjectClient` — ctor
- `apps/api/bff/src/clients/runtime/runtime.client.ts` :: `RuntimeClient` — ctor
- `apps/api/bff/src/clients/service-registry.ts` :: `ServiceClientRegistry`
- `apps/api/bff/src/domains/setup/services/post-setup-destination.service.ts` :: `PostSetupDestinationService` — ctor
- `apps/api/bff/src/domains/setup/services/post-setup-verification.service.ts` :: `PostSetupVerificationService` — ctor

### `apps/api/services/runtime/src/modules/docker`

- `apps/api/services/runtime/src/modules/docker/domains/images/application/docker-images-application.service.ts` :: `DockerImagesApplicationService` — ctor
- `apps/api/services/runtime/src/modules/docker/domains/images/orchestration/docker-images-orchestrator.service.ts` :: `DockerImagesOrchestratorService` — ctor
- `apps/api/services/runtime/src/modules/docker/domains/images/queue/docker-image-auto-scan-listener.service.ts` :: `DockerImageAutoScanListenerService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/docker/domains/images/security/docker-image-security-scan.service.ts` :: `DockerImageSecurityScanService` — ctor
- `apps/api/services/runtime/src/modules/docker/domains/runtime/orchestration/docker-runtime-activity-domain.service.ts` :: `DockerRuntimeActivityDomainService` — ctor
- `apps/api/services/runtime/src/modules/docker/domains/runtime/orchestration/docker-runtime-orchestrator.service.ts` :: `DockerRuntimeOrchestratorService` — ctor
- `apps/api/services/runtime/src/modules/docker/repositories/facade/docker.repository.ts` :: `DockerRepository` — ctor
- `apps/api/services/runtime/src/modules/docker/repositories/images/catalog/docker-image-catalog.repository.ts` :: `DockerImageCatalogRepository` — ctor
- `apps/api/services/runtime/src/modules/docker/repositories/images/security/docker-image-security.repository.ts` :: `DockerImageSecurityRepository` — ctor

### `apps/api/services/runtime/src/modules/providers`

- `apps/api/services/runtime/src/modules/providers/code/custom/services/custom-source-provider.service.ts` :: `CustomSourceProviderService`
- `apps/api/services/runtime/src/modules/providers/code/github/services/github-source-provider.service.ts` :: `GithubSourceProviderService` — ctor
- `apps/api/services/runtime/src/modules/providers/code/gitlab/services/gitlab-source-provider.service.ts` :: `GitlabSourceProviderService` — ctor
- `apps/api/services/runtime/src/modules/providers/code/shared/code-provider-registry.service.ts` :: `CodeProviderRegistryService` — lifecycle, ctor
- `apps/api/services/runtime/src/modules/providers/code/upload/services/upload-bundle-registry.service.ts` :: `UploadBundleRegistryService`
- `apps/api/services/runtime/src/modules/providers/code/upload/services/upload-source-provider.service.ts` :: `UploadSourceProviderService` — ctor

### `apps/api/shared/src/core/modules/database`

- `apps/api/shared/src/core/modules/database/global/global-database-lifecycle.service.ts` :: `GlobalDatabaseLifecycleService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/database/global/global-database.service.ts` :: `GlobalDatabaseService` — ctor
- `apps/api/shared/src/core/modules/database/services/bootstrap-advisory-lock.service.ts` :: `BootstrapAdvisoryLockService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/database/services/database-failure-tracker.service.ts` :: `DatabaseFailureTracker` — ctor
- `apps/api/shared/src/core/modules/database/services/database-probe.service.ts` :: `DatabaseProbeService`
- `apps/api/shared/src/core/modules/database/services/database-startup-guard.service.ts` :: `DatabaseStartupGuard` — ctor

### `apps/api/shared/src/core/modules/domain`

- `apps/api/shared/src/core/modules/domain/repositories/project-domain.repository.ts` :: `ProjectDomainRepository` — ctor
- `apps/api/shared/src/core/modules/domain/repositories/service-domain-mapping.repository.ts` :: `ServiceDomainMappingRepository` — ctor
- `apps/api/shared/src/core/modules/domain/services/domain-conflict.service.ts` :: `DomainConflictService` — ctor
- `apps/api/shared/src/core/modules/domain/services/domain-routing.service.ts` :: `DomainRoutingService` — ctor
- `apps/api/shared/src/core/modules/domain/services/domain-verification.service.ts` :: `DomainVerificationService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/domain/services/service-domain-mapping.service.ts` :: `ServiceDomainMappingService` — ctor

### `apps/api/shared/src/core/modules/events`

- `apps/api/shared/src/core/modules/events/base/core-event-stream-pool.service.ts` :: `CoreEventStreamPoolService`
- `apps/api/shared/src/core/modules/events/outbox/local-event-outbox-dispatcher.service.ts` :: `LocalEventOutboxDispatcherService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/events/outbox/local-event-outbox.repository.ts` :: `LocalEventOutboxRepository` — ctor
- `apps/api/shared/src/core/modules/events/repositories/core-event-log.repository.ts` :: `CoreEventLogRepository` — ctor
- `apps/api/shared/src/core/modules/events/repositories/core-event-stream.repository.ts` :: `CoreEventStreamRepository` — ctor
- `apps/api/shared/src/core/modules/events/services/core-event-sync.service.ts` :: `CoreEventSyncService` — ctor

### `apps/api/shared/src/core/modules/platform-ingress`

- `apps/api/shared/src/core/modules/platform-ingress/services/app-instance.service.ts` :: `AppInstanceService` — ctor
- `apps/api/shared/src/core/modules/platform-ingress/services/hostname.service.ts` :: `EnvHostnameService` — ctor
- `apps/api/shared/src/core/modules/platform-ingress/services/ingress-lanes.service.ts` :: `IngressLanesService` — ctor
- `apps/api/shared/src/core/modules/platform-ingress/services/platform-config.service.ts` :: `PlatformConfigService` — ctor
- `apps/api/shared/src/core/modules/platform-ingress/services/platform-routes-source.service.ts` :: `PlatformRoutesSource` — ctor
- `apps/api/shared/src/core/modules/platform-ingress/services/platform-web-target.service.ts` :: `PlatformWebTargetService` — ctor

### `apps/setup/src/modules/handover`

- `apps/setup/src/modules/handover/services/api-readiness-watcher.service.ts` :: `ApiReadinessWatcherService` — ctor
- `apps/setup/src/modules/handover/services/api-service-provisioner.service.ts` :: `ApiServiceProvisioner` — ctor
- `apps/setup/src/modules/handover/services/handover-orchestrator.service.ts` :: `HandoverOrchestratorService` — lifecycle, ctor
- `apps/setup/src/modules/handover/services/ingress-handover.service.ts` :: `IngressHandoverService` — lifecycle, ctor
- `apps/setup/src/modules/handover/services/services-tier-provisioner.service.ts` :: `ServicesTierProvisioner` — lifecycle, ctor
- `apps/setup/src/modules/handover/services/setup-exit.service.ts` :: `SetupExitService` — lifecycle, ctor

### `apps/api/shared/src/core/modules/git`

- `apps/api/shared/src/core/modules/git/git/services/git.service.ts` :: `GitService`
- `apps/api/shared/src/core/modules/git/github/repositories/github-deployment-cache.repository.ts` :: `GithubDeploymentCacheRepository` — ctor
- `apps/api/shared/src/core/modules/git/github/repositories/github-deployment-rules.repository.ts` :: `GithubDeploymentRulesRepository` — ctor
- `apps/api/shared/src/core/modules/git/github/repositories/github-repository-config.repository.ts` :: `GithubRepositoryConfigRepository` — ctor
- `apps/api/shared/src/core/modules/git/github/services/github.service.ts` :: `GitHubService`

### `apps/api/shared/src/core/modules/mesh`

- `apps/api/shared/src/core/modules/mesh/initialization/services/mesh-initialization.service.ts` :: `MeshInitializationService`
- `apps/api/shared/src/core/modules/mesh/repositories/node-mesh-config.repository.ts` :: `NodeMeshConfigRepository` — ctor
- `apps/api/shared/src/core/modules/mesh/repositories/system-mesh-cluster.repository.ts` :: `SystemMeshClusterRepository` — ctor
- `apps/api/shared/src/core/modules/mesh/services/system-mesh-config.service.ts` :: `SystemMeshConfigService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/mesh/version/mesh-version.service.ts` :: `MeshVersionService` — ctor

### `apps/api/shared/src/core/modules/reachability`

- `apps/api/shared/src/core/modules/reachability/events/public-access-point-event.service.ts` :: `PublicAccessPointEventService` — ctor
- `apps/api/shared/src/core/modules/reachability/repositories/node-network-config.repository.ts` :: `NodeNetworkConfigRepository` — ctor
- `apps/api/shared/src/core/modules/reachability/services/public-access-point.service.ts` :: `PublicAccessPointService` — ctor
- `apps/api/shared/src/core/modules/reachability/services/public-edge.service.ts` :: `PublicEdgeService` — ctor
- `apps/api/shared/src/core/modules/reachability/services/reachability.service.ts` :: `ReachabilityService` — ctor

### `apps/setup/src/modules/wizard`

- `apps/setup/src/modules/wizard/mesh-onboarding.service.ts` :: `MeshOnboardingService` — ctor
- `apps/setup/src/modules/wizard/setup-gate.service.ts` :: `SetupGateService` — lifecycle, ctor
- `apps/setup/src/modules/wizard/wizard-state.service.ts` :: `WizardStateService` — ctor
- `apps/setup/src/modules/wizard/wizard-stream.service.ts` :: `WizardStreamService` — ctor
- `apps/setup/src/modules/wizard/wizard-upstream.service.ts` :: `WizardUpstreamService` — ctor

### `apps/api/bff/src/cli/commands`

- `apps/api/bff/src/cli/commands/create-default-admin.command.ts` :: `CreateDefaultAdminCommand` — ctor
- `apps/api/bff/src/cli/commands/node-startup-check.command.ts` :: `NodeStartupCheckCommand` — ctor
- `apps/api/bff/src/cli/commands/seed.command/index.ts` :: `SeedCommand` — ctor
- `apps/api/bff/src/cli/commands/setup-db.command.ts` :: `SetupDbCommand` — ctor

### `apps/api/shared/src/core/modules/configuration`

- `apps/api/shared/src/core/modules/configuration/services/configuration-definition.service.ts` :: `ConfigurationDefinitionService`
- `apps/api/shared/src/core/modules/configuration/services/configuration-resolver.service.ts` :: `ConfigurationResolverService` — ctor
- `apps/api/shared/src/core/modules/configuration/services/configuration-state-machine-builder.service.ts` :: `ConfigurationStateMachineBuilderService` — ctor
- `apps/api/shared/src/core/modules/configuration/services/runtime-configuration-accessor.service.ts` :: `RuntimeConfigurationAccessorService` — ctor

### `apps/api/shared/src/core/modules/setup`

- `apps/api/shared/src/core/modules/setup/services/initialization.service.ts` :: `InitializationService` — lifecycle, ctor
- `apps/api/shared/src/core/modules/setup/services/local-initialization.service.ts` :: `LocalInitializationService` — ctor
- `apps/api/shared/src/core/modules/setup/services/remote-initialization.service.ts` :: `RemoteInitializationService` — ctor
- `apps/api/shared/src/core/modules/setup/services/setup-event.service.ts` :: `SetupEventService` — ctor

### `apps/api/shared/src/core/modules/deployment`

- `apps/api/shared/src/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service.ts` :: `DeploymentProviderBuilderRunnerStateMachineService`
- `apps/api/shared/src/core/modules/deployment/services/preview-cleanup-policy.service.ts` :: `PreviewCleanupPolicyService`
- `apps/api/shared/src/core/modules/deployment/services/preview-naming.service.ts` :: `PreviewNamingService`

### `apps/api/shared/src/core/modules/edge`

- `apps/api/shared/src/core/modules/edge/edge-provider.registry.ts` :: `EdgeProviderRegistry`
- `apps/api/shared/src/core/modules/edge/edge-state.store.ts` :: `EdgeStateStore` — ctor
- `apps/api/shared/src/core/modules/edge/providers/direct.edge-provider.ts` :: `DirectEdgeProvider` — ctor

### `apps/setup/src/modules/cluster`

- `apps/setup/src/modules/cluster/services/cluster-orchestrator.service.ts` :: `ClusterOrchestratorService` — ctor
- `apps/setup/src/modules/cluster/services/node-agent-launcher.service.ts` :: `NodeAgentLauncherService` — ctor
- `apps/setup/src/modules/cluster/services/swarm-bootstrap.service.ts` :: `SwarmBootstrapService` — ctor

### `apps/api/bff/src/modules/shared`

- `apps/api/bff/src/modules/shared/services/overview-composer.service.ts` :: `OverviewComposerService` — ctor
- `apps/api/bff/src/modules/shared/services/screen-read.service.ts` :: `ScreenReadService` — ctor

### `apps/api/shared`

- `apps/api/shared/src/core/middlewares/internal-error/internal-error-insight.service.ts` :: `InternalErrorInsightService`
- `apps/api/shared/src/core/utils/migration-journal.service.ts` :: `MigrationJournalService`

### `apps/api/shared/src/core/modules/auth`

- `apps/api/shared/src/core/modules/auth/services/auth-core.service.ts` :: `AuthCoreService` — ctor
- `apps/api/shared/src/core/modules/auth/services/auth.service.ts` :: `AuthService` — ctor

### `apps/api/shared/src/core/modules/mesh-node`

- `apps/api/shared/src/core/modules/mesh-node/cluster-settings.ts` :: `ClusterSettings` — ctor
- `apps/api/shared/src/core/modules/mesh-node/node-agent-bootstrap.service.ts` :: `NodeAgentBootstrapService` — lifecycle, ctor

### `apps/api/shared/src/core/modules/project`

- `apps/api/shared/src/core/modules/project/repositories/project-access.repository.ts` :: `ProjectAccessRepository` — ctor
- `apps/api/shared/src/core/modules/project/services/project-access.service.ts` :: `ProjectAccessService` — ctor

### `apps/api/shared/src/core/modules/supervision`

- `apps/api/shared/src/core/modules/supervision/supervisor-event.bus.ts` :: `SupervisorEventBus`
- `apps/api/shared/src/core/modules/supervision/supervisor-registration.ts` :: `SupervisorRegistrar` — lifecycle, ctor

### `apps/api/shared/src/core/modules/swarm`

- `apps/api/shared/src/core/modules/swarm/repositories/global-cluster-nodes.repository.ts` :: `GlobalClusterNodesRepository` — ctor
- `apps/api/shared/src/core/modules/swarm/services/node-inventory.service.ts` :: `NodeInventoryService` — lifecycle, ctor

### `apps/setup/src/modules/health`

- `apps/setup/src/modules/health/setup-phase.service.ts` :: `SetupPhaseService`
- `apps/setup/src/modules/health/setup-readiness.indicator.ts` :: `SetupReadinessIndicator` — ctor

### `apps/api/bff/src/cli/services`

- `apps/api/bff/src/cli/services/cli-auth.service.ts` :: `CliAuthService` — ctor

### `apps/api/bff/src/modules/console`

- `apps/api/bff/src/modules/console/clients/managed-web.client.ts` :: `ManagedWebClient` — ctor

### `apps/api/bff/src/modules/dashboard`

- `apps/api/bff/src/modules/dashboard/services/analytics-read.service.ts` :: `AnalyticsReadService` — ctor

### `apps/api/bff/src/modules/health`

- `apps/api/bff/src/modules/health/services/platform-health.service.ts` :: `PlatformHealthService`

### `apps/api/services/fleet/src/modules/cluster`

- `apps/api/services/fleet/src/modules/cluster/events/cluster-swarm-events.service.ts` :: `ClusterSwarmEventsService` — lifecycle, ctor

### `apps/api/services/fleet/src/modules/providers`

- `apps/api/services/fleet/src/modules/providers/edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider.ts` :: `CloudflareTunnelEdgeProvider` — ctor

### `apps/api/services`

- `apps/api/services/node-agent/src/transport/mesh-transport.service.ts` :: `MeshTransportService` — lifecycle, ctor

### `apps/api/services/runtime/src/modules/runners`

- `apps/api/services/runtime/src/modules/runners/swarm/swarm-compose-realizer.service.ts` :: `SwarmComposeRealizerService`

### `apps/api/shared/src/core/modules/app-config`

- `apps/api/shared/src/core/modules/app-config/app-config.service.ts` :: `AppConfigService`

### `apps/api/shared/src/core/modules/bootstrap`

- `apps/api/shared/src/core/modules/bootstrap/bootstrap-orchestrator.service.ts` :: `BootstrapOrchestratorService` — lifecycle, ctor

### `apps/api/shared/src/core/modules/egress`

- `apps/api/shared/src/core/modules/egress/egress.service.ts` :: `EgressService` — ctor

### `apps/api/shared/src/core/modules/node-state`

- `apps/api/shared/src/core/modules/node-state/node-config.snapshot.ts` :: `NodeConfigSnapshot` — lifecycle, ctor

### `apps/api/shared/src/server/health`

- `apps/api/shared/src/server/health/health-registry-cadence.provider.ts` :: `HealthRegistryCadence` — lifecycle, ctor

### `apps/api/shared/src/server/preflight`

- `apps/api/shared/src/server/preflight/preflight.service.ts` :: `PreflightService` — ctor

### `apps/api/shared/src/server/service-client.ts`

- `apps/api/shared/src/server/service-client.ts` :: `ServiceClient`

### `apps/setup/src/modules/ingress`

- `apps/setup/src/modules/ingress/services/bootstrap-ingress.service.ts` :: `BootstrapIngressService` — lifecycle, ctor

### `apps/setup/src/modules/progress`

- `apps/setup/src/modules/progress/services/orchestration-stream.service.ts` :: `OrchestrationStreamService` — ctor

### `packages/nest/effect`

- `packages/nest/effect/src/effect-runtime.ts` :: `EffectRuntime` — lifecycle, ctor


## Order of work

1. `apps/api/shared/src/server` — `PreflightService`, `ServiceClient` (both are boot-path and have tests).
2. `apps/api/shared/src/core/modules/*` — one module per change set, repositories first (they are the leaves), then
   services, then the module wiring. `traefik` (11), `reachability` (5), `setup` (4), `configuration` (4), `domain` (4)
   are the biggest clusters.
3. `apps/api/services/runtime` (37) — repositories and providers before queues and workflow services.
4. `apps/api/bff` (10 clients and read services are the natural start: they hold no state).
5. `apps/setup` (15) — after the API tier, because the wizard drives it.

Each slice ends with `bun run type-check` at the root, the owning app's suite, and `check:di-graph` +
`check:global-modules`.

## Nest lifecycle hooks on services

`serviceLifecycle(Tag)` (`@deployer/nest-effect`, `ServiceLifecycleShape`) binds a tag's own `onStart` / `run` / `onStop`
to Nest's lifecycle: `onStart` runs once and must complete, `run` is forked and interrupted on shutdown, `onStop` runs
after the interruption. A tag that declares none of the three cannot be bound — that is the compile error which forces
the decision.

Migrated: `HealthRegistry` (`48dcd0ff` cadence provider → `serviceLifecycle`, `run`/`onStop` in the shape).

Remaining classes that still implement `OnModuleInit` / `OnModuleDestroy` / `OnApplication*`:

| Class | Verdict |
|---|---|
| `GlobalDatabaseLifecycleService` | shape gains `onStop` (close the pool); class becomes a factory provider |
| `ScannerPoolLifecycle` (docker.module) | same: `onStop` closes the pool |
| `SwarmLifecycle` (swarm.module, setup cluster.module) | same: `onStart` joins, `onStop` leaves |
| `SupervisorRegistrar` | same: `onStart` registers, `onStop` disposes |
| `SupervisorDriftControl` (supervisors.module) | move `startDriftControl` into the orchestrator shape (`run`) |
| `DeploymentQueueReconciliationService` | convert to a tag first, then `run` = the reconciliation loop |
| `DockerRuntimeActivityPersistenceService` | convert to a tag, `run` = the persistence loop |
| `DockerRuntimeEventsStreamService` | convert to a tag, `run` = subscribe + forward |
| `DomainVerificationService` | convert to a tag, `run` = the verification scheduler |
| `NodeAgentBootstrapService` | convert to a tag, `run` = the probe/retry loop |
| `NodeInventoryService` | convert to a tag, `run` = the inventory loop |
| `CodeProviderRegistryService` | registry: `onStart` populates, no loop |
| `BuilderRegistryService` | registry: `onStart` populates, no loop |
| `LocalDatabaseLifecycle` (`shared`, `apps/setup`) | stays a provider: it owns a `Scope` and the handle IS the value |
| `AuthModule` | module, not a service |

Order: the `same` rows first (a few lines each), then the `convert to a tag` rows, which are the same work as the
`to convert` list above — do them there, and give them `run` at the same time.
