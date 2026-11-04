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

## Commits: traefik (a9827042, then the full restore) + storage port
User decision M: nothing is pruned; every traefik class is migrated. (a9827042 had pruned the unused surface; it is restored here.)
- `database/storage.ts` (new): `DatabasePort` tag (provided + exported by `DatabaseModule`), `StorageFailure` (dependency_missing), `storage(database, run)`. Replaces the domain-local `DomainDatabase` / `DomainStorageFailure` / `domain.ports.ts` (deleted; the `Routing*` ports are gone, domain routing takes the traefik tags directly).
- `TraefikRepository`: tag over `TraefikRepositoryShape` (70+ methods, all `Effect<_, StorageFailure>`, R-free); built by `makeTraefikRepository({ database })` in `TraefikCoreModule` (`useFactory`, inject `DatabasePort`).
- `TraefikFileSystemService`: `makeTraefikFileSystem(env, repository)`. Pure conventions stay synchronous (paths, names, parse, checksum, `setBasePaths` for the e2e harness); the database-backed virtual filesystem is Effect: `getTraefikFileSystem`, `getProjectFileSystem`, `getFileContent` (`StorageFailure | TraefikFileNotFound`), `downloadFile`, `listProjects`, `writeFile/deleteFile/backupFile` (report `success:false`), `getAllConfigFiles`, `getProjectConfigFiles`, `fileExists`, `calculateFileChecksum`. Old `FileReadError/DirectoryError/FileNotFoundError/FileWriteError` are replaced here by `TraefikFileNotFound`, `TraefikFileWriteRefused` (the old classes stay exported for now, unused).
- `TraefikSyncService`: `makeTraefikSync({ repository, fileSystem })`, all methods kept as Effects: `syncAllConfigurations`, `syncTraefikConfigData`, `syncTraefikConfigurationById`, `syncServiceConfiguration`, `syncProjectConfigurations`, `syncStandaloneConfigurations`, `deleteConfigurationFile`, `cleanupOrphanedFiles(ForProject)` (fail with `ConfigSyncFailure`), `initialize`. `generateTraefikConfiguration` is an exported pure function. **Behaviour fix**: the two cleanups compared the 8-char id prefix of a file name to full config ids with `Set.has`, so every file looked orphaned and was deleted; they now match by prefix.
- `TraefikService`: `makeTraefikService({ repository, fileSystem, sync })`, every facade method kept, all Effects (`StorageFailure | ConfigNotFoundError | ConfigSyncFailure`); `TraefikServiceShape = ReturnType<typeof makeTraefikService>`. `forceSyncAll`, `deployServiceConfiguration`, `removeServiceConfiguration`, `verifySwarmServiceRoute` included. Runtime: `RunnerTraefikPort` deleted, the runner yields `TraefikService`; the e2e spec runs the Effects.
- `ConfigNotFoundError` is now a `domainError` taking `{ configId, configType? }`; new `ConfigFileWriteFailure`, `ConfigSyncFailure`.
- `TraefikVariableResolverService`: tag with `static live` (pure, sync shape `TraefikVariableResolverShape`).
- `TraefikIngressConfigService` (still a class, ledgered): injects `TraefikRepository` as the shape and runs it with `runPromiseUnwrapped` until it is migrated with platform-ingress.
- `TraefikTemplateRepository` / `TraefikTemplateService`: factories (`makeTraefikTemplateRepository({ database })`, `makeTraefikTemplateService(repo)`), Effects with `StorageFailure | TraefikTemplateNotFound | TraefikTemplateCreateFailure | TraefikTemplateVariablesMissing`; the pure helpers (`parseTemplate`, `extractVariables`, `validateVariables`, `buildVariablesMetadata`) are exported functions. **Bug fix**: `extractVariables` used a regex with doubled backslashes and never matched a real placeholder.
- `TraefikValidationService`: tag with `static live = { validateConfig }` (pure, sync; the unused `TraefikVariableResolverService` constructor dependency is gone, logging dropped).
- `TraefikMiddlewareLibraryService`: tag with `static live`; every builder (`getRateLimiter`, `getCors`, ..., `getApiChain`) now returns `Effect<MiddlewareConfig | MiddlewareChain, MiddlewareFailure>` (`MiddlewareOptionsInvalid | MiddlewareConfigurationInvalid`) instead of throwing `MiddlewareError` / `MiddlewareConfigurationError`.
- STILL ledgered in traefik: `TraefikEventService` (extends `BasePooledEventService`, which is in the events leaf: migrate it with `events`), `TraefikIngressConfigService` + controller (migrate with platform-ingress/edge).
