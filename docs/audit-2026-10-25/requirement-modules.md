# Requirement modules — endpoint requirements, module-scoped Effect contexts

Date: 2026-10-30
Scope: `packages/nest/effect` (`@deployer/nest-effect`), `apps/api/shared/src/server` (the oRPC host and the boot
gate), and `apps/api/services/health` as the reference migration. Read-only context: `apps/api/AGENTS.md`.

Status legend: **DONE** = implemented and exercised by tests; **PARTIAL** = implemented, not yet adopted everywhere;
**PLANNED** = decided, not started.

Companion sample (standalone, not a workspace package): `samples/api-sample/requirements-demo`, with
`caveats.html` as the interactive review of every caveat in §8.

---

## 1. The problem

Three costs were paid on every endpoint before this model:

1. **A wiring line per endpoint.** `.use(Module[EffectContextOf])` had to repeat the module's provider list. It was
   type-only, so it drifted silently: a controller could `yield*` a service its module never declared, and nothing
   failed until a request did.
2. **No audit.** Nothing compared what the handlers used with what the modules provided. The Effect context was one
   flat pool built from every provider in the container, so "the module graph" was a comment, not a rule.
3. **The context was app-wide.** `EffectRuntime.context()` handed every request every provider, so a service could be
   reachable from a module that never imported the module that owns it.

The new model answers all three from the same two inputs the code already has: the handler body, and Nest's metadata.

---

## 2. The model in one page

| Question | Answer | Where |
|---|---|---|
| What does an endpoint require? | the `R` of everything its handler yields — inferred, never declared | `procedure(contract).effect(body)` |
| What can a module's controllers use? | its own `providers` + the **`exports`** of its imports + global modules | `createModuleContext` |
| Where do unmet requirements go? | a `[controller, services]` pair, forwarded up the import tree unchanged | `[UnmetRequirementsOf]` |
| Who resolves globals? | only the composition root, the one place that sees the whole tree | `RequirementsMet` / `assertRequirementsMet` |
| What does a request see at runtime? | the context of the module that owns the controller | `EffectRuntime.contextFor(controller)` |

Two invariants make it hold:

- **No declaration, no drift.** The requirement set is derived from the handler's type, so it cannot disagree with the
  body.
- **Nest's visibility is the only visibility.** A parent cannot fix a child, a sibling is invisible, and an import gives
  exactly its exports — the same rules Nest applies at DI time.

---

## 3. Endpoint requirements

```ts
import { procedure } from "@deployer/nest-effect";

@Implement(healthContract.check)
check() {
  return procedure(healthContract.check).effect(function* ({ context }) {
    const result = yield* snapshot(context); // HealthService | HealthRegistryRepository
    return { ... };
  });
}
```

- `procedure()` is `implement()` with the same generics (`TContract extends RouterContract`,
  `TInitialContext extends Context = DefaultInitialContext`, `config?: ProcedureConfig`) and the same runtime. Its
  `.effect()` returns the handler's `R` in the procedure's type under a phantom marker.
- Router contracts stay routers: `procedure(router).someProcedure.effect(...)`, `$context()`, `$config()` and
  `.use(middleware)` keep the typed `.effect` at every step (a Proxy delegates and re-wraps).
- The handler is a **plain generator**, not `HandlerGen`: `HandlerGen` constrains its yields by the handler's own
  context, which is exactly what forced pre-declared services. Here the context is independent of the yields, so
  `TYield` is inferred from the body and several `yield*` calls need no `Effect.gen` wrapper.

`RequiredBy<P>` reads the marker off the procedure's initial/injected context. `ControllerNeeds` maps a controller's
methods through it, so a module's requirement set is computed from its controllers with no static list.

**The return type keeps the initial context.** `RequirementProcedure.effect()` returns
`ImplementedProcedure<TInitialContext, TInjectedContext & Marked<…>, …>`. Folding the middleware's injected context into
the initial slot breaks `@Implement`: `requireAuth()` narrows `auth` to the authenticated variant, and the decorator
requires `ContractedRouter<T, DefaultInitialContext>`. The first three services looked fine because they never call
`requireAuth()`; identity and project surfaced it as 40 `TS1241` each. The middleware still types the handler, and the
marker stays in the injected slot where `RequiredBy` reads it.

