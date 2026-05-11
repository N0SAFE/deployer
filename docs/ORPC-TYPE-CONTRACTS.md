# ORPC Type Contracts

## Docker contracts (domain-structured, entity-first)

### Added: 2026-04-02

Docker contracts in `packages/contracts/api/modules/docker` are organized by domain:

- `containers/`
- `images/`
- `networks/`
- `volumes/`
- `registries/`
- `stacks/`
- `runtime/`
- `security/`
- `index.ts` (router aggregator + re-exports)

### Contract design rule

For list-style contracts, schemas are derived from canonical top-level entity schemas in `@repo/contracts-entities` and reduced per use-case via schema derivation (for example `entitySchema.omit({ relations: true })`) rather than redefining ad-hoc contract-only entities.

### Router shape

`packages/contracts/api/modules/docker/index.ts` is now a nested domain router (`containers`, `images`, `networks`, `volumes`, `registries`, `stacks`, `runtime`) with entity-first subgroups for runtime actions, streams, filesystem, and terminal operations.

## Docker container realtime extensions

### Added: 2026-04-03

`containers.ts` now exposes container detail runtime contracts for modal-level tooling:

- Realtime logs: `streamContainerLogs`
- Process list + realtime updates: `listContainerProcesses`, `streamContainerProcesses`
- Process-scoped logs stream: `streamContainerProcessLogs`
- Filesystem operations: `listContainerFiles`, `readContainerFile`, `writeContainerFile`, `deleteContainerPath`, `renameContainerPath`, `createContainerDirectory`
- Bidirectional terminal session APIs: `openContainerTerminalSession`, `streamContainerTerminalSession`, `sendContainerTerminalInput`, `closeContainerTerminalSession`

These contracts are added via the domain router in `modules/docker/index.ts` and keep the same entity-first approach by reusing canonical schemas from `@repo/contracts-entities` (`dockerContainerLogEntrySchema`, `dockerContainerProcessEntrySchema`, `dockerFileEntrySchema`, `dockerTerminalProfileSchema`).

## Docker container lifecycle mutation contract

### Added: 2026-04-05

`containers.ts` now exposes `runContainerAction` (`POST /docker/containers/runtime/action`) for real operator lifecycle actions:

- `start`
- `stop`
- `restart`
- `pause`
- `unpause`
- `kill`
- `remove`

The contract is wired through `modules/docker/index.ts` and intended for page/modal quick-actions so the web UI executes real runtime mutations instead of queue/simulation placeholders.

## Docker managed vs orphan ownership filters

### Added: 2026-04-06

`containers.ts` list contracts now expose ownership-aware filtering and fields on docker container entities:

- `managedBy` (`deployment_service` | `orphan`)
- `managedDeploymentId`
- `managedServiceId`
- `managedProjectId`

This supports runtime inventory segmentation between deployment/service-managed containers and normal unmanaged/orphan containers while preserving backward compatibility on existing list endpoints (`/docker/containers`, `/docker/containers/linked`).

## Docker server-side grouped container inventory

### Added: 2026-04-06

`containers.ts` now exposes `listContainersGrouped` (`GET /docker/containers/grouped`) so the API handles runtime dedup/grouping semantics:

- shared-socket mirrored duplicates are deduped by real `container.id`
- only true deployment replicas are returned as grouped multi-instance entries
- non-replica/orphan containers remain single-container entries
- diagnostics include shared-daemon detection across mesh nodes (`hasSharedDaemonAcrossNodes`, `sharedDaemonGroups[]`)

The response is a discriminated union list:

- `kind: "single"` with a single `container`
- `kind: "replica_group"` with `containers[]`

This keeps the existing `listContainers` endpoint backward-compatible for other consumers while allowing container inventory UIs to render server-normalized grouping logic.

## Docker image security scan stream contract

### Added: 2026-04-08

The Docker contracts now expose image scan streaming as a domain-first contract key
`docker.images.security.scanning.stream` (`GET /docker/images/security/scanning/stream`) so the UI can follow an active scan in real time.

The stream emits canonical entity events (`dockerImageSecurityScanEventSchema`) with:

- lifecycle stages (`queued`, `pulling-scanner`, `scanning`, `parsing`, `merging`, `completed`, `error`)
- live scanner log lines (`type: "log"`) for Trivy, Grype, and Dive
- per-scanner result snapshots (`scannerResult`) and final merged payload (`scanSummary`, `vulnerabilities`)

This contract is defined in `modules/docker/security/scanning/images/stream.ts`, registered under the nested Docker router in `modules/docker/index.ts`, and consumed by web hooks for live security panels.

### Updated: 2026-04-16

The stream query now supports cache-aware execution controls:

- `forceScan?: boolean` — bypass persisted DB cache and execute scanners immediately.
- `maxCacheAgeMs?: number` — maximum accepted cache age (based on DB `lastUpdated`/`scannedAt`) before re-running scanners.

This enables UI and automation flows to avoid re-running expensive scans on every subscription while keeping a deterministic way to force refresh.

## Service contracts (domain-structured, entity-first)

### Added: 2026-04-08

`packages/contracts/api/modules/service/index.ts` now exposes a nested service router with explicit domain groups:

- `service.crud.{list,findById,create,update,delete}`
- `service.lifecycle.toggleActive`
- `service.dependencies.{list,add,remove}`
- `service.streams.query`

This migration keeps existing contract operation files (`list.ts`, `crud.ts`, `stream.ts`) while normalizing consumer access to domain-structured keys in both API controller bindings and web domain endpoints/hooks.

## Contract router architecture normalization

### Added: 2026-04-15

All ORPC module router prefixes are now owned by dedicated `index.ts` router files (no `.prefix(...)` outside `index.ts`), and root composition was simplified to consume module contracts directly.

Key updates:

- `packages/contracts/api/index.ts`
	- `core` and `organization` routing moved from inline composition to dedicated module contracts.
- `packages/contracts/api/modules/core/index.ts`
	- New `coreContract` (`/core`) composes mesh/fleet contracts.
- `packages/contracts/api/modules/organization/index.ts`
	- New `organizationContract` (`/organization`) composes `organizationAdminContract`.
- `packages/contracts/api/modules/organization/admin/index.ts`
	- New admin router (`/admin`) for organization admin endpoints.

Collision fixes completed as part of this normalization:

- `organization.admin.listMembers` now uses `/members` to avoid collision with `listAll`.
- `deployment.streamsList` moved to `/streams`.
- `deployment.streamFindById` moved to `/streams/{id}`.

Validation status:

- Full app contract metadata scan reports `duplicates=0` across method/path pairs.
- `@repo/api-contracts` type-check passes.
- Focused API tests for impacted modules pass (`docker`, `organization`, `deployment`).
