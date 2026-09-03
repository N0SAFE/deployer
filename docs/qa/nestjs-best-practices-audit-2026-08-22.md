# NestJS Best-Practices Audit & Refactor — 2026-08-22 (recheck 2026-08-24)

Full audit of `apps/api` and the NestJS-related packages (`packages/nest/events`,
`packages/nest/lifecycle`, `packages/utils/errors`, `packages/utils/logger`)
against the `nestjs-best-practices` skill (40 rules, 10 categories).

**Adaptation rule applied throughout:** rules that assume a different stack were
re-expressed with this repo's patterns — Drizzle instead of TypeORM/Prisma
(`db-*`), ORPC contracts + Zod entities instead of class DTOs/pipes
(`api-use-dto-serialization`, `security-validate-all-input`), Traefik-edge rate
limiting instead of `@nestjs/throttler` (`security-rate-limiting`).

> **2026-08-24 recheck:** all violation sweeps re-run after inter-session edits.
> Zero regressions found. Current state: **0 type errors in `apps/api/src`
> production code** (202 total — remainder in specs/e2e and the 7 pre-existing
> `packages/utils/auth` variance errors), **1191 tests passing**. Verified:
> repository layering (0 controllers/services hold a DB handle), 0 production
> bare throws, 0 property injection, 0 circular deps (`forwardRef`), 0 empty
> catch blocks, 0 timers without cleanup, console usage only in doc comments,
> Zod-only shape validation on `unknown` payloads (scalar coercions exempt).

---

## Summary

| Area | Verdict |
|------|---------|
| Architecture (feature modules, events, repository pattern) | ✅ Compliant after refactor |
| Dependency injection (constructor injection, class tokens) | ✅ Compliant after refactor |
| Error handling (AppError → ORPC errors → global filter) | ✅ Already compliant |
| Security (guards, Zod validation at boundaries) | ✅ Already compliant |
| Performance (SSE pooling, TTL caches, timers cleaned up) | ✅ Already compliant |
| Testing (Vitest, testing module, repository mocks) | ✅ Compliant after fixes |
| Database (Drizzle transactions, migrations, no N+1 hotspots found) | ✅ Compliant |
| API design (ORPC contracts as SSOT) | ✅ Already compliant |
| DevOps (EnvService Zod config, AppLogger, graceful shutdown) | ✅ Already compliant |

Baseline before session: **211 type errors**, **845 unit tests passing**.
After: **211 type errors** (same — all fixed items type-check; remaining errors are pre-existing),
**1187 tests passing** (+342; the rest of the delta is newly-unblocked suites).
Remaining failures are pre-existing WIP spec gaps (old input shapes, missing test-module providers, e2e needing Docker).

---

## Fixed in this change set

### CRITICAL — DI / Architecture

1. **Service-locator removed (`di-avoid-service-locator`)**
   - Deleted module-level singleton `runtimeConfigurationAccessor.ts`; replaced by
     injectable `RuntimeConfigurationAccessorService`
     (`apps/api/src/core/modules/configuration/services/runtime-configuration-accessor.service.ts`),
     provided/exported via `ConfigurationCoreModule`.
   - Migrated consumers to constructor injection: `deployment.service`,
     `project.service`, `service.service` (+ their specs).

2. **Repository layering enforced (`arch-use-repository-pattern`,
   `arch-single-responsibility`) — zero controllers/services touch `db` directly now**
   - `GitHubAppsController` (12 direct DB ops) → extracted into existing
     `GithubAppsRepository` (`list`, `findById`, `findProviderApps`, `create`,
     `updateById`, `deleteById`, `setInstallationByName`,
     `findClientIdById`, `findClientCredentialsById`). Controller keeps only
     orchestration/mapping.
   - `GitlabAppsController` (3 direct DB ops) → new
     `apps/api/src/modules/providers/code/gitlab/repositories/gitlab-apps.repository.ts`.
   - `CloudflareAppService` (6 direct DB ops incl. tunnel-owner guard) → new
     `apps/api/src/modules/providers/dns/shared/repositories/dns-providers.repository.ts`.
   - `ReachabilityService` (4 direct DB ops) → new core
     `apps/api/src/core/modules/reachability/repositories/node-network-config.repository.ts`
     (incl. `findTunnelProviderById` so core stays boundary-clean without
     importing product modules).
   - `ProjectAccessService` (2 direct DB ops) → new core
     `apps/api/src/core/modules/project/repositories/project-access.repository.ts`.
   - Outbox access centralized → new
     `apps/api/src/core/modules/events/outbox/local-event-outbox.repository.ts`;
     refactored `LocalEventOutboxDispatcherService` and
     `DeploymentReadModelProjectorService` onto it. Specs rewritten against the
     repository mock (`test-mock-external-services`). Behavior preserved:
     invalid envelopes dead-letter immediately (never retried); dispatch
     failures use exponential-backoff retries then dead-letter.

