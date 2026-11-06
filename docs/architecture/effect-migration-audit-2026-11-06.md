# What remains to migrate to Effect — audit, 2026-11-06

Scope: every workspace under `apps/api/*` (five services, the BFF, `shared`), `apps/setup`, and `packages/*`. `apps/web` and
`apps/doc` are Next apps and are out of scope. Test files, generated files and the e2e harness are excluded throughout.

## 1. How this was measured, and what the numbers do not say

Numbers come from reading the source tree (grep and a file walk), not from a type-level audit. Three caveats:

- **"Uses Effect" is by file**, not by function. A file that imports `effect` counts as migrated even if one method in it is
  still a Promise, so the Effect shares below are an upper bound. The async-method counts are the better signal of what is
  left.
- **`async (db) => …` inside `database.use(…)` is not counted.** That is a Drizzle callback inside an Effect, not Promise-style
  code. Only `async` *method declarations* and `async function`s are counted as Promise-style.
- **Pure code needs no migration.** Parsers, mappers, builders and filters that take a value and return a value are fine as
  functions (section 6). The list of "no Effect at all" files is therefore split into pure and not-pure by reading them.

## 2. The target form

A migrated service is the tag class with its implementation as a static class (`HealthService` is the reference):

```ts
export class HealthService extends Context.Service<HealthService, HealthServiceShape>()('health/HealthService') {
    static readonly live = class HealthServiceImpl implements HealthServiceShape { … }
}
```

Collaborators are yielded inside the methods, the module provides `{ provide: X, useClass: X.live }`, errors are `domainError`
tags, controllers are `procedure(contract).use(…).effect(function* …)`, and there is no exported `make<X>()` factory
(`apps/api/AGENTS.md`, "A service is a constant its own module provides"). That file keeps `serviceOver(Collaborator, make)` as an
allowed form for a stateless bag of closures; the operator's instruction of 2026-11-06 is to stop writing `make` functions, so
section 5 treats every `serviceOver(…, make…)` as a conversion target (convert when a file is touched, not as a sweep).

## 3. Scoreboard

Share of source files and lines that import or use Effect (upper bound, see caveat 1):

| Workspace | Files | Lines | Notes |
|---|---|---|---|
| `api/fleet` | 66 % | 79 % | most advanced service; no `@Injectable` and no controller `.handler` left |
| `api/identity` | 39 % | 73 % | two `@Injectable`s, one Promise-style repository |
| `api/project` | 54 % | 77 % | `network` module (90 lines) untouched; service repository has 4 async methods |
| `api/runtime` | 51 % | 62 % | **largest gap**: 37 k lines, the `docker` module is 44 % |
| `api/node-agent` | 62 % | 71 % | already class-form; remaining: `config/`, `boot/`, transport |
| `api/health` | done | | reference implementation |
| `api/bff` | **9 %** | 15 % | effectively not started: controllers, services, clients |
| `api/shared` | 43 % | 62 % | `traefik` module 49 %, `events` base framework, `context`, `triggers` |
| `apps/setup` | 33 % | 65 % | wizard module 60 %, Nest controller with `.handler` |
| `packages/*` | mostly done | | `docker`, `swarm`, `node-state`, `platform-supervisors` use Effect; `service-client` does not |

## 4. Inventory of what is still not Effect

### 4.1 `@Injectable` classes (6)

| File | Lines | Verdict |
|---|---|---|
| `shared/core/modules/events/base/base-event.service.ts` | 999 | **Migrate.** The event-service framework (query builders, namespaces, merge builder). Large and used by several services. |
| `node-agent/src/transport/mesh-transport.service.ts` | 393 | **Migrate.** Owns the agent's sockets and loops; hooks `onModuleInit/Destroy`. Fits `ServiceLifecycleShape` (`onStart` / `run` / `onStop`). |
| `packages/nest/effect/src/effect-runtime.ts` | 290 | **Keep.** The bridge between Nest and Effect; one provider owns the `ManagedRuntime`. |
| `packages/service-client/src/client/base-client.ts` | 109 | **Migrate** with the BFF clients (4.4). |
| `identity/.../role/role.seed.ts` | 56 | Migrate: a boot-time seeder, `onStart`. |
| `identity/.../audit/denial-audit.installer.ts` | 48 | Migrate: installs a sink at boot, `onStart`. |