**Why not a global `.effect` override.** A `declare module "@orpc/server"` overload works only while the package's own
signature is inapplicable. It is inapplicable for `implement(contract).effect(...)`, and applies again the moment a
middleware injects `effect/context` — then the package signature wins overload resolution and the marker silently
disappears (`RequiredBy = never`). A wrapper is deterministic; a global overload is not. Same reason the facade is
`procedure()` and not a monkey patch.

---

## 4. Module semantics (Nest's, exactly)

| Visible to a module's controllers | Not visible |
|---|---|
| its own `providers` | a sibling's providers |
| the `exports` of the modules it `imports` | a **parent's** providers |
| what an imported module **re-exports** (`exports: [SomeModule]`) | an import's un-exported providers |
| the `exports` of every **global** module | |

A module is a value, not a subclass:

```ts
export class HealthDomainModule extends createModuleContext({
  imports: [HealthModule.forRoot({ indicators: "platform" })],
  controllers: [HealthController],
  providers: [
    { provide: HealthRegistryRepository, useExisting: HealthRegistry },
    { provide: HealthService, useValue: HealthService.live },
  ],
  exports: [HealthRegistryRepository, HealthService],
}) {}

export type HealthRequirements = UnmetOf<typeof HealthDomainModule>; // never
```

The type carries four facts, all type-only (the class has no runtime registry):

| Symbol | Meaning |
|---|---|
| `[EffectContextOf]` | **legacy** view: own providers + every import's context (exported or not) |
| `[ExportsOf]` | what importers get |
| `[AllServicesOf]` | every provider in the subtree — the container the runtime builds |
| `[GlobalServicesOf]` | the exports of every global module in the subtree |
| `[UnmetRequirementsOf]` | `[controller, services]` pairs this subtree cannot resolve |

`[UnmetRequirementsOf]` is Nest-strict. `[EffectContextOf]` is deliberately kept on the **pre-migration** union: every
controller that still calls `.use(Module[EffectContextOf])` compiles unchanged, and the strict audit only bites through
`procedure()` plus the root gate. Removing the legacy union is the last step of the migration, not the first.

### Globals

- Owned modules: `createGlobalModule(metadata, ...services)`.
- Foreign modules: `declareModule(Module, { provides, exports, global: true })`.
- Both apply Nest's `@Global()` as well as the type marker. A type-only global compiles and then fails at runtime,
  because `EffectRuntime` reads `Module.isGlobal`.
- A module's own `UnmetOf` still lists global-provided services (a module cannot know the app's globals); the
  composition root subtracts them in `ResolveGlobals`. Local `assertRequirementsMet(SomeModule)` is therefore only
  meaningful for modules that do not rely on globals.

`createGlobalModule` is a wrapper rather than an options argument so `createModuleContext(metadata, ...services)` keeps
its shape — the ~24 call sites that pass extra Effect keys (`DatabasePort`) do not move.

### Foreign modules

`declareModule(module, { provides, exports })` brings a plain `@Module` into the flow without editing it. It is the one
trust boundary: a class type does not expose its providers, so `provides` is a claim. It is now **validated against
Nest's metadata at import time** — a claim Nest does not back throws with the missing token names instead of failing on
the first request. Only a claimed service's collaborators are cross-checked by the type layer.

---

## 5. The root gate

```ts
const rootModule = assertRequirementsMet(HealthServiceModule);

void bootstrapApiServer({ rootModule, port, name, dependencies });
```

- `assertRequirementsMet` takes `M & RequirementsMet<M>`. An unmet service is a compile error naming controller and
  services:

  ```
  Argument of type 'typeof HealthServiceModule' is not assignable to parameter of type
    'typeof HealthServiceModule & Missing<[HealthController, HealthService]>'.
  ```