### HIGH — Type safety / data boundaries

3. **Removed data-boundary `as unknown as` casts** (replaced with Zod parse or
   truthful types):
   - `mesh-initialization.service.issueRemoteJoinGrant` → parses through
     `meshJoinGrantIssueResultSchema`.
   - `docker.repository.inspectImageWithCandidates` → returns typed
     `DockerodeImageInspect`; `buildImageInspectCandidatesFromImageList` takes
     `DockerodeImageSummary[]`; network/volume lists typed via
     `DockerodeNetworkSummary`/`DockerodeVolumeEntry`.
   - `github-account.controller` update/insert values → typed as
     `$inferInsert` partials (no cast).
   - `gateway.module` requestId → shared `getInternalErrorRequestContext`
     helper (widened to `IncomingMessage`).
   - `organization.middleware-definition` owner check → record-guard fast path,
     no cast.
   - `auth.guard` headers cast kept but documented (Bun header override vs
     Better Auth types genuinely don't overlap).
   - Framework-level generic-transformer casts (fluent builders, mesh envelope
     widening, bridge DI tokens) audited and accepted — each is a documented
     same-trust-level widening, not a data-boundary lie.
   - `deployment_logs.metadata` Drizzle column widened (SSOT fix) with
     `correlationId/traceId/spanId`; cast removed from `deployment.repository`.

### MEDIUM

4. **Zod import hygiene (test-runtime crash fix)** — `import { z } from "zod"`
   / `"zod/v4"` named imports resolve to `undefined` under Vitest ESM interop;
   default import works everywhere. Converted all source files on the API path
   (`apps/api/src`, `packages/contracts/api`, `packages/utils/orpc`,
   `packages/nest/*`) to canonical `import z from "zod/v4"`. This unblocked
   ~340 previously-failing/skipped tests.

5. **Logging hygiene** — `database.service` health-check `console.warn` → NestJS
   `Logger`. Remaining `console.*` verified intentional (CLI stdout JSON,
   logger browser fallback, e2e utilities).

---

## Verified compliant (no action needed)

- `arch-feature-modules` / "screaming architecture": modules organized by domain
  (`modules/docker/domains/...`, `core/modules/mesh/...`).
- `arch-avoid-circular-deps`: no `forwardRef()` usage found.
- `arch-module-sharing`: no duplicate providers detected; `CoreModule` re-export
  pattern (providers-not-imports) is intentional and documented.
- `arch-use-events`: rich event system (`@repo/nest-events` pooled streams +
  transactional outbox); fire-and-forget audit found every `void` promise has
  `.catch` or internal try/catch (docker auto-scan listener, webhook preview
  provisioning, mesh heartbeat persist, deployment external probe, queue
  replication).
- `di-prefer-constructor-injection`: zero property injection (`@Inject` on
  fields) found. Class tokens used everywhere except documented exceptions
  (`APP_GUARD`-style built-ins, dynamic providers).
- `error-*`: 3-tier pipeline (AppError hierarchy in `@repo/errors` → ORPC error
  contracts with `.errors(...)` → `InternalErrorExceptionFilter` with
  request-id correlation). Empty catches audited — all log or have a documented
  reason.
- `perf-*`: interval/timer services implement `OnModuleDestroy` and `unref()`;
  SSE stream pooling via `CoreEventStreamPoolService`; TTL caches for entity
  lists and Cloudflare state.
- `micro-use-health-checks`: `/health` endpoint + DB probe via
  `HealthRepository`.
- `micro-use-queues`: BullMQ integration for deployments + in-memory queue
  lifecycle with dead-letter semantics.
- `devops-graceful-shutdown`: lifecycle hooks clean up subscriptions, timers,
  scanner containers, mesh sync intervals.

---

## Recommendations (flagged, not silently changed)

1. **Cross-feature coupling**: `service-network.service` imports
   `ProjectRepository` from `modules/project`. Per repo boundary rules product
   modules should not reach into sibling modules' repositories — extract a
   project-network reader into `core/modules/domain` (or expose via an ORPC
   internal contract). Structural change → needs a decision.
2. **WIP spec gaps (pre-existing)**: several specs construct inputs with the old
   trigger shape (`input.sourceType` instead of `input.source.sourceType`) and
   miss newer constructor deps (`ProjectNetworkService`). These specs need a
   refresh pass aligned to current contracts.
3. **`GlobalDatabaseService extends BaseDatabaseService` variance error** and
   `@octokit/core` type resolution are pre-existing; both are one-line type-level
   follow-ups isolated from runtime behavior.
