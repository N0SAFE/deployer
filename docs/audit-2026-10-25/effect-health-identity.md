# Effect-TS rewrite audit: HEALTH (done) and IDENTITY (in flight)

Snapshot taken 2026-10-26 ~14:50 CET on branch `rewrite-v3`, working tree dirty. Read-only review: nothing was run. Test and type-check facts come from `.turbo/*.log` files (dated below) and from reading source. All paths relative to `/home/sebille/Bureau/projects/tests/deployer/v3`.

Sources compared:
- Previous Nest svc-health: `git show HEAD:apps/api-services/services/health/src/modules/health/controllers/health.controller.ts` (thin controller over the shared `HealthRegistry`).
- Old monolith health: `apps/api/src/modules/health/*` (Terminus, readiness service, supervisors).
- Previous Nest identity: `git show HEAD:apps/api-services/services/identity/...`.
- Reference: `samples/api-sample` and `packages/nest/effect` (new, untracked).

Terms: "HEAD svc" = svc-health as committed; "monolith" = `apps/api`.

Important context for reading verdicts: at HEAD the svc-health service was already a thin controller over `@deployer/shared/server` (`HealthRegistry`, indicators, `ServiceHealthModule`, SSE controller). The Effect rewrite therefore only touched the two oRPC procedures and added a service adapter plus tests. Everything else (probes, registry, indicators, SSE) is unchanged shared Nest/RxJS code that every service uses. The meaningful comparison for "regressed" is mostly against the monolith.

---

## 1. Health parity matrix

Verdict legend: parity / improved / regressed / missing. "vs HEAD svc" and "vs monolith" are given separately where they differ.

