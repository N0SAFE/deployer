# Requirement modules — a sample

A NestJS + oRPC + Effect app where **`.effect()` returns the Effect services its body uses**, modules follow Nest's
visibility rules (own providers + imports' exports), and the composition root does not compile while anything is unmet.

Open `caveats.html` in a browser for the interactive rollout review (10 caveats, one widget each).

```bash
bun run test:requirements         # runtime + typecheck, 45 tests
bun run test:requirements:types   # typecheck only (type tests)
bun run type-check:requirements   # tsc, the same files without the runner
bun run start:requirements        # boots on :3100
```

## The architecture gate, on four fixtures

`gate-demo/` shows the repo's module-graph gate (`bun run lint:architecture` at the monorepo root) running under
`bun lint` on the TypeScript 7.1 API. The rules are enabled in this folder's own `eslint.config.mjs` (the nearest flat config, so editors pick it up), so
`gate-demo/` fails on purpose (14 findings: the module side, plus the provider/controller files where the missing service is used):

```bash
bun run lint:requirements
```

The rules are TypeScript in `tooling/eslint/src/rules/`; this folder loads the built `tooling/eslint/dist/architecture.mjs`
(Node ESLint cannot import TypeScript), so run `bun run build` in `tooling/eslint` after changing a rule.

### In the editor

Open the folder and install the ESLint extension: ESLint 10 reads the nearest `eslint.config.mjs`, so no setting is needed.
Errors appear in **two places for one mistake** — on the module entry that lacks the dependency (`gate-demo/*.module.ts`),
and on each use of it in the provider's own file (`src/modules/mesh/services/directory.service.ts`).

The facts come from disk, so they refresh when you **save** (the rule re-reads them when a file it was built from changed);
unsaved edits are not reflected until then. The first lint of a session takes ~1–2 s for this demo.

| Fixture | Expected |
|---|---|
| `consumer-ok.module.ts` | clean — imports the module that exports what its controller yields |
| `declared.module.ts` | clean — a plain `@Module` wrapped with `declareModule` |
| `consumer-missing-import.module.ts` | `requirementFlow`: `DirectoryReaderController` needs `MeshDirectory` and `ReplicaStore` (one finding each) |
| `directory-without-store.module.ts` | `requirementFlow`, at both ends: on `DirectoryReaderController` in the module, and on each use of `ReplicaStore` inside `MeshDirectory`'s own file (`directory.service.ts`) |
| `broken-exports.module.ts` | `requirementFlow`: `LeaseSigner` exported but not provided or imported (`unknownExport`); `MeshClock` provided twice (`duplicateProvider`) |
| `unicode-positions.module.ts` | `requirementFlow`: the same gap as `consumer-missing-import`, after accents/emoji/CJK on the same line — positions must stay exact |
| `legacy.module.ts` | `requireModuleContext`: bare `@Module` |

`MeshClock` / `LeaseSigner` are never reported: `PlatformModule` is global, and the gate subtracts globals like the
root type check does.

## The four rules

1. **An endpoint's requirements are its body.**

   ```ts
   procedure(directoryContract.register)
     .effect(function* ({ input }) {
       const directory = yield* MeshDirectory;   // requirements = MeshDirectory | ReplicaStore | MeshClock | LeaseSigner
       return yield* directory.register(input);
     });
   ```

   `procedure()` mirrors `implement()`'s generics exactly — `TContract extends RouterContract`,
   `TInitialContext extends Context = DefaultInitialContext`, `config?: ProcedureConfig` — and returns
   `RequirementImplementer<TContract, TInitialContext & object>`. A router contract stays a router (`procedure(router)`
   maps every procedure key, nested routers included), and `$context()` / `$config()` keep the typed `.effect`.

   What differs is only `.effect()`: it returns the `R` of everything the handler yields, carried in the procedure's
   type. Nothing is declared, nothing drifts from the body, and `.use(middleware)` keeps the same typing at every step.
   The handler is a plain generator, so yielding several services directly needs no `Effect.gen` wrapper.

2. **A module follows Nest's visibility rules.**

   ```ts
   export const MeshDomainModule = createModuleContext({
     imports: [PlatformModule],                       // MeshClock + LeaseSigner come from its exports
     controllers: [MeshDirectoryController, MeshRelayController],
     providers: [{ provide: MeshDirectory, useValue: MeshDirectory.live }, ...],
     exports: [MeshDirectory],                        // what its importers may use
   });

   export type MeshRequirements = UnmetOf<typeof MeshDomainModule>; // never
   ```

   | Visible to a module's controllers | Not visible |
   |---|---|
   | its own `providers` | a sibling's providers |
   | the `exports` of the modules it `imports` | a **parent's** providers |
   | what an imported module **re-exports** (`exports: [SomeModule]`) | an import's un-exported providers |
   | the `exports` of every **global** module | |

   A module cannot be fixed by its importer: if it needs a service, it imports the module that exports it. `UnmetOf<M>`
   is therefore `ControllerNeeds<M> - Visible<M>`, and the root's set is its own plus everything its subtree could not
   resolve — never a subtraction.

   `createModuleContext<const M, const S>(metadata): RequirementModule<M, S>` keeps `M` as a type parameter, so the
   requirement set is **computed from the metadata** — a pure type function, no static fields, no runtime registry. A
   wrapper keeps the generic:

   ```ts
   const withMetadata = <const M extends MetadataInput>(metadata: M) => createModuleContext(metadata);
   const App = withMetadata({ imports: [PlatformModule, MeshDomainModule] });
   ```

3. **The composition root resolves, and is checked.**

   ```ts
   const rootModule = assertRequirementsMet(AppModule); // main.ts
   ```

   `assertRequirementsMet` takes `M & RequirementsMet<M>`. A missing service is a type error naming it:
   `Missing<MeshClock>`. When everything resolves it is the identity — there is nothing to forget at runtime.

4. **Globals are explicit, and they are globals at runtime too.**

   ```ts
   export const PlatformModule = declareModule(PlatformNestModule, {
     provides: [MeshClock, LeaseSigner],
     global: true,                      // type-side marker *and* Nest's `@Global()`
   });

   createModuleContext({ ... }, { global: true }); // same, for a module you own
   ```

   A module's `UnmetOf` still lists what it cannot resolve — a module does not know the app's globals — and the
   composition root, the only place that sees the whole tree, subtracts them (`ResolveGlobals`). The option also applies
   `@Global()` to the class, because the runtime reads `Module.isGlobal` to scope request contexts; a type-only global
   would compile and then fail at runtime.

5. **Foreign modules join by annotation, unmodified.**

   ```ts
   @Module({ providers: [{ provide: MeshClock, useValue: MeshClock.live }], exports: [MeshClock] })
   class PlatformNestModule {}

   export const PlatformModule = declareModule(PlatformNestModule, { provides: [MeshClock] });
   ```

   `declareModule` is a type annotation plus one runtime guarantee: every claimed `provides` token is checked against the
   module's Nest metadata, so a lie throws when the module file is imported instead of failing on the first request.
   `exports` defaults to `provides`, which is what a module that hands on its providers does. No `requires`: a module's
   needs come from its own controllers, which a foreign module's type does not expose. The module keeps its `@Module`,
   providers and exports untouched.

6. **The runtime context is scoped exactly like the types.**

   ```ts
   // app.module.ts — the ORPC context is chosen per controller, not per app
   context: (executionContext: ExecutionContext) => ({
     "effect/context": runtime.contextFor(executionContext.getClass()),
   }),
   ```

   `EffectRuntime.contextFor(controller)` looks up the `Module` that owns the controller and builds its context from
   `module.providers`, the `exports` of its imports (re-exports resolved), and the `exports` of every module where
   `isGlobal` is true. A controller whose module never imported a service cannot reach it — the same rule `UnmetOf`
   enforces at compile time, enforced again at runtime from Nest's own graph.

   ```ts
   export type AppServices = AllServicesOfModule<typeof AppModule>; // every provider in the tree
   export type ForControllers = ModuleServices<typeof MeshDomainModule>; // what one module can yield
   ```

   Before flipping a service, ask what changes: `EFFECT_SCOPE_REPORT=1` logs, per controller, the services that are
   registered in the container but outside its module scope — exactly the set that will start failing.

   Derive it where you consume it, never inside the root: a type-level reference from the root back to its own derived
   type is a cycle, and TypeScript silently degrades inference to the constraint — which is how an inline `imports: [...]`
   ends up rejected.

## The types

| Type | Meaning |
|---|---|
| `RequirementModule<M, S>` | a Nest class + `[EffectContextOf]`, `[ExportsOf]`, `[UnmetRequirementsOf]`, `[AllServicesOf]` (all type-only) |
| `UnmetOf<typeof M>` | what the module and its subtree could not resolve (globals included, until the root) |
| `GlobalServices<typeof M>` | the exports of every global module in the subtree |
| `declareModule(M, { provides, exports })` | brings a foreign Nest module into the flow, type-only |
| `procedure(contract, config?).effect(handler)` | `implement()` whose `.effect()` returns the handler's requirements |
| `ModuleServices<typeof M>` | what its own controllers can `yield*` (providers + imports' exports) |
| `AllServicesOfModule<typeof M>` | every provider in its subtree — the container the runtime builds |
| `RequirementsMet<M>` | `M`, or `Missing<U>` when a requirement is unmet |
| `RequiredBy<P>` | the services a procedure declared, read off its context type |

## Layout

```
src/
  main.ts                         assertRequirementsMet(AppModule) then listen
  app.module.ts                   imports only: ORPC, EffectRuntime, Mesh
  requirements.test.ts            runtime: metadata, identity, middleware guard, HTTP round-trip
  requirements.test-d.ts          the type contract: derivation, narrowing, the root gate, annotations
  vitest.config.ts                runtime include + `typecheck.include: **/*.test-d.ts`
  test-setup.ts                   reflect-metadata + the oRPC effect extension
  effect/
    requirements.ts               procedure(), RequiredBy, UnmetOf, RequirementsMet, requires() (optional guard)
    create-module-context.ts      RequirementModule<M, S>: providers, imports, exports, unmet needs
    effect-runtime.ts             Nest providers -> one Effect context
  modules/
    platform/                     provides MeshClock + LeaseSigner, global (no controller)
    audit/                        a branch nobody imports (runtime scoping witness)
    consumer/                     imports the mesh, uses only what it exports
    mesh/                         provides the directory, imports the platform it depends on
      controllers/                thin: `procedure(contract).effect(body)`, requirements inferred
      services/                   Effect services whose methods declare their own collaborators
      contracts/
```

## Tests

`requirements.test.ts` proves the mechanism changes nothing at runtime: the factory hands Nest the metadata it was
given, `declareModule` and `assertRequirementsMet` are identity, `requires()` still rejects a request without
`effect/context` and forwards the context untouched, and the whole app serves a real request.

`requirements.test-d.ts` proves the type contract with `expectTypeOf` / `toEqualTypeOf`: what a module sees (own
providers, imports' exports, re-exports, and the two things it must *not* see — an import's private providers and a
parent's providers), what each endpoint's body declares, that the root gate is callable only when resolved, that a
generic wrapper keeps the requirement set, and how a foreign annotation contributes.

The suite is mutation-checked: removing a provider turns both files red (type assertions, metadata count, and the HTTP
test — 500 instead of 200). The same holds for exports: drop `ReplicaStore` from `MeshModule.exports` and the root stops
compiling with `Missing<[DirectoryReaderController, ReplicaStore]>`, because the consumer's handler runs
`MeshDirectory`'s methods. `requirements.test-d.ts` keeps that case as a standing assertion.

## Why `procedure()` and not a global `.effect` override

A `declare module "@orpc/server"` overload was the first attempt. It works only while the package's own `.effect`
signature is *inapplicable* — which is true for `implement(contract).effect(...)`, and stops being true the moment a
middleware injects `effect/context`, because then the package's signature is applicable again and wins overload
resolution:

```
procedure(contract).use(requires(X)).effect(...)  // markers absent, RequiredBy = never
procedure(contract).effect(...)                   // marker present
```

That silent difference is worse than a wrapper. `procedure()` is our signature in every position, at the cost of one
import (`procedure` instead of `implement`).

## Diagnostics

The unmet set pairs each service with the controller that needs it, so the error names both:

```
Type 'RequirementModule<{...}>' is not assignable to type 'Missing<[MeshRelayController, MeshRelay]>'.
```

The pair matters under Nest semantics: a parent cannot fix a child, so the service name alone would send you to the
wrong file. An error at the composition root means *"some module declares a controller that uses this and provides it
nowhere"*, and the pair says which one.

Unmet requirements surface at the root because they are types, not expressions: a module with a hole is still a valid
Nest module, and only an assertion fails. To get the error at the module's own definition instead, wrap it:

```ts
export const MeshDomainModule = assertRequirementsMet(createModuleContext({ ... }));
```

`assertRequirementsMet(AppModule)` prints the module type twice (parameter and argument). When you want the shortest
message, assert through the type instead — same check, one line:

```ts
const rootModule: RequirementsMet<typeof AppModule> = AppModule;
// Type 'RequirementModule<{...}>' is not assignable to type 'Missing<LeaseSigner>'.
```

Identifiers, not `"demo/MeshClock"` strings: `Collaborators` derives requirements from an Effect `R` union, which only
carries identifiers. Declared services could keep their tags, collaborators cannot — mixing both would be worse.

## Why it holds

- The only per-endpoint input is the handler: `.effect(body)` infers its requirements, so there is no
  `.use(Module[EffectContextOf])` and no `requires(...)` to keep in sync with the provider list.
- The declaration is checked twice: the handler cannot use undeclared services, and the root cannot be asserted while a
  requirement is unresolved.
- Requirements are visible where they belong (`MeshRequirements` next to the module, `Missing<…>` at the root), instead
  of being spread across every controller.
