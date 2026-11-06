# Handoff prompt — give this whole file to the next LLM

You are continuing work on a self-hosted deployment platform ("deployer", a Vercel/Render-style platform for a VPS or a small
fleet). The working directory is `/home/sebille/Bureau/projects/tests/deployer/v3`, on branch `rewrite-v3`. The previous
session ran for a long time with one operator and is ending because of a usage limit. Everything below is what you need to
continue without asking what happened. Where this file and the repo disagree, the repo wins; where this file and the
operator's latest message disagree, the operator wins.

## 0. First five minutes

1. Read, in order: `AGENTS.md` (repo root), `v3/AGENTS.md`, `v3/apps/api/AGENTS.md`, `v3/apps/api/shared/AGENTS.md`.
   (Note: `AGENTS.md`, `.husky/pre-commit` and `tooling/eslint/src/nestjs.ts` are modified by the operator and uncommitted.
   **Never touch, stage, stash or revert them.** `git add` only the files you changed.)
2. Read `docs/architecture/effect-migration-audit-2026-11-06.md` (what remains to migrate, by workspace, with an order) and
   `docs/architecture/secrets-lifecycle.md` (secrets design, sections 1-6).
3. `git log --oneline -80` to see what was built (section 3 lists it by theme).
4. The operator speaks tersely, sometimes with typos. They want results, not questions. They get angry at: non-Effect code,
   hidden problems, lint disables, `any`, and anything that ignores a rule they already stated. Ask a question only for a
   decision that is genuinely theirs (e.g. an API status code change), and give a recommendation.

## 1. Hard rules (the operator has stated these; breaking one costs trust)

**Code**
- **Effect only for new code.** A service is the tag class with its implementation as a static class:
  ```ts
  export class HealthService extends Context.Service<HealthService, HealthServiceShape>()('health/HealthService') {
      static readonly live = class HealthServiceImpl implements HealthServiceShape { … }
  }
  ```
  Collaborators are yielded inside each method (`const db = yield* Database`), the module provides
  `{ provide: X, useClass: X.live }`, a method body is `return Effect.gen(function* () { … })`, annotated
  `: ReturnType<XShape['method']>`. **No `make<X>()` factory functions and no `serviceOver(…, make…)`** (the operator said so
  explicitly on 2026-11-06; `apps/api/AGENTS.md` still mentions `serviceOver` as allowed, so convert on touch). A stateful
  service that has lifecycle members (`onStart`/`run`) cannot yield collaborators (`ServiceLifecycleShape` has an empty
  requirement channel), so its collaborators are constructor arguments and the module builds it with a factory that only does
  `new X.live(deps)` (see `ClusterEvents` in `apps/api/services/fleet/src/modules/cluster/events/cluster-events.ts`).
  Reference implementations: `apps/api/services/health`, `apps/api/services/node-agent` (`NodeState`, `FleetSecrets`),
  fleet `SecretInventory`, `Enrollment`, `MeshView`, `StepUpGateway`, `CloudflareTunnelEdge`.
- Controllers: `@Implement(contract.x) x() { return procedure(contract.x).use(requireAuth()).use(accessRequired(…)).effect(function* ({ input }) { … }) }`. No constructor injection, no `.handler(async …)`.
- Errors: `domainError('Tag', kind)` (kinds: not_found, validation, conflict, unauthorized, forbidden, dependency_missing), never a thrown Nest exception or `ORPCError` in a controller or service. `yield* new MyError({...})` works for `domainError` classes; plain `ForbiddenError` from `@deployer/errors` needs `yield* Effect.fail(new …)`.
- Parse untyped data with one `zod/v4` schema + `safeParse` (root AGENTS.md §8), not chains of `typeof`.
- No `any`. **No lint-rule disables** unless strictly necessary. Do not hide a problem: fix it or report it.
- Streaming stays RxJS; Effect services *produce* the observables.
- **Env variables are dev-only and must never decide behavior.** The app must be self-deployable without configuration; config lives in the runtime (node-local `node_config`, cluster settings). Do not add an env read for behavior, ever.
- Docker is only reached through `dockerode` / the `DockerEngine` tag (root AGENTS.md §9).
- Documentation in the same change as behavior (`docs/…`); roadmap items live in `docs/audit-2026-10-25/roadmap/*.md`.