| # | Feature | New implementation (evidence) | vs HEAD svc | vs monolith | Notes |
|---|---|---|---|---|---|
| 1 | Liveness `GET /health` | `shared/src/server/service-health.ts` (`ServiceHealthController`, `@AllowAnonymous`, `{status, uptime: process.uptime()}`) | parity (unchanged file) | parity, minus lifecycle phase | Uptime here is correct (seconds). Monolith `getHealth()` also returned `lifecycle {phase, step, message}`; svc has no equivalent. Not Effect. |
| 2 | Readiness `GET /health/ready` | same file; reads `SERVICE_READINESS` bound by `PreflightModule`; 200/503; no I/O per request | parity | improved | Compose healthcheck targets it (`infra/docker/compose/common/api/docker-compose.config.services.yml:234`, retries 40 x 15 s). Not Effect. |
| 3 | oRPC `check` | `services/health/.../health.controller.ts` `.effect()`; forces `registry.runOnce()`, returns `status ok/degraded`, `timestamp = snapshot.checkedAt`, `service`, `indicators[]` | improved (timestamp now the snapshot's own time; Effect error channel) | regressed | Monolith `check` was `@AllowAnonymous` + `rateLimit(300/min)` and returned lifecycle info. svc has neither rate limit nor an explicit anonymity opt-out (see N-5). |
| 4 | oRPC `detailed` | same controller; Terminus `info/error/details` passthrough + `indicators` | parity | regressed | Monolith: `requireAuth()`, real `supervisors`, swarm/services/mesh indicators, correct uptime. svc: no `requireAuth()` anywhere in the file, `supervisors: []`, wrong uptime. |
| 5 | Registry (parallel, per-check timeout, declaration order, cached `BehaviorSubject`) | `shared/src/server/health/health-registry.service.ts` | parity (file only had `interface` to `type` edits) | improved (monolith ran Terminus per probe, plus a state service) | 17 registry tests in `__tests__/health-registry.stream.test.ts`. Defects D-1 to D-3 below. |
| 6 | Check: database | `indicators/database.indicator.ts`; now injects `GLOBAL_DATABASE_POOL` (uncommitted fix; the old injection of the drizzle handle made `pool.query` fail) | improved (bug fixed in working tree) | improved (adds version, latency, error classification) | |
| 7 | Check: migrations | `indicators/migrations.indicator.ts` (journal count > 0, reports applied count and latest) | parity | missing in monolith, improved | Still the weak "count > 0" check the architecture audit flagged (ARCH-101: pending journal entries not detected). |
| 8 | Check: redis | `indicators/redis.indicator.ts` (raw PING over a socket, reads `process.env.DEPLOYER_REDIS_URL` directly) | parity | new | Reads env directly instead of `EnvService`. |
| 9 | Check: memory, disk | `indicators/memory.indicator.ts` (heap ratio, cgroup), `disk.indicator.ts` (statfs, 5% floor) | parity | new | Thresholds hardcoded (0.95, 0.05). |
| 10 | Check: swarm, services, mesh | not present in svc-health | n/a (never in HEAD svc) | missing | Monolith `readiness.indicators.ts` had `swarm`, `services` (supervised service health), `mesh`. This is roadmap `ARCH-038` (decide parity). |
| 11 | Caching | `/health/ready` reads preflight verdict (cached); oRPC procedures force a fresh pass by design (`health.controller.ts` doc comment, spec asserts `runOnce` called) | parity | parity | Cadence: 15 s chained `setTimeout`, hardcoded. |
| 12 | SSE `GET /health/stream` | `shared/.../health.module.ts` `HealthStreamController` | parity | missing in monolith | Defects D-2, D-3 (dead heartbeat, duplicate first emit). Not in any contract. No test of the controller. Not Effect. |
| 13 | Change events (`changes$`) | registry exposes `changes$`, `indicator$`; only the SSE controller subscribes | parity | regressed | Monolith `ReadinessService.reportVerdict` logged once per transition. Nothing logs or persists transitions now (roadmap `OBS-003` still open). |
| 14 | Supervisors info | `supervisors: []` literal at `health.controller.ts:77` | parity (still stubbed) | regressed | NOT FIXED. Design note in N-3: supervisors run in the BFF process, so svc-health cannot call `SupervisorOrchestratorService`; it needs a BFF-side join or a peer call. |
| 15 | Uptime | `uptime: process.uptime() / 1000` at `health.controller.ts:72` | parity (bug carried over) | regressed (monolith returned `process.uptime()`) | NOT FIXED. Contract says "Process uptime, in seconds". Reports 1000x too small. The new spec "reports uptime in seconds" only asserts `> 0`, which passes with the bug (N-1). |
| 16 | Graceful shutdown | `bootstrap.ts:106 enableShutdownHooks`; registry `onModuleDestroy` stops timer and completes subjects; `EffectRuntime.onApplicationShutdown` disposes the `ManagedRuntime` | improved (runtime disposal) | parity | Minor: `timeoutAfter` never clears its 5 s timers (leaks up to 5 timers per pass until they fire). |
| 17 | Config | none: 15 s refresh, 5 s per-check timeout, memory/disk/redis thresholds are constants; indicator set chosen per root module (`HealthModule.forRoot({indicators:"platform"})`) | parity | parity | No env knobs. Redis URL via raw `process.env`. |
| 18 | Logging | registry `logger.debug` per pass; boot line via `@deployer/logger`; `HealthCheckFailed.cause` is dropped when mapped to `FAILED_DEPENDENCY(error.message)` (controller) | parity | regressed (no transition logs) | The one domain error loses its `cause` at the boundary with no server-side log. |
| 19 | Contract coverage | `packages/contracts/health` (`@deployer/health-contracts`, new, untracked): `check`, `detailed` only. `check` output now includes `indicators[]` (optional) | improved (indicators in `check`; contract is its own package) | parity | Probes and SSE are plain Nest routes and are intentionally outside the contract. Compile-time test of the error union (`health.contract.spec.ts`). Monolith (`apps/api`) already imports the new package in the working tree (in flux). |
| 20 | BFF delegation | `bff/src/modules/delegation/generated/health.delegation.ts` forwards `check` and `detailed` via typed client; `bff/.../platform-health.service.ts` rolls up every service's `/health/ready` (3 s timeout) | parity | improved | Uncommitted BFF changes: `@AllowAnonymous()` on `PlatformHealthController` (fixes a 401 on the probe) and new `GET /health/platform/ready` 200/503 gate. No spec for the roll-up (ARCH-103). The generated header claims services enforce `requireAuth()` for procedures that need it, which is false for svc-health `detailed` (N-5). |
| 21 | Ingress / healthcheck wiring | Compose: `/health/ready` healthcheck per service (parity). Swarm tier: `services-tier-provisioner.service.ts:220 healthcheck: null`, so the image `HEALTHCHECK` applies, and `infra/docker/builder/api/Dockerfile.api.prod:380` still probes `localhost:3001/health` | parity | n/a | `ARCH-051` still open. Risk: swarm tasks listening on 3101+ would be judged against port 3001 (unverified, not run). |
| 22 | Tests | svc-health: 9 tests in 3 files (controller 6, service 2, contract type-test 1), green at 13:42 on 2026-10-26; type-check and lint green (13:42/13:43). Registry/indicator tests (shared) unchanged. | improved (HEAD: 1 controller spec) | parity | Missing: SSE controller test; module-wiring/e2e test proving `EffectRuntime` discovers `HealthService` and the registry alias (`src/e2e/runtime.ts` exists but no spec uses it); anonymous/authenticated access test; real uptime test. |

### Defects found in the shared health code that svc-health relies on (not new, still open)

- D-1: `HealthRegistry.requestRefresh()`, `pushRefreshRequests()` and `refreshStream()` have no callers anywhere, and nothing subscribes to `refreshRequests`. The "ask for a pass now" API is inert.
- D-2: `HealthStreamController.stream()` builds `heartbeats` (15 s) and never uses it (`health.module.ts:58` defined, `:67 return changes`). The comment promises a heartbeat so proxies do not close idle connections; none is sent.
- D-3: `stream()` emits the current snapshot twice on subscribe (once from `snapshots$`, then from the replayed `changes$`), and the `switchMap` tears down the `snapshots$` branch on the first change. Behaviour is right after that, but the code does not say what it does.

### Bugs previously reported, status

| Reported bug | Status | Evidence |
|---|---|---|
| svc-health `uptime` 1000x too small | NOT FIXED | `apps/api-services/services/health/src/modules/health/controllers/health.controller.ts:72`; the rewrite copied the expression into the `.effect()` handler. Roadmap `OBS-028` cites the old line 64 and remains accurate. |
| `supervisors: []` hardcoded | NOT FIXED | same file, line 77. `OBS-029` remains open. |

---

## 2. Health quality verdict (as a reference implementation)

Overall: good skeleton, not yet a faithful reference for the rest of the migration. It demonstrates the Effect/Nest wiring well and was copy-pasted with two known bugs intact, which is the strongest argument that it needs a stricter test bar before other services imitate it.

What it does well:
- Layering matches `samples/api-sample`: `Context.Service` key doubles as the Nest token, `@Injectable()` impl with no constructor injection, providers registered with `{ provide: Tag, useClass/useExisting }`, controller with no constructor and `.effect(function* ...)`.
- Error handling: one tagged domain error (`HealthCheckFailed`), mapped to the contract's declared `FAILED_DEPENDENCY` only at the controller boundary. A down indicator is correctly a report, not an error.
- Testability: pure fixtures (`testing/health.fixtures.ts`), service tests need no Nest, controller tests use `effectContext` + `callProcedure` from the shared helpers. 9 tests, type-check and lint clean.
- Registry stays Nest/RxJS and is aliased into Effect through a one-method port (`HealthRegistryShape.runOnce`), so the Effect layer is thin and replaceable.
- Per-service indicator selection (`HealthModule.forRoot({ indicators })`) and preflight/registry split are well documented.

Weaknesses a reader should not copy:
- Business-ish logic in the controller: `status === "up" ? "ok" : "degraded"` appears twice, the `service: "svc-health"` literal appears twice (and in fixtures), and `uptime` is computed in the transport. The documented rule "no logic in controllers" is broken, and that is exactly where the uptime bug lives. Move the mapping into `HealthService` (return a domain report), keep the controller a mapper.
- The Effect adoption is shallow: `HealthService.check()` is `Effect.tryPromise(runOnce)`. That is acceptable for a first service but it does not show typed multi-error flow, `Layer`s, config as a service, scoped resources, or tracing, all of which the identity/fleet services will need.
- `HealthRegistryRepository` is a misnomer (it is a registry adapter, not a repository).
- `HealthModule.forRoot({indicators:"platform"})` is imported twice (in `app.module.ts` and again in `health.module.ts`). It works only if Nest deduplicates the identical dynamic module by hash; a single import with a re-export would be unambiguous.
- No authorization example: neither procedure declares `requireAuth()`/`publicAccess()` (N-5). A reference should show the authz idiom, since SUB-A is the next big job.
- Error cause lost at the boundary: `error.message` only, no log, cause discarded.
- Test fixtures live under `src/modules/health/testing/`, while the sample's README states test doubles never live under `src/`.
- Formatting inconsistent (2-space files `effect-context.ts`, `health.service.ts` next to tab-indented siblings).
- The uptime test asserts `> 0`, which the bug satisfies. A reference's tests should fail on the known bug.
- No test boots the Nest module, so the one fragile piece (EffectRuntime discovering a `useExisting` alias, lazily built `ManagedRuntime` cached for the whole process) is untested.

---

## 3. Identity parity matrix (IN FLUX: the operator was editing `modules/user/*` while this was written)

In-flux markers seen during the review (do not treat as final): `modules/user/user.errors.ts` was renamed to `user.failures.ts` at 14:36 (the e2e spec already imports the new name); `user.service.ts`, `user.controller.ts`, repository files and `domain/*` were rewritten between 14:36 and 14:48; `domain/user.entity.ts` is deleted in the working tree; `packages/contracts/identity` and `packages/nest/effect` are untracked. Last green evidence: type-check 13:22 (141 files); last test run 2026-10-24 14:14 (64 tests, run against the OLD Nest user code), so no test evidence exists for the new user domain.

Surface inventory: contract `@deployer/identity-contracts` has 34 procedures: `user` (7), `analytics` (21), `push` (6). There is no permission, API-key, notification or setup procedure in identity (see "Not in identity" below).

| Area / procedure | Old Nest identity (HEAD) | New Effect state | Status | Evidence |
|---|---|---|---|---|
| user.list | Nest service, admin-only | Effect service + `.effect()` controller, `assertCanAdminister`, offset pagination, filter operators | done (in flux) | `modules/user/services/user.service.ts:41`, controller `list()` |
| user.count | Nest, admin-only | Effect, admin-only | done (in flux) | `user.service.ts:58` |
| user.findById | self-or-admin | Effect, self-or-admin, returns `User \| null` | done (in flux) | `user.service.ts:68` |
| user.checkEmail | public by design | Effect, no `requireAuth()` (intentional) | done (in flux) | controller `checkEmail()` |
| user.create | admin-only, role-assign rule | Effect; rules ported; controller does NOT pass `input.role` and the contract has no `role` field, so role at create is unreachable | done (in flux) | `user.controller.ts` create(), `contracts/identity/modules/user/create.ts` |
| user.update | self-service whitelist, audit-field guard, role rule | Effect, rules ported verbatim | done (in flux) | `user.service.ts:121` |
| user.delete | admin-only, not self | Effect | done (in flux) | `user.service.ts:188` |
| setBanned (service method, no procedure) | present | ported but unused by any controller | done, dead | `user.service.ts:164` |
| user domain rules | `domain/user.entity.ts` | split to `domain/user.rules.ts`, `user.types.ts`, `user.errors.ts` (pure) | done | new untracked files |
| user repository | Nest + Drizzle | Effect-returning `UserRepositoryImpl` with `DatabasePort` as Effect requirement; SQL filter builder split into `.sql.ts` | done (in flux) | `repositories/user.repository*.ts` |
| user tests | 0 unit specs; e2e with admin actor | e2e adapted to run Effects (`run(...)`); still 0 unit specs for rules/service/controller | not started | no `user.*.spec.ts`; roadmap `AUTH-045`, `ARCH-036` |
| analytics (21 procedures: metrics 6, usage 6, reporting 9) | Nest, `requireAuth()` only | unchanged Nest code (`@Injectable`, constructor DI, `.handler`), not Effect | not started | `modules/analytics/**` not in `git status` |
| analytics report download route | `downloadUrl=/analytics/reports/:id/content` served by nothing | still dangling | not started (bug persists) | `analytics.controller.ts:310`; no route in bff or identity (`ARCH-016`, `OBS-053`) |
| analytics tests | entity spec (25) + e2e (5) | unchanged | n/a | turbo-test.log 2026-10-24 |
| push (6 procedures) | Nest, `requireAuth()` only | unchanged Nest code | not started | `modules/push/**` not in `git status` |
| push `sendTestNotification` | fabricated delivery report | unchanged: `success = min(total, deliverable)`, nothing is sent | not started (bug persists) | `push.controller.ts` (`sendTestNotification`) |
| push VAPID keys | per-user keypair stored plaintext, subject `mailto:user-<id>@notifications.local` | unchanged | not started (bug persists) | `push.service.ts` `publicKey()`, `push.repository.ts:260` |
| push endpoint rebind | `onConflictDoUpdate` on endpoint sets `userId` | unchanged | not started (bug persists) | `push.repository.ts:163-172` |
| push tests | 21 unit tests (service constructed by hand) | unchanged | n/a | turbo-test.log |
| permission module (`PermissionService`, `PermissionRepository`, role rules engine) | in identity, no contract, no consumer, loader `catch(() => [])` | unchanged Nest; only `PermissionDomainModule` is imported by `app.module.ts` | not started | `permission.service.ts:35`; 13 specs |
| auth glue | `AuthModule.forRootAsync` + `createOrpcModule()` | kept; added `extraContext` that injects `EffectRuntime` and supplies `"effect/context"` per request | done | `app.module.ts` |
| Effect bootstrap | n/a | `EffectRuntimeModule`, `orpc/effect-context.ts` declares `EffectServices.identity = UserService \| UserRepository \| DatabasePort`; only user services are registered | done for user only | `orpc/effect-context.ts` |
| contracts package | monolith `@deployer/api-contracts` modules | `@deployer/identity-contracts` (own package) with same shapes | done | `packages/contracts/identity/` |
| duplicate stray copy `apps/api/services/identity/*` | tracked at HEAD | deleted in working tree | done | `git status` (`D apps/api/services/identity/...`) |

Not in identity (so not part of this rewrite, but part of the original ask):
- API keys: Better Auth `apiKey` plugin in `packages/auth`, served through the BFF auth routes. No identity procedure. Roadmap `AUTH-0xx` items on key transport are unaffected.
- Notifications: no module exists (roadmap `OBS-012`..`OBS-027` are NEW work, to be built in the Effect style).
- Setup-related: wizard lives in `apps/setup` and BFF `domains/setup`, not identity.
- Sessions, sign-in, passkeys, invites, admin set-role/ban: Better Auth in the BFF (`AUTH-006` is a Better Auth hook change, not an identity-service change).

Progress summary: 1 of 4 domains (user, 7 of 34 procedures) is converted; 3 (analytics, push, permission) are untouched Nest code living beside it in the same app, so the service currently runs two idioms.

---

## 4. Identity design observations

### 4.1 Previously reported issues: are they being addressed?

| Issue | In the new design? | Detail |
|---|---|---|
| "No role checks on any procedure" | Partly, user domain only | The user domain had actor-based rules already at HEAD (`assertCanAdminister`, `assertSelfOrAdmin`, ...). The rewrite keeps them and makes the actor an explicit parameter of every service method. Analytics (21), push (6) remain `requireAuth()` only. No `requirePlatformRole` anywhere in identity (0 uses). |
| Fake push report | No | `sendTestNotification` unchanged. Not touched by the rewrite. |
| VAPID plaintext keys / fake subject | No | `userVapidKeys` per-user, plaintext `privateKey`. |
| Analytics download route missing | No | `downloadUrl` still points to nothing. |
| User CRUD rules | Yes (kept) with new gaps | See 4.3. Rules are now pure functions in `domain/user.rules.ts`, composed as Effects. |
| Duplicated monolith/identity user code | Improved | the monolith user module remains (`AUTH-007`); the stray `apps/api/services/identity` copy is deleted. |

### 4.2 Where the Effect design helps SUB-A (policy-gated authz, `SEC-001`)

Easier:
- Services never see a session: the `Actor` is a plain value and the rules are pure and synchronous, so a privilege matrix test is trivial (this is the cheapest part of `AUTH-045`).
- Requirements are typed: every service method declares its `R` (`UserRepository | DatabasePort`). The same mechanism can encode authorization: add a `Policy`/`CurrentActor` service to `R` or return `Effect<..., Forbidden, Authorized<"user","delete">>`, so an unguarded handler fails to compile. That is the default-deny property SUB-A wants, and the Nest decorator approach cannot give it.
- Domain failures are values (`Data.TaggedError`) with a single mapping function to the contract's declared errors; a generated 403 matrix (`SEC-038`) can enumerate handlers from the contract and assert the mapping.
- `.effect()` handlers let a policy be applied once as an oRPC middleware that provides services, instead of repeating `assertX()` in each method.

Harder or risky:
- `EffectRuntime.context()` is a process-wide cached context (a `ManagedRuntime` built once from discovered providers). Per-request data (actor, request id, trace span) cannot live in it. Today the actor is threaded by hand (`actorOf(context)` in every controller handler, copied across files). A per-request context (e.g. `Context.add(CurrentActor, ...)` supplied by `createOrpcModule({ extraContext })`) must be added to the shared helper before policy can be a service.
- All user failures collapse to one `UserServiceFailure { cause: unknown }`, then the controller does `instanceof` checks on `cause` (`mapUserFailure`). This throws away the typed error channel that makes Effect valuable and is a bad template for authz (a forbidden/not-found/conflict distinction is now a runtime check, not a type). `samples/api-sample` uses one tagged error per failure and `Effect.catchTag`; the identity code deviates. Same for `rule(() => { assert... })`: synchronous throws wrapped by `Effect.try`.
- Authorization is not declarative: `requireAuth()` (oRPC middleware) and `assertCanAdminister` (service) are two unrelated mechanisms, and nothing relates a procedure to a required resource+action. The unused `PermissionEngine`/`role_rules` (permission module) is not on the path at all.
- Handlers read `context.auth.user.role ?? "user"` and the role vocabulary has `user` as a non-enum value (`AUTH-024`); `ADMIN_ROLES` is a string set, not tied to `PLATFORM_ROLES`.

### 4.3 Defects in the new user domain (judged as current state, may change)

- Admin acts on superAdmin: `assertCanAdminister` is the only check for `delete`, `update` (non-role fields, email) and `setBanned`. `assertRoleIsAssignable` guards only the NEW role. An `admin` can delete, ban, or change the email of a `superAdmin` account (email change then password reset is an account-takeover path once a mail transport exists). Same hierarchy gap that `AUTH-006` fixes in Better Auth, now reproduced in identity. Needs "may not act on a target whose role >= actor's unless superAdmin".
- `update` does not apply `assertNotSelfDestruct` for `banned`, so an admin can ban themselves through `update`; the guarded `setBanned` is not exposed.
- `create` cannot assign a role (contract and controller omit it) although the service supports it.
- Bans and role changes are raw DB writes: no session revocation, 5-minute cookie cache (`AUTH-013`).
- The service writes `user` rows directly, bypassing Better Auth hooks (no password/credential, no audit, no event).
- `user.findById` returns `null` for an admin asking about an unknown id and for self asking about self; fine, but `delete`/`update` return 404 in a different order than the documented "resolve then authorise" in the old doc comment: the new code authorises `assertSelfOrAdmin` after the existence lookup in `update` (ok) but before in `findById`.

### 4.4 Other observations

- Likely latent DI defect in the untouched push domain: `PushService` has no `@Injectable()` and imports `PushRepository` with `import type` (`push.service.ts:1-4, 68`); its unit tests construct it by hand, and no e2e exercises push. Under Nest this would inject nothing and every push call would fail on `this.subscriptions`. Not verified at runtime (nothing was run) but cheap to check. If true, push is not merely "fake delivery", it may not work at all.
- Analytics controller still has leftover `context;` no-op statements and an unused `actorOf`, i.e. the actor is resolved and ignored.
- `user.repository.ts` has both `DatabasePort` (Effect tag) and the drizzle handle; fine. The `.sql.ts`/`.types.ts` split follows no sample convention (the sample says one file per type); acceptable but be consistent.
- Two failure files in the user module (`user.failures.ts` for Effect failures; `domain/user.errors.ts` for rule error factories) share a confusing name pair.

### 4.5 What blocks completion, and tests

Blockers:
1. Per-request context in `@deployer/nest-effect` (actor/request id) and a standard authz idiom; without it every ported domain repeats `actorOf`.
2. A decision on the error model (single opaque failure vs tagged-per-failure). Settle before porting analytics/push, or three domains will each invent one.
3. Decisions already open in the roadmap that gate the real work in push/analytics: `DEC-OBS-1` (VAPID identity), `DEC-OBS-6` (PDF/CSV), report window (`OBS-055`), host metrics source (`OBS-044`, `DEC-OBS-3`).
4. `analytics.service.ts` is 934 lines with `systeminformation` and direct Drizzle: it needs splitting (repositories as Effect services, host-metrics adapter) before an honest port.
5. Cross-service callers: the BFF `service-auth-context` and identity clients are also modified in the working tree (in flux); the e2e harness requires a shared-runtime root module.

Tests present: analytics entity spec (25), push service spec (21), permission service spec (13), one e2e file (5) covering user CRUD, user pagination, analytics metric series, realtime, report generation (all with an admin actor, no negative cases). Missing: any unit test of the new user service/rules/controller; any 403 test; any push e2e; any test of `effect/context` wiring in identity.

---

## 5. Roadmap items affected

Effect legend: DONE = completed by current work; PARTIAL = progress with remaining work; OBSOLETE / RE-SCOPED = the item's text no longer fits; NEW-NEED = new requirement created by the rewrites; STILL OPEN = unchanged, confirmed.

| ID | Effect | Evidence |
|---|---|---|
| OBS-028 (fix svc-health uptime) | STILL OPEN, re-scope: line moved from `:64` to `:72`, fix must also add a test that fails on the bug | `health.controller.ts:72`; spec asserts only `> 0` (`health.controller.spec.ts`) |
| OBS-029 (supervisors) | STILL OPEN, RE-SCOPED: svc-health cannot reach `SupervisorOrchestratorService` (BFF process); decide join location or drop the field | `health.controller.ts:77`; `architecture.md` BFF hosts supervisors |
| OBS-003 (`changes$` subscribers) | STILL OPEN | only `HealthStreamController` subscribes; rewrite did not add a subscriber |
| OBS-052 / OBS-083 (scope `detailed`, analytics; 403 tests) | STILL OPEN, partly easier | no `requireAuth()`/role in svc-health; analytics 21 x `requireAuth()` only; Effect design helps (4.2) |
| OBS-006 / OBS-008 / OBS-009 / OBS-010 (push) | STILL OPEN, untouched | `push.controller.ts`, `push.service.ts`, `push.repository.ts:163` |
| OBS-053 / ARCH-016 (report download) | STILL OPEN | `analytics.controller.ts:310` dangling URL; no route in BFF/identity |
| OBS-011 (retire duplicated monolith/identity analytics, push, health) | PARTIAL: health contract now shared via `@deployer/health-contracts`; user/push/analytics copies still exist in both backends | `apps/api/src/modules/health` now imports the shared contract (uncommitted) |
| OBS-037 (platform health page for `detailed`) | RE-SCOPED: richer `check` now carries `indicators`; BFF `platform/ready` gate added (uncommitted) | `check.ts` contract; `platform-health.controller.ts` diff |
| OBS-080 (push integration tests) | STILL OPEN, plus NEW-NEED: DI smoke test for `PushService` | 4.4 |
| OBS-086 (uptime regression test) | STILL OPEN | see OBS-028 |
| AUTH-006 (role hierarchy) | STILL OPEN and NEW-NEED: identity user domain needs the same hierarchy rule | 4.3 |
| AUTH-007 (monolith user CRUD) | STILL OPEN (monolith user module not removed); note the identity rules are the intended replacement | `apps/api` unchanged for user |
| AUTH-013 (revoke sessions on ban/role) | STILL OPEN; identity `setBanned` is a raw DB write | `user.service.ts:164` |
| AUTH-024 (role `user`) | STILL OPEN | `actorOf` defaults to `"user"`; `userSchema.role` enum |
| AUTH-025 / SEC-033 / AUTH-026 (PermissionService, engine, `role_rules`) | STILL OPEN; permission domain is the next natural Effect port (becomes the policy service) | `permission.service.ts:35` swallows errors |
| AUTH-045 (unit specs for `userRules`) | STILL OPEN, now more urgent and cheaper: rules are pure and extracted in `domain/user.rules.ts` | no `user.*.spec.ts` |
| ARCH-036 (port missing unit specs: identity user 0, analytics, push, health.module.spec) | PARTIAL: health now has 3 spec files; identity user still 0 | file listings |
| ARCH-038 (health module parity decision) | STILL OPEN: svc-health lacks swarm/services/mesh/supervisors/lifecycle, monolith has them | 1 table rows 10, 14 |
| ARCH-051 (image HEALTHCHECK hard-wired to 3001) | STILL OPEN, matters more: swarm tier provisions `healthcheck: null` | `Dockerfile.api.prod:380`, `services-tier-provisioner.service.ts:220` |
| ARCH-083 (dead HealthClient and module-load `new HealthClient(...)`) | STILL OPEN | `bff/src/clients/health/health.client.ts:23` |
| ARCH-103 (specs for `PlatformHealthService`) | STILL OPEN | no spec in `bff/src/modules/health` |
| ARCH-104 (e2e for project and health services) | STILL OPEN | health e2e runtime exists, no spec |
| ARCH-018 / ARCH-031 (extract e2e harness, remove `apps/api`) | not affected, but note health e2e relies on the harness | `e2e/runtime.ts` |
| ARCH-062 / ARCH-065 / ARCH-109 (event consumers, SLO, aggregated health) | not started; Effect gives a natural place (a `Layer` that subscribes to `changes$`) | n/a |
| SEC-001 (SUB-A), SEC-038 (generated 403 matrix) | RE-SCOPED opportunity: build SUB-A on `.effect()` + a request-scoped `CurrentActor`/policy service, typed `R` for default-deny | 4.2 |
| SEC-011 (lock down anonymous/weak BFF/service surfaces) | PARTIAL/NEW-NEED: BFF `PlatformHealthController` now explicit `@AllowAnonymous()`; svc-health oRPC procedures have no explicit stance | BFF diff vs svc-health controller |
| OBS-043 / OBS-044 (identity host metrics) | STILL OPEN; to be addressed in the analytics port | `analytics.service.ts` `takeSnapshot()` |
| (none) | OBSOLETE items | none found: no roadmap item became obsolete because of these rewrites |

NEW items to add to the roadmap (proposed IDs are placeholders):

- ARCH-NEW-A (P1, S): request-scoped Effect context in `@deployer/nest-effect` (actor, request id), plus a shared `CurrentActor`/policy service. Unblocks SUB-A on Effect.
- ARCH-NEW-B (P1, S): decide and document the Effect error model for services (tagged-per-failure), and refactor `UserServiceFailure` accordingly before copying it.
- AUTH-NEW-C (P0, S): hierarchy rule in `userRules` (no acting on equal/higher role unless superAdmin) with matrix tests. Same as AUTH-006 for the identity side.
- OBS-NEW-D (P1, S): fix `HealthStreamController` heartbeat and duplicate first emit; remove or wire `requestRefresh/pushRefreshRequests/refreshStream` (D-1..D-3).
- OBS-NEW-E (P1, S): `svc-health` authz stance: explicit `requireAuth()`/`publicAccess()` per procedure, with rate limit on `check` (parity with monolith).
- OBS-NEW-F (P1, S): DI smoke test that boots each service's root module and resolves every provider (catches `PushService` missing `@Injectable()` class of bugs).

---

## 6. New findings

- N-1: The rewrite copied `uptime: process.uptime() / 1000` and `supervisors: []` unchanged into the new Effect handler, and the new test named "reports uptime in seconds" asserts `> 0`, which the bug satisfies. A test that passes for the wrong reason is worse than none here.
- N-2: Shared SSE controller dead heartbeat (D-2) and inert refresh API (D-1). Both documented as features in comments.
- N-3: Supervisors live in the BFF process (architecture audit), so the old monolith's `supervisors: await getHealthOfAll()` cannot simply be ported to svc-health; it implies either a BFF-side roll-up or giving svc-health a service token (`ARCH-056`) to call the BFF. This should be decided before anyone tries to "fix the stub".
- N-4: `HealthCheckFailed.cause` is dropped when mapped to `FAILED_DEPENDENCY(message)`: no log, no trace of why the registry failed.
- N-5: svc-health `check`/`detailed` have no explicit auth stance. The service imports `AuthModule.forRootAsync` with the global `APP_GUARD` (`auth.module.ts:226`), and the oRPC `HealthController` has no `@AllowAnonymous()`, so both are probably session-gated by the guard, while the BFF delegation file claims "the service enforces requireAuth where needed". Net: no rate limit, no role check, and anonymous callers such as the web dev middleware (`apps/web/src/middlewares/WithHealthCheck.tsx`, `/api/server/health/route.ts`) rely on cookie pass-through. Not verified at runtime. Contrast: monolith made `check` explicitly public and `detailed` `requireAuth()`.
- N-6: `PushService` lacks `@Injectable()` and uses `import type` for its dependency (4.4). Possible total failure of push at runtime, masked by hand-constructed unit tests.
- N-7: Identity admin-on-superAdmin gap (4.3) in the new rules; the ported rules protect minting, not targeting.
- N-8: `EffectRuntime.context()` is process-global; request-scoped state will need a different mechanism (4.2).
- N-9: Identity runs two idioms in one process (Effect user domain, constructor-DI Nest for the rest). The shared e2e and `identity` global `EffectServices` registration only know about user services. Until the others are ported (or explicitly left Nest), contributors cannot tell which pattern to follow.
- N-10: `apps/api/src/modules/health/*` (monolith) is also being edited now (it imports `@deployer/health-contracts`); the monolith and svc copies will diverge further unless the monolith is frozen (`ARCH-037`).
- N-11: Swarm tier `healthcheck: null` combined with the image-level HEALTHCHECK on port 3001 means start-first/rollback rolling updates of the service tier may be driven by the wrong probe (unverified).

---

## 7. Recommended next steps

1. Fix the two health bugs now, in the service, not the controller: add `HealthService.report()` that returns a domain object (status, service name, uptime seconds), unit-test uptime with a stubbed clock, and delete the `/1000`. Decide supervisors (drop the field or BFF roll-up, per N-3). Closes `OBS-028`, `OBS-029`, `OBS-086`.
2. Give svc-health an explicit authz stance per procedure and port the monolith's rate limit on `check` (OBS-NEW-E). Add a test that an anonymous call is rejected/accepted as designed.
3. Add a module-boot test for svc-health (resolve `HealthService` and the registry through `EffectRuntime`) and an HTTP-level test for `/health`, `/health/ready`, `/health/stream`. Fix D-1..D-3 or delete the dead API.
4. Before porting more identity domains, settle the shared pieces: per-request context in `@deployer/nest-effect`, `CurrentActor`/policy service, tagged-per-failure error model. Then refactor `UserServiceFailure`.
5. Land unit specs for the user domain immediately (rules matrix, service with fake repository via `Effect.provideService`, controller via `effectContext`). Include negative cases for viewer/user and admin-on-superAdmin. Closes `AUTH-045`, advances `ARCH-036`, `SEC-038`.
6. Add the hierarchy rule (AUTH-NEW-C), expose `setBanned` or make `update` apply the self-destruct guard, and decide role-at-create.
7. Verify and fix `PushService` DI (add `@Injectable()`, normal import), add a root-module boot smoke test, then port push in this order: DI fix, VAPID decision (`DEC-OBS-1`), real send with 404/410 pruning (`OBS-008`), stop the fake report (`OBS-006`), endpoint-rebind fix (`OBS-010`).
8. Port permission next (small, no contract): make it the policy service SUB-A needs, fail loud on loader errors (`AUTH-025`), then wire it behind the user domain in shadow mode.
9. Plan the analytics split (repository + host-metrics adapter + report service) and serve the report download (`OBS-053`/`ARCH-016`) as part of that port, not before.
10. Clean-up and docs: freeze the monolith health/user/push/analytics (`ARCH-037`), fix `Dockerfile.api.prod` HEALTHCHECK (`ARCH-051`), remove the dead `HealthClient` side effect (`ARCH-083`), and update roadmap `OBS-028/029` line references. Update `packages/nest/effect` docs with the conventions above.

Evidence limits: nothing was executed. Items marked "unverified" (N-5, N-6, N-11, swarm probe behaviour, Nest deduplication of the double `HealthModule.forRoot`) need a boot or a test to confirm. Identity files changed during the review; re-check `modules/user/*` before acting on 4.3.