- `bootstrapApiServer({ rootModule })` is typed `M & RequirementsMet<M>` too, so the check cannot be skipped by
  deleting the line. The explicit `assertRequirementsMet` call stays because it is where the reader looks.

Why pairs and not a service union: under Nest semantics a parent cannot fix a child, so a service name alone sends
you to the wrong file. The pair names the controller whose module must import or export.

---

## 6. Runtime scoping

`EffectRuntime` answers two different questions, and they must not be merged:

| Method | Context | Consumers |
|---|---|---|
| `context()` | the whole container (discovered providers + contributed layers) | seeds, boot code, `runPromise`, package tests |
| `contextFor(controller)` | the module that owns `controller`: its providers, its imports' exports, globals' exports | the oRPC request path |

The host wires it per request:

```ts
createOrpcModule({
  extraContext: {
    inject: [EffectRuntime],
    resolve: async (executionContext, runtime) => ({
      "effect/context": runtime.contextFor(executionContext.getClass()),
    }),
  },
})
```

- `extraContext.resolve` now receives the `ExecutionContext` first. `fleet`, `project` and `mesh-agent` pass
  `_executionContext` and still call `context()` — behaviour unchanged until they migrate.
- `exportedBy(module)` resolves Nest's `exports` tokens, following `exports: [SomeModule]` re-exports, with a `seen` set
  for cycles.
- Apps that contribute `EffectRuntimeModule.forRoot({ layers })` fall back to the app-wide context: a Layer is
  composed app-wide and cannot be attributed to one module. No app does this today; marked in code.