### 4.2 Nest lifecycle hooks (10 files)

`mesh-transport.service.ts` (2), `shared/.../setup/services/initialization.service.ts` (655 lines), `apps/setup/.../cluster-orchestrator.service.ts`,
`fleet/.../preview-ttl-cleanup.service.ts`, `fleet/.../ingress-dns-reconciler.ts`, `role.seed.ts`, `denial-audit.installer.ts`, plus the two bridge files
(`effect-runtime.ts`, `effect-lifecycle.ts`, which stay). Replacement is `ServiceLifecycleShape` bound with `serviceLifecycle(Tag)`, as the cluster events
hub now does.

### 4.3 Controllers still on `.handler(…)` (66 handlers in 9 files, **plus 330 generated**)

**Correction (found when starting the BFF):** the scan above skipped `generated/` directories. The BFF's delegation layer,
`apps/api/bff/src/modules/delegation/generated/*.delegation.ts` (produced by `scripts/gen-bff-delegation.py`), holds **330 handlers**,
each `implement(contract.x).handler(({ input }) => this.client.x(input))` over a Promise-based `ServiceClientRegistry`
(`packages/service-client`, an `@Injectable` `BaseClient` hierarchy with interface/class merging). That generated layer, not the
three hand-written controllers, is the bulk of the BFF's non-Effect surface, and it is migrated by changing the generator, not by
hand: emit `procedure(contract.x).effect(function* ({ input }) { … })` over an Effect `ServiceClients` tag. Open design questions
are in the handoff prompt (section 5, item 1).

| File | Handlers | Note |
|---|---|---|
| `runtime/.../docker/domains/containers/mesh/node-router.ts` | 18 | a mesh router, not a Nest controller; same migration as the container mesh code |
| `apps/setup/.../wizard/wizard.controller.ts` | 13 | also throws `ORPCError` and has 9 async functions |
| `runtime/.../docker/controllers/docker.controller.ts` | 10 | 645 lines |
| `bff/.../dashboard/controllers/orchestration.controller.ts` | 7 | the BFF's screen orchestration |
| `shared/.../mesh/controllers/mesh.controller.ts` | 7 | node config and secrets |
| `bff/.../console/controllers/console-control.controller.ts` | 6 | |
| `bff/.../domains/setup/controllers/setup.controller.ts` | 1 | |

