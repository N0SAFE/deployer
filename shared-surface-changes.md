# Surface changes in apps/api/shared (per commit)

Consumers on other branches (runtime, setup, bff) were migrated against the class-based surface. This lists what a consumer must change.
Pattern: a shared `X` is now a `Context.Service` tag; methods return `Effect` with tagged failures; stateless ones are `X.live` (serviceOver), so
each method's `R` names the ports (the container must provide them; `CoreDomainModule` exports them).

## Commit: deployment core (81585ea6, 212ab009)
- `PreviewNamingService`, `PreviewCleanupPolicyService`, `DeploymentProviderBuilderRunnerStateMachineService`: tags with `static live` (pure, SYNC shapes: `PreviewCleanupPolicyShape`, `DeploymentStateMachineShape`; `PreviewNamingShape.buildPreviewName` returns `Effect<_, PreviewNamingInvalid>`).
  Consumers: type with the `...Shape`, inject with `@Inject(Tag)`, specs use `Tag.live` instead of `new X()`.
- `TraefikConfigRefresher` (7480ab58): tag over `TraefikConfigRefresherShape { refresh(): void }`, built by `makeTraefikConfigRefresher(orchestrator)`.

## Commit: domain
- `DomainAlreadyExistsError`, `ProjectDomain*Error`, `ServiceDomainMapping*Error`, `Subdomain*Error`, `Invalid*FormatError`, `SetPrimaryDomainError`, `ServiceMappingMismatchError`, `VerificationAttemptError`, `DomainNotVerifiedError`:
  now `domainError(...)` classes taking a FIELDS OBJECT (`new ProjectDomainNotFoundError({ identifier })`), no longer `extends Error`/`DomainError`; `instanceof` still works; message = `publicMessage()`.
  Removed (unused): `DomainError`, `DomainVerificationError`, `DnsLookupError`, `VerificationTokenMismatchError`, `VerificationRecordNotFoundError`, `ProjectDomainAlreadyExistsError`.
  Added: `DomainStorageFailure` (dependency_missing, DB), `DomainRoutingFailure` (dependency_missing, Traefik side).
- `ProjectDomainRepository`, `ServiceDomainMappingRepository`, `ServiceDomainMappingService`, `DomainConflictService`, `DomainRoutingService`: tags (`.live`); every method returns `Effect<_, DomainStorageFailure|DomainRoutingFailure, DomainDatabase|...>`.
  Consumers: `yield* ProjectDomainRepository` instead of a local port over the class; drop `attempt(() => repo.x())`; project uses `refuse(effect)`. Runtime (async bodies): `host.run(domainRoutingService.syncServiceRoutes(...))`.
  `DomainRoutingService.buildVariableMap` now returns an Effect. `DomainConflictService.validateSubdomain/validateBasePath` are plain exported functions, not on the service.
- `DomainVerificationService`: stateful, `makeDomainVerificationService(projectDomainRepoShape)`; lifecycle `run` = hourly sweep (`serviceLifecycle`), no more `OnModuleInit/Destroy`/setInterval; methods return Effects with `ProjectDomainNotFoundError | VerificationAttemptError | DomainStorageFailure`.
- New ports (exported by `CoreDomainModule`): `DomainDatabase`, `RoutingTraefikRepository`, `RoutingTraefikSync`, `RoutingTraefikCertificates`, `RoutingTraefikVariables`.
- Fleet ports `DomainRouting`: typed from `DomainRoutingServiceShape`. Project: ports `ProjectDomainRepo`, `ServiceDomainMappingRepo`, `ServiceDomainMappingLookup`, `DomainConflict`, `DomainVerification` deleted in favour of the shared tags.

## Commit: traefik (live chain) + storage port
- `database/storage.ts` (new): `DatabasePort` tag (provided + exported by `DatabaseModule`), `StorageFailure` (dependency_missing), `storage(database, run)`. Replaces the domain-local `DomainDatabase` / `DomainStorageFailure` / `domain.ports.ts` (deleted; the `Routing*` ports are gone, domain routing now takes the migrated traefik tags directly).
- `TraefikRepository`: tag over `TraefikRepositoryShape` (70+ methods, all `Effect<_, StorageFailure>`, R-free); built by `makeTraefikRepository({ database })` in `TraefikCoreModule` (`useFactory`, inject `DatabasePort`). Consumers: `yield* TraefikRepository`; Promise callers outside effects use `runPromiseUnwrapped` / `host.run`.
- `TraefikFileSystemService` REDUCED to paths/naming/checksum (pure, sync): `getFileSystemPaths`, `generateServiceConfigPath`, `generateServiceConfigFileName`, `calculateChecksum`, `setBasePaths` (e2e harness only). The DB-backed "virtual filesystem" (virtual tree, download, backup, write/delete virtual files, list projects ...) was removed: nothing called it.
- `TraefikSyncService`: only `syncServiceConfiguration(configId): Effect<SyncResult, StorageFailure>` (write failure => `success:false` result). `syncAll`, `syncProject`, `syncStandalone`, `cleanupOrphaned*`, `deleteConfigurationFile`, `initialize`, `generateTraefikConfiguration` (now an exported pure function) removed from the service: nothing called them.
- `TraefikService`: only `createServiceConfiguration`, `syncServiceConfiguration` (adds `ConfigNotFoundError`), `validateConfiguration`, `getHealthStatus`, `addSSLCertificate`, all Effects. ~34 unused facade methods removed. Runtime: `RunnerTraefikPort` deleted, the runner yields `TraefikService`.
- `ConfigNotFoundError` is now a `domainError` taking `{ configId, configType? }`; new `ConfigFileWriteFailure`.
- `TraefikVariableResolverService`: tag with `static live` (pure, sync shape `TraefikVariableResolverShape`).
- `TraefikIngressConfigService` (still a class, ledgered): injects `TraefikRepository` as the shape and runs it with `runPromiseUnwrapped` until it is migrated with platform-ingress.
- NOT migrated yet (ledger): traefik-ingress-config.service (+controller), template service/repository, validation, middleware-library, event service — the last five are dead code; the parent session decided: migrate last, delete only if the user says so.