**Process (root `AGENTS.md` 4b — the operator rewrote this)**
- Run lint / type-check / test / build **through Turbo, one process, repeated `--filter`**, e.g.
  `bun x turbo run type-check test lint --continue --concurrency=2 --filter=@deployer/svc-fleet --filter=@deployer/shared`.
  Never loop per package. **Do not pass `--concurrency` by default**; pass `--concurrency=2` only after a real out-of-memory
  failure (exit 137 happened once when ~8 packages ran at once). Never run `eslint`/`tsc`/`bunx eslint` directly. Never
  `pkill -f turbo` or `vitest` from the shell tool (it kills the tool's own shell).
- Package names (check `package.json` `name`): `@deployer/svc-fleet`, `svc-identity`, `svc-project`, `svc-runtime`, `svc-health`, `svc-node-agent`, `@deployer/bff`, `@deployer/shared`, `@deployer/setup`, `@deployer/web`, `@deployer/node-state`, `@deployer/mesh-client`, `@deployer/nest-effect`, `@deployer/fleet-contracts`, `@deployer/node-agent-contracts`, `@deployer/nest-schema`, `@deployer/effect-infra`, `@deployer/auth`, `@deployer/env`.
- `bun lint` is check-only here; **do not run a bulk `lint:fix`** (it once rewrote 200 files). Fix lint in your own files by hand.
- **The pre-commit hook lints the whole of every file you touched** and fails on its *errors* (warnings pass). So a pre-existing lint error in a file you edit blocks your commit and you must fix it. Typical ones: `no-unnecessary-condition` (an `??` or `?.` on a non-nullable), `require-await` (an `async` arrow with no `await`: use `() => Promise.resolve(x)`), `no-unused-vars`, `no-duplicate-type-constituents`, `import/order` (warning only). **Careful:** when a lint line number points at one of several identical lines, edit the exact line reported (I once edited the wrong occurrence and broke type-check).
- Commit with conventional messages, one logical change per commit, ending with `Co-Authored-By: Claude <noreply@anthropic.com>`. Pass the message with `-m`. If the hook rejects, fix and commit again (the failed commit leaves files staged).
- Running `@deployer/web` tests rewrites `apps/web/public/sitemap-0.xml`. Run `git checkout apps/web/public/sitemap-0.xml` before committing.
- `apps/web/src/routes/index.ts` is generated and gitignored: after adding a page, run `bun run dr:build` inside `apps/web`.
- Known flaky specs (they time out when many suites run in parallel and pass alone): `apps/api/shared/src/server/service-client.spec.ts`, and the node-agent real-socket specs under `apps/api/services/node-agent/src/boot/` (`mesh-cluster`, `mesh-lifecycle`, `plug-and-play`, `node-door`, `mesh-local-only`, `multihop-relay`). Re-run alone before believing a failure: `cd apps/api/services/node-agent && bun x vitest run src/boot/<file>`.
- Pre-existing, unrelated lint errors still exist in `svc-fleet`, `shared`, `svc-runtime`, `setup`, `svc-node-agent` (files nobody touched). The fleet `lint` task therefore fails overall; what matters is that **your files** are clean (grep the lint output for them).
- The monolith `apps/api` legacy tree is not to be patched (see memory below); only `apps/api/services/*`, `bff`, `shared`, `apps/setup`, `packages/*`.

**Memory notes the previous session kept** (the files are under `~/.claude/projects/-home-sebille-Bureau-projects-tests-deployer-v3/memory/`; if you cannot read them, these are their essence): nodes are plug and play with no env; mesh-first, no central source of truth; services are module-provided constants with `useClass: X.live`; Nest provides Effect tags directly (no host layer); keep RxJS for streaming; never rewrite user-dirty files in place; no bulk lint:fix; turbo one-run no default `--concurrency`; **new code is Effect only** and **services are live classes, not make functions**.

## 2. Architecture you must understand

- **Contract first** (`packages/contracts/<service>`), built with the `standard.zod` builder, never raw `oc.route()`. A service implements its contract; the **BFF** (`apps/api/bff`) is the only public HTTP surface and delegates to services through *generated* controllers (`apps/api/bff/src/modules/delegation/generated/*.delegation.ts`, produced by `python3 scripts/gen-bff-delegation.py`; the table of namespaces is at the top of that script). After running the generator the files are unformatted: `git checkout` all generated files except the one you added, then `cd apps/api/bff && bun fmt`. The service surface is listed twice (`apps/api/bff/src/orpc/service-surface.ts` and `apps/web/src/lib/orpc/service-surface.ts`); `python3 scripts/check-service-surface-parity.py` guards that they match.
- **Services**: fleet, identity, project, runtime, health, node-agent. **Node agent** (`svc-node-agent`) runs on every node, owns the node-local SQLite (`node_config`) and the mesh. It serves three doors: the **peer door** (agent to agent, behind the swarm credential), the **service door** (an *allowlist* in `apps/api/services/node-agent/src/transport/service-door.ts`: what a service container may call) and the **admin door** (operator acts: configure, rotate, retire, join tokens). A procedure not on the service door is invisible to services ("No procedure matched") — this bit once.
- **Access control** (`packages/nest/effect/src/access/*`, design in `docs/architecture/access-requirements.md`): `defineResource(name, { scope })`, `Resource.can('action')`, `.use(accessRequired(Resource.can('read')))` or the mapping form `accessRequired(({ input }) => User.can('get').on(input.params.id))`, `accessSelf(reason, on)` (the `on` mapping is mandatory), `accessPublic(reason)`, `accessDeferred(reason)`. All are Effect middlewares built with `effectMiddleware` (`packages/nest/effect/src/effect-middleware.ts`), with checked dependencies. The permission catalog is `packages/auth/src/authz/definition.ts`. A legacy `Proxy` auto-gate still exists in `packages/nest/effect/src/requirements.ts` (to be removed with AUTHZ-012).
- **Requirement checking**: `procedure(c).effect(function* …)` carries the services the handler yields as a type-level requirement; the module must provide them or the build fails with `Missing<…>`.
- **Secrets** (read `docs/architecture/secrets-lifecycle.md`): the **platform secret** is generated on a node's first boot in `node_config`, handed to joiners in the enrollment answer, and rotated as a **ring of generations** (current + earlier ones). Claims, the ingress token, sealed columns (key ring with one root per generation) and Better Auth (`secrets` versions) verify under every accepted generation. Rotation spreads by peers pulling a higher generation after each gossip round. `secrets.rotate` / `secrets.retire` (fleet service) need `platform.secret:rotate` / `:retire` **and** a passkey step-up checked by identity through a signed system-actor claim. Retiring is refused while any reachable node is behind and while any stored value is still sealed under the generation (`reseal-secrets --to-current` rewrites rows). Settings → Secrets in the web app shows the adoption matrix with Rotate and Retire.
- **Schema pitfall**: never put `.default()` on a field of a schema that is also used `.partial()` as a PATCH (`meshNodeConfigSchema` → `meshNodeConfigureInput`): zod turns "not named" into "reset" and wipes data. Old records are completed at read time instead (`withLegacyDefaults`).
- **Boundary rule**: a service must not import the whole schema barrel (`@deployer/nest-schema/global`), lint rule `deployer-schema/boundary`. The encrypted-column counter lives in `apps/api/shared/src/core/modules/secrets/stored-secrets.ts` for that reason.

## 3. What was built in the previous session (by theme, newest first within a theme; all committed on `rewrite-v3`)

**Effect migrations and conventions**
- `8c1681169`, `4e9faccff`: six services converted from `make*`/`serviceOver` to `live` classes; audit doc marked.
- `bf4784353`: `docs/architecture/effect-migration-audit-2026-11-06.md` (the map of what remains — read it).
- `47828c732`: the shared `EdgeProvider` plugin contract is now Effect-based (`apps/api/shared/src/core/modules/edge/edge-provider.ts`); the direct provider, the public-edge service, the ingress-edge service and the fixtures follow. The tunnel provider supplies its own services with `host.context()` + `Effect.provideContext` (`edgeProviderOver`).
- `79db0d990`: Cloudflare tunnel edge as an Effect service.
- `069631b86`: fleet cluster events hub as an Effect service with `ServiceLifecycleShape` (RxJS observables kept).
- `55bb27301`, `61b556d3e`, `421be92e4`: fleet enrollment, mesh view, app-instance heartbeat on Effect. Fleet now has no `@Injectable` and no `.handler` controller.
- Earlier in the same session (before the secrets work): auth, access, app-instance and rate-limit **middlewares as Effects** (`bd07be06b`, `393a4b266`, `358b4fb75`), `accessRequired`/`Resource`/boot audit (`531a39f05`, `0eda1a3e5`, `f6f5427a1`, `49ace8802`), `accessSelf` requiring its `on` (`6fa554ab7`).

**Secrets (SEC-100, 101, 102 and 103 built — no "reveal" action yet; SEC-104 and SEC-105 not started)**
- `a6772c5a3`, `f017e1293`, `4fac6f905`, `7f954f113`, `8c7c1e57c`: platform secret in `node_config`, Better Auth, join grant, column codecs, setup provisioner and ingress token no longer use env secrets. `BETTER_AUTH_SECRET` is gone from the schemas; `AUTH_SECRET` remains only as a legacy column reader and a one-time import of a strong old root (`shortcut:` comments mark both).
- `8a444d1fb`, `73c6e4298`, `c573b0972`, `0c5a16730`: per-node inventory by fingerprint + generation, fleet aggregate (`secrets.inventory`), BFF delegation, Settings → Secrets.
- `284de0a03`, `6fbabb33e`, `621b4e778`, `1ccbfac7a`, `9ae943be9`, `3915ca281`, `96194760b`, `90d2fec84`: rotation (ring, consumers, spread by gossip, rotate/retire, UI, step-up, stored-value counts and `reseal-secrets --to-current`), and a two-agent spec over real sockets (`apps/api/services/node-agent/src/boot/platform-secret-rotation.spec.ts`) that proves rotate → spread → fleet view → retire fan-out.

## 4. Verified vs. not verified

Everything above is covered by unit/spec tests and type-checks pass. **Not done**: a run against a real Postgres (the reseal SQL was tested against a fake pool only), a real two-node deployment, loading the new web screens in a browser, a live Docker engine for the events hub, Cloudflare. Say so when you report; do not claim these.

## 5. What to do next (in this order unless the operator says otherwise)

The operator asked to **start the BFF migration** next. The BFF (`apps/api/bff`) is ~15 % Effect and is the only public surface.

1. **BFF migration (L).** Source: `apps/api/bff/src`. Non-Effect today:
   - Controllers on `.handler(…)`: `modules/dashboard/controllers/orchestration.controller.ts` (359 lines, 7 handlers), `modules/console/controllers/console-control.controller.ts` (95, 6), `domains/setup/controllers/setup.controller.ts` (263, 1). The `delegation/generated/*` controllers are generated: do not hand-edit.
   - Plain-class services: `cli/services/cli-auth.service.ts` (544, 6 async methods), `modules/shared/services/overview-composer.service.ts` (321), `modules/shared/services/screen-read.service.ts` (148), `modules/dashboard/services/analytics-read.service.ts` (60), `clients/service-registry.ts` (107, `ServiceClientRegistry`), `modules/console/clients/managed-web.client.ts` (61), and the five client classes in `clients/{fleet,health,identity,project,runtime}/` (28-50 lines each). `packages/service-client` has `BaseClient` (`@Injectable`) and its own `ServiceClientRegistry`.
   - Convert each to the `live` class form with ports as tags where it calls a sibling service, typed `domainError`s, `.effect()` handlers. Keep the generated delegation as it is. Write/port specs; keep `bun x turbo run type-check test --filter=@deployer/bff` green; check the BFF e2e/contract specs that exist.
2. **Runtime `docker` module (L, biggest gap, 37 k lines)**: order in the audit doc section 5.3 (`DockerRepository`, `DeploymentRepository`, image scanner/security scan, terminal sessions, the stream hubs, then `docker.controller.ts` and the mesh `node-router.ts`). Delete `AbstractDomainEventStreamService` afterwards (its registry has no consumer).
3. **Shared event framework (L)**: `BaseEventService` (999 lines), `CoreEventSync`, `TraefikEventService`. First verify that `BaseEventService`'s static registry/merge builder has consumers (not yet checked).
4. **Setup app (M)**: wizard controller (`.handler`, `ORPCError`), `bootstrap-ingress`, `ingress-handover`, `handover-orchestrator`, `cluster-orchestrator` hooks, `EnvService`.
5. **Shared initialization (M)**, **small leftovers (S each)** (`RoleSeeder`, `DenialAuditInstaller`, `MeshTransportService`, `AnalyticsRepository`, `ServiceRepository`, fleet `modules/fleet` services, `shared/mesh.controller`).
6. **AUTHZ-012 / legacy gate removal (M)**: convert the remaining ~380 `procedure(` uses to `accessRequired`, then delete the `Proxy` gate and `configureAuthz` in `packages/nest/effect`.
7. **SEC-104 / SEC-105 (M)**: inventory the 106 `process.env` reads (56 files), move behaviour switches (`AUTHZ_MODE` first) to runtime config behind `AccessPolicy`, add a lint rule banning env reads outside bootstrap/dev entry points.
8. **Secrets leftovers**: rotate the **mesh** secret in the same ring model (today the agent's swarm credential has its own grace-window rotation); Better Auth hot-swap of a new generation (today it needs a restart); a UI button for `reseal --to-current`; a run on two real nodes with the database.

**Decisions waiting for the operator** (ask with a recommendation, do not guess): (a) replacing `BadGatewayException` in `fleet/.../cloudflare-tunnel.service.ts` with a domain error changes 502 to 424 (there is no bad-gateway error kind); (b) whether to sweep the 58 remaining `serviceOver` files or convert on touch (the audit assumes on touch); (c) whether `BaseEventService` is ported or replaced.

## 6. How to work and report

- Make a short task list at the start of a request; keep it current. Prefer reading a *migrated* file as the template (e.g. `health`, node-agent `NodeState`, fleet `SecretInventory`) over the nearest file, which may be legacy.
- Test through the service's `live` class with fakes provided by `Effect.provideService`; assert on the typed failure, not on a thrown exception. Use `provideTo(new Service.live(), (e) => e.pipe(Effect.provideService(Tag, fake)))` (from `@deployer/effect-core`).
- After each logical change: type-check + test + lint for the touched workspaces in **one** turbo run, then commit.
- Report to the operator in plain, short prose: what changed, what you did **not** verify, what is open, and one question if a decision is theirs. No recaps of what they already know, no pasted code unless asked.