- `scopeReport()` lists, per controller, the services registered in the container but outside its module scope — what a
  controller would lose if the runtime flipped today. `EFFECT_SCOPE_REPORT=1` logs it at boot (health's `main.ts`).

---

## 7. Adoption status

| Item | Status | Evidence |
|---|---|---|
| `procedure()`, `RequiredBy`, `UnmetOf`, `RequirementsMet`, globals | **DONE** | `packages/nest/effect/src/requirements.ts` |
| Module facts, `createGlobalModule`, `declareModule` + claim validation | **DONE** | `.../create-module-context.ts` |
| `contextFor` + `scopeReport` | **DONE** | `.../effect-runtime.ts` |
| Host passes `ExecutionContext` | **DONE** | `apps/api/shared/src/server/orpc-host.ts`, `mesh-orpc-host.ts` |
| Boot gate on `rootModule` | **DONE** | `apps/api/shared/src/server/bootstrap.ts` |
| `svc-health` migrated (controller, module exports, `contextFor`, `assertRequirementsMet`) | **DONE** | `apps/api/services/health` |
| `svc-mesh-agent` migrated (4 controllers, `contextFor`, explicit assert) | **DONE** | `apps/api/services/mesh-agent`: type-check clean (119 files), 143/143 tests, no `EffectContextOf` left |
| The 23 `@Global()` modules annotated (`declareModule(..., { global: true })` / `forRoot` results) | **DONE** | `scripts/check-global-modules.ts` is green and wired into CI |
| `svc-identity` migrated (41 sites, global `DatabasePortModule`) | **DONE** | 183 files, 206/206 tests |
| `svc-project` migrated (69 sites, `ProjectDomainModule` exports) | **DONE** | 281 files, 181/181 tests, 7.28M instantiations |
| `svc-fleet` migrated (89 sites, 10 controllers, root converted to `createModuleContext`) | **DONE** | 376 files, 287/287 tests, 6.79M instantiations |
| `svc-runtime` migrated (6 sites, `RuntimeDatabaseModule`, root converted) | **DONE** | 481 files, 527/530 tests (3 pre-existing env failures) |
| `svc-bff` | **DONE (no-op)** | 0 `.effect()` controllers; its 132 `.handler()` endpoints have no requirements |
| Remove the legacy `[EffectContextOf]` union | **DONE** | no `EffectContextOf` left under `apps/`; the symbol is now Nest-strict and the package spec covers it |
| Align every `serviceOver` shape with its real `R` | **DONE** | identity 8, fleet 21, runtime 4; mutation-proven (`Missing<[UserController, DatabasePort]>`, `Missing<[FleetController, FleetDatabasePort]>`) |
| Remove the legacy `[EffectContextOf]` union | **PLANNED** | after the last service migrates |

Health verification: `bun run type-check` clean (131 files); `bun run test` 13/13 (unit + both e2e; the boot spec calls
`/health` through the scoped context). Removing `HealthService` from the module fails at `main.ts` with
`Missing<[HealthController, HealthService]>`; restoring it is clean. `@deployer/nest-effect`: 9/9 tests, types build,
lint clean.

---

## 8. Caveats (measured, not guessed)

1. **Exports become load-bearing.** The flat context hid every missing import; nothing needed `exports` semantically
   before. Expect one `Missing<[Controller, Service]>` per real dependency. Budget it per service.
2. **The transitive closure inflates requirements.** `RequiredBy` is the handler's `R`, so a domain service drags in its
   repository, clock and ports. The principled fix is to erase `R` at the service boundary (a `Layer` per service,
   shape returns `Effect<A, E, never>`); until then, export the collaborators — or every controller lists the chain.
   The sample keeps this as a standing test: exporting `MeshDirectory` without `ReplicaStore` fails the root with
   `Missing<[DirectoryReaderController, ReplicaStore]>`.

   The same lesson bit every real service in a form the compiler could not see at first: **a port provided by the root
   is invisible to a child module**. `identity`, `project`, `fleet` and `runtime` each provided `DatabasePort` /
   `RuntimeDatabasePort` in the root module, and repositories yield it at call time (`serviceOver`), while their shapes
   declared `R = never` — so the audit passed and the first request 500'd with `Service not found: <svc>/DatabasePort`.
   e2e found it, and two things now keep it found: a global `DatabasePortModule`/`RuntimeDatabaseModule` per app, and the
   shapes themselves declaring the port (`EFF-306`). The gate proves it: un-globalising the module and dropping the
   module's extra key yields `Missing<[UserController, DatabasePort]>`, and fleet's mutation walks the whole chain
   (`Missing<[PlatformManagedWebController, FleetDb]>`).
3. **Existing `@Global()` modules are invisible to the types.** 23 modules carried `@Global()` with no type annotation
   (the audit's first count of six was wrong — the guard found the rest). Every one is now annotated, including the two
   with `static forRoot()` (`AppLifecycleModule`, `SupervisorsModule`), whose returned `DynamicModule` is annotated too.
   `scripts/check-global-modules.ts` fails when a `@Global()` class has no annotation, and CI runs
   `bun --bun run check:global-modules` next to the DI checks.
4. **24 call sites pass extra keys positionally.** `createGlobalModule` avoids touching them; an options argument would
   not.
5. **Dynamic modules and re-exports.** `exportedBy` resolves tokens against `ModulesContainer`; `forRoot()` modules and
   `forwardRef` cycles are handled by the `seen` set but must be smoke-tested per service.
6. **The runtime becomes stricter than today.** A handler that reaches a provider its module never imported works today
   and 500s after the flip. Types should catch it first; the scope report makes the diff visible before the switch.
7. **`context()` must survive.** Seeds, boot and `runPromise` callers are not requests. Two methods, two jobs.
8. **Specs.** Controller specs that mock `EffectContextOf` assert a call that no longer exists; `orpc-host.spec.ts` was
   updated for the new `resolve(executionContext, ...)` signature. Delete the mocks with the migration.
9. **Type-check cost.** Measured with `tsc --extendedDiagnostics`, full checks (`--incremental false`; the base config
   sets `incremental: true`, so a second run reports 0 instantiations and looks like a 10× regression):

   | workspace | before (HEAD) | after migration | Δ | check time |
   |---|---:|---:|---:|---:|
   | health | 3,886,826 | 3,905,693 | +0.5% | 11.2s → 8.9s |
   | fleet | 6,635,325 | 6,789,870 | +2.3% | 12.1s → 6.8s |
   | project | 6,998,290 | 7,284,840 | +4.1% | 11.4s → 13.8s |
   | runtime | — | 10,929,974 | — | 7.0s |
   | bff (no `createModuleContext`) | — | 15,754,345 | 0 | 22.1s |

   Peak memory unchanged (fleet 2.52 GB, project 2.24 GB, runtime 3.23 GB, bff 4.57 GB; 8 GB heap). The BFF dominates
   from contracts and zod, not from this model.
10. **`declareModule` is a trust boundary.** The boot-time claim check closes the obvious lie; a wrong `exports` claim
    is still only caught when a consumer uses the service.

---

## 9. Rollout

Additive at every step; a service can stop between any two steps.

| Phase | Work |
|---|---|
| 0 | **DONE** — package primitives, host plumbing, boot gate, health reference, the 23 global annotations |
| 1 | **DONE** — `mesh-agent`: 4 controllers, `contextFor` proven without a database |
| 2 | **DONE** — `identity`: 41 sites, the first global `DatabasePortModule` |
| 3 | **DONE** — `project`: 69 sites, 40 in one controller, measured |
| 4 | **DONE** — `runtime` (6 sites) and `fleet` (89 sites), both roots converted so the gate is live |
| 5 | **DONE (no-op)** — the BFF has no `.effect()` controllers |
| 6 | **DONE** — the legacy `[EffectContextOf]` union and every `.use(...)` site are gone; `procedure()` is the only path |

Per service:

1. `implement(` → `procedure(`, delete `.use(X[EffectContextOf])`.
2. Add `exports` where another module consumes a service; the compiler lists `Missing<[Controller, Service]>`.
3. Annotate `@Global()` modules (`createGlobalModule` / `declareModule(..., { global: true })`).
4. Flip the service's ORPC host to `contextFor`, after `EFFECT_SCOPE_REPORT=1` shows the diff.
5. `assertRequirementsMet(root)` in `main.ts`.

Order: `identity` → `project` → `runtime` → `fleet` → `bff` — all done. Types before runtime, per service, so the first
failure is a compile error and not a 500.

---

## 10. File map

```
packages/nest/effect/src/
  requirements.ts            procedure(), RequiredBy, UnmetOf, RequirementsMet, globals, assertRequirementsMet
  create-module-context.ts   the module facts, createGlobalModule, declareModule + claim validation
  effect-runtime.ts          context() (whole container) + contextFor(controller) + scopeReport()
  index.ts                   public surface

apps/api/shared/src/server/
  orpc-host.ts               extraContext.resolve(executionContext, ...deps)
  mesh-orpc-host.ts          same, for the mesh transport
  bootstrap.ts               rootModule: M & RequirementsMet<M>

apps/api/services/health/src/
  modules/health/health.module.ts             exports []: the domain's public surface + HealthRequirements
  modules/health/controllers/health.controller.ts  procedure(...).effect(...)
  app.module.ts                                resolve -> runtime.contextFor(executionContext.getClass())
  main.ts                                      assertRequirementsMet + EFFECT_SCOPE_REPORT

apps/api/services/node-agent/src/
  modules/mesh/procedures/*.procedures.ts      controllers without routes (procedure(...).effect(...))
  app.module.ts                                resolve -> runtime.contextFor(executionContext.getClass())
  main.ts                                      assertRequirementsMet

apps/api/services/{identity,project,fleet,runtime}/src/core/database/database.module.ts
                                               global DatabasePortModule / RuntimeDatabaseModule (root providers are
                                               invisible to child modules)

scripts/check-global-modules.ts                fails when a @Global() class has no type-level global marker
```

---

## 11. Open questions

- **Self-contained services — resolved, with one residual.** Every `serviceOver` shape now declares its real `R`
  (`EFF-306`), so the compiler catches a port that is neither global nor declared instead of e2e. The residual is
  analytics' stream tick: it runs inside a timer/Promise closure outside the request context, so its six procedures still
  show only `AnalyticsService` in `RequiredBy`. Making those ports visible would require capturing and providing the
  runtime context per tick — a behaviour change (the streams currently emit nothing), tracked separately.
- **`@Global()` drift.** Closed: `scripts/check-global-modules.ts` runs in CI and all 23 modules are annotated. A new
  `@Global()` class without the annotation fails the build instead of reporting a false `Missing`.
- **Dynamic-module visibility.** `forRoot()` modules are resolved by token; whether every shared `forRoot` exposes its
  providers under class tokens (rather than custom strings) needs a per-module audit before `fleet` flips.

---

## 12. Provider shapes are audited too (2026-10-31)

The requirement set is no longer controller-only. `RequirementsOf<M>` also includes `ProviderUnmet<M>`: for every provider
entry that is an Effect service tag (`{ provide: Tag, useValue: Tag.live }` or a bare tag), the union of `Collaborators<Tag>`
— the `R` of each shape member — must be visible to the module (own providers + imports' exports + globals at the root),
exactly like a controller's methods. A violation is a `[provider, services]` pair, so the root error reads
`Missing<[Typeof UserService, DatabasePort]>`.

Rules that make it sound:

- **Ambient is subtracted.** `CurrentActor | Correlation` are provided per request by the oRPC boundary, not by a module;
  counting them would flag every user-facing service.
- **A generic method's inferred `{}` is ignored.** `MeshBroker.call<A,E,R>` infers its `R` as `{}` in `Collaborators`;
  `Record<string, never>` is not a service identifier, so it is excluded.
- **Plain Nest modules need `declareModule` claims.** Type-level visibility only follows `[ExportsOf]`; a module that
  imports a plain `@Module` sees none of its exports. The global rollout surfaced one real case: `CoreDockerModule` was
  declared `{ global: true }` without `provides`/`exports`, so `DockerEngine` was invisible to `DockerContainersModule`.
  Its claims are now declared.
- **`useClass`/`useFactory` shapes are not inferred.** Only tag providers carry a shape the type system can read; a
  factory's returned object is opaque.

Proof: a probe provider whose shape yielded an unprovided service failed the build as
`Missing<[ProviderProbe, MissingProviderProbe]>`; a probe controller failed as
`Missing<[AuditProbeProcedures, MissingProbe]>`. Both were removed.

Coverage: every `createModuleContext` module in every app (health, identity, project, fleet, runtime, node-agent, BFF,
setup). Root type-check 116/116; suites: health 17, identity 247, project 181, fleet 292, runtime 528/530 (2 pre-existing
Docker/scanner e2e failures), bff 51, setup 162, node-agent 331.

---

## 13. Which module form, and why (2026-10-31)

Every module the repository owns is a context module; the audit is only sound when nothing slips past it.

| Module kind | Form | Reason |
|---|---|---|
| Owned, static metadata (Effect or not) | `createModuleContext` / `createGlobalModule` | exports derived from the metadata, requirement set typed, no claims to drift |
| Owned, `forRoot()` / runtime-computed `DynamicModule` | `declareModule(module, { provides, exports, global })` | the metadata is not a static literal, so it cannot be a context module (`SupervisorsModule`, `AppLifecycleModule`) |
| Third-party / opaque package | `declareModule` with complete claims | the only way to expose its exports to the type layer |
| `effect-runtime.module.ts` | plain `@Module` | it is the runtime host, not a consumer |

Migration result: 25 static `declareModule` wrappers became `createGlobalModule`, 41 plain `@Module` classes became
`createModuleContext` (including the ones with no Effect surface — config, clients, docker sub-modules, setup). Every
remaining `@Module` is dynamic by construction: `forRoot`/`forRootAsync` results now go through `declareModule`
(`PreflightModule`, `HealthModule`, `ServiceClientModule`, `SupervisorsModule`, `AppLifecycleModule`,
`WizardOrpcModule`, `MeshTransportModule`), `ServiceHealthModule` was static and is now a `createModuleContext`, and the
two exceptions are `AuthModule` (extends Nest's `ConfigurableModuleClass`, so its class cannot be wrapped) and
`EffectRuntimeModule` (the runtime host). `EffectRuntime` is untouched by this: it is provided once per app root
and injected only by out-of-request adapters, never by a domain service.

The DI gate reads module metadata in all three forms (`@Module(`, `createModuleContext(`, `createGlobalModule(`), so the
graph keeps being checked after the migration.

Coverage after the migration: root type-check 116/116, shared 859, node-agent 331, health 17, identity 247, project 181,
fleet 292, runtime 528/530 (2 pre-existing Docker/scanner e2e failures), bff 51, setup 162, nest-mesh 15.

---

## 14. The last bypass: `EffectRuntime` inside request services (2026-10-31)

The gate audits a handler's `R`. A service that runs its own Effects on the app-wide runtime returns a Promise, so nothing
it yields appears in any handler's `R` — the audit is blind to it. Seven files did this; two are legitimate
(`project`/`service` event adapters: out-of-request registration providers) and one is a stream persistence adapter.

Converted so far, runtime's activity reads:

- `DockerRuntimeActivity` (`Context.Service`, `serviceOver` over `DockerCatalog` + `DockerRuntimeActivities`) owns
  `snapshot`, `list`, `getById`. `DockerController`'s three handlers are now `procedure(...).effect(...)`, so
  `[DockerController, …]` includes `RuntimeDb`, `CatalogLocalPort`, `CatalogMeshPort` — proved by the gate failing first
  with `Missing<[DockerController, RuntimeDb] | [typeof DockerRuntimeActivity, CatalogLocalPort | CatalogMeshPort | RuntimeDb]>`
  until `DockerRepositoriesModule` exported `RuntimeDb` and `DockerRuntimeModule` imported `DockerCatalogModule`.
- `DockerRuntimeActivityDomainService` keeps only the RxJS streams (documented boundary), and lost its `EffectRuntime`.

Rule the conversion follows: **unary handlers go to Effect, streams stay RxJS.** A `procedure(...).effect(...)` needs an
Effect; these streams are Observables the controller hands to oRPC as async iterators, so converting them would change the
streaming boundary rather than the requirement flow.

Images, same pass: `DockerImages` (`serviceOver` over `DockerImageCatalogPort`, a port on the Promise
`DockerImagesApplicationService` — the auto-scan listener still runs it out of request), so `images.list` and
`images.inspect` declare it in their `R`. The orchestrator keeps its Promise methods because the still-unmigrated
`docker-entity` chain calls them.

Containers, same pass: `DockerContainers` (`serviceOver` over `DockerContainersPort`) exposes the 13 unary calls —
linked, actions.run, logs.list, processes.list, filesystem ×6, terminal open/send/close — so every one of those handlers
declares it in its `R`. Its shape is written out per method rather than derived with a conditional over the orchestrator's
keys: the conditional produced a `TYield` union `procedure(...).effect(...)` could not constrain. Streams
(`streamContainerLogs`, `streamContainerProcesses`, `streamContainerProcessLogs`, `streamContainerTerminalSession`) stay
on the orchestrator.

Entity, same pass: `DockerEntity` (`serviceOver` over `DockerEntityPort`, a port on `DockerEntityOrchestratorService`)
backs `entity.list` and `entity.inspect`, both of which now `yield*` it and map the `kind` switch inside the Effect.

What is left, and why:

- **`runtime-runner-registry`** — the Effect tag (`RuntimeRunnerRegistry`) already exists; only its Promise face is used, by
  the deployment workflow, which is itself Promise. It moves when that workflow does, not before.
- **`docker-entity-domain`'s catalog reads** — the pair of `effectRuntime.runPromise(DockerCatalog…)` calls still run inside
  the Promise domain service. The handler's `R` now names `DockerEntity`, so the facade is audited; this pair is one hop
  deeper. Draining it means giving the domain an Effect face, which is the same work as the remaining orchestrators.
- **`DockerRuntimeActivityPersistenceService`** — a stream persistence adapter, out of request by design.