The other `.handler(` hits are infrastructure (`packages/mesh/service` routers, `nest/effect/requirements.ts`'s legacy `Proxy` gate).

### 4.4 Plain-class services and repositories (not `Context.Service`)

| Workspace | Classes | Largest |
|---|---|---|
| `api/runtime` | 22 | `DockerImageScannerService` 1210, `DeploymentRepository` 1208 (24 async methods), `DockerRepository` 930 (21), `TerminalSessionManager` 523, `DockerRuntimeStreamOrchestratorService` 520, `DockerImageSecurityScanService` 497, `DockerContainerMetricsStreamService` 349, `SwarmActivityEnricherService` 239 |
| `api/bff` | 12 | `CliAuthService` 544, `OverviewComposerService` 321, `ScreenReadService` 148, `ServiceClientRegistry`, the five `*Client` classes, `ManagedWebClient` |
| `api/fleet` | 7 | the `modules/fleet` services (`ServiceDagService` 215, rollout planner, readiness gate, rollback, failure containment, drift reconciliation, cross-project gate) |
| `api/shared` | ~20 real services | `BaseEventService` 999, `CoreEventSync*` 1105, `TraefikEventService` 333, `BaseBridgeService` 247, `InternalErrorInsightService` 301, `initialization`/`local-initialization`/`remote-initialization` services (async-heavy) |
| `api/identity` | 2 | `RoleSeeder`, `DenialAuditInstaller` |
| `api/node-agent` | 1 | `MeshTransportService` |
| `packages/service-client` | 2 | `ServiceClientRegistry`, `BaseClient` |

(The `shared` count of 41 in the raw scan includes pure builders and value classes; those are in section 6.)

### 4.5 Promise-style data access

Real `async` method declarations on classes: `runtime` `DeploymentRepository` 24, `DockerRepository` 21, `docker-image-scanner` 12, terminal session
manager 9; `identity` `AnalyticsRepository` 14; `project` `ServiceRepository` 4; `setup` `bootstrap-ingress` 13, `ingress-handover` 6, `handover-orchestrator` 5;
`bff` `CliAuthService` 6, `OverviewComposer` 6; `shared` `local-initialization` / `remote-initialization` / `node-record.client` / `base-bridge` / `bootstrap.ts`.
Total: 191 async methods across 29 files. The other Drizzle repositories (`user`, `push`, `role`, `approval`, `github-*`, `fleet.repository`) already run their
queries inside `database.use`, so they are Effect.

### 4.6 Failures that are not typed domain errors

- **Nest exceptions:** only `fleet/.../cloudflare-tunnel.service.ts` (3 `BadGatewayException`). Converting changes 502 to 424 (no bad-gateway error kind): needs a decision.
- **`throw new ORPCError`:** 16 throws in 9 files: `nest/effect/authz.ts` (legacy gate), `setup` wizard controller and `wizard-orpc.module`, `shared` `interceptors.ts` and `mesh-orpc-host.ts`,
  `mesh/client/relay-link.ts`, `runtime` `deployment.controller.ts`, `transport/orpc/standard-errors.ts`, `nest/effect/orpc-effect-context.ts`. The interceptor/transport ones are
  transport boundaries and may legitimately throw; the controller ones are not.

### 4.7 Environment reads (`process.env`)

56 files, 106 reads. The behaviour-changing ones are `SEC-104`: `shared/auth.ts` (8, schema generation only), `default-admin.bootstrap.ts` (9),
`local-initialization.service.ts` (8), `admin-bootstrap-policy.ts` (4), `bootstrap.ts` (3), `platform-managed-web.service.ts` (3), `node-agent` `main.ts`/`node-agent.env.ts`,
and `apps/setup`. Dev/test-only reads (`boot-agent.ts`, vitest setup, `compile.ts`, `vite-assets`) are allowed.

### 4.8 `make*` and `serviceOver` (convention, section 2)

- 58 files use `serviceOver(…)`: `fleet` 26, `identity` 14, `runtime` 10, `shared` 5, `bff` 2, plus package files.
- 52 exported `make<…>` functions in `shared`, 16 in `apps/setup`, 3 in `runtime`, 4 in `packages/node-state`, others in `docker`, `swarm`, `platform-supervisors`.
- Written by me earlier and since converted (phase 1 below): `SecretInventory`, `StepUpGateway`, `CloudflareTunnelEdge`, `Enrollment`, `MeshView` and `makeClusterEvents`.
- Already in the target form: `node-agent` (28 files), `health`, the other half of `runtime` (15 files), `shared` (8).

## 5. Recommended order

Phases are ordered by how much each unblocks and how independent it is. Sizes: S ≤ 1 day, M a few days, L a week or more.

1. **Convention sweep on what I wrote (S). Done 2026-11-06** (commit 4e9faccff): `SecretInventory`, `StepUpGateway`, `Enrollment`, `MeshView`, `CloudflareTunnelEdge` and `ClusterEvents` are `live = class` services. Stateless ones are provided with `useClass`; `ClusterEvents` is stateful, so its collaborators are constructor arguments and the module builds it with `new ClusterEvents.live(deps)`. `edgeProviderOver(host)` is an adapter, not a service, and stays a function.
2. **BFF (L).** Three controllers (`orchestration`, `console-control`, `setup`), three services (`CliAuthService`, `OverviewComposer`, `ScreenRead`), the clients and
   `ServiceClientRegistry` (with `packages/service-client`). The BFF is the only public surface and is 9 % Effect, so it is the biggest consistency gap per line.
3. **Runtime `docker` module (L, the biggest).** Order: `DockerRepository` and `DeploymentRepository` (Promise → `database.use` / `DockerEngine`), then `DockerImageScanner` /
   `DockerImageSecurityScan`, `TerminalSessionManager`, the stream hub (`DockerContainerMetricsStream`, `DockerRuntimeStreamOrchestrator`, `SwarmActivityEnricher`), and last
   `docker.controller.ts` and the mesh `node-router`. `AbstractDomainEventStreamService` can then be deleted (its registry has no consumer).
4. **Shared event framework (L).** `BaseEventService` / `CoreEventSync` / `TraefikEventService`: the same pattern as the cluster events hub (state in the class, lifecycle in the shape,
   RxJS as the stream surface). Do after 3 so there is no second framework to keep alive.
5. **Setup app (M).** Wizard controller (`.handler`, `ORPCError`), `bootstrap-ingress`, `ingress-handover`, `handover-orchestrator`, `cluster-orchestrator` hooks, `EnvService`. Its own Nest app, so it can run in parallel with 3.
6. **Shared initialization (M).** `initialization.service` (655, Nest hook), `local-initialization` (1099), `remote-initialization`, `node-record.client`, `base-bridge`.
7. **Small leftovers (S each).** `RoleSeeder`, `DenialAuditInstaller`, `MeshTransportService`, `AnalyticsRepository`, `ServiceRepository`, fleet `modules/fleet` services, `shared/mesh.controller`,
   `identity` and `fleet` `ORPCError`s, the `network` module in `project`.
8. **Remove the legacy gate (M, `AUTHZ-012`).** The `Proxy` auto-gate and `configureAuthz` in `nest/effect` go when the remaining controllers (about 380 `procedure(` uses) declare access with `accessRequired`.
9. **`process.env` (M, `SEC-104`).** Move behaviour switches to runtime config; add the lint rule.

## 6. Not migrated on purpose

- **Pure code**: `runtime-event-filter` (908), `mesh-universe-merge` (751), `scanner-output` (538), `docker-event-mapping` (529), `mesh-entity-normalization` (507),
  `container-runtime-helpers`, `container-metrics`, `container-dockerode-normalizer`, `compose-parser` (565), `drizzle-filter.utils` (512), the Traefik config builders and the variable
  system (`traefik-config-builder`, `middleware-builder`, `variable-*`), the `context` module builders (514), `middleware-library.interfaces`. They take values and return values.
- **Bridges**: `EffectRuntime`, `ServiceLifecycleRunner`, `EffectHost`, the legacy `procedure()` wrapper while the gate exists.
- **Streaming**: RxJS stays the streaming surface; Effect services produce the observables (cluster events hub).
- **Plugin builders and fluent APIs** (`RequirementBuilder`, `AuthzBuilder`, `PermissionEngine`): value objects with no I/O.
- **Contracts, UI, routing and transport packages**: no runtime service logic.

## 7. Decisions needed

1. `serviceOver` (documented allowed form) versus the operator's "no `make` functions": this audit assumes the operator's rule wins and converts on touch.
2. `BadGatewayException` to a domain error changes 502 to 424; either accept that or add a bad-gateway error kind to `domainError`.
3. Whether the BFF's generated delegation controllers (`.handler`-free, generated) stay generated, and the three hand-written BFF controllers go first.
4. Whether `BaseEventService` is migrated or replaced. Checked: `AbstractDomainEventStreamService`'s static registry and merge builder have no consumer outside its own file and its three subclasses. Not checked: the same for `BaseEventService` itself, which is the first thing to verify before porting a 999-line class.
