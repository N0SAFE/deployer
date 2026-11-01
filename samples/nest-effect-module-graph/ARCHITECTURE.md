# `createModuleContext`, chained

Design for replacing the optimistic service union in `@deployer/nest-effect` with a module
tree where **every module closes itself**: it declares the layers it owns, imports the
modules that provide what those layers need, and fails to compile when the chain is broken.
No global layer list, no app-wide runtime node.

Working PoC in this folder:

```bash
bun install
bun run check        # tsc (two live @ts-expect-error proofs) + bun test
bun run demo         # prints the tree, the per-node rows, the collected layers
```

---

## 1. The problem

`packages/nest/effect/src/create-module-context.ts` derives one type:

```ts
type Services = ProviderServices<M["providers"]> | ImportServices<M["imports"]> | ExtraServices<S>;
```

A union of **provided tokens**. Three gaps follow:

| Gap | Effect |
|---|---|
| A `Layer`'s `RIn` is never carried | A layer that needs `DatabasePort` compiles in a module that provides nothing. It fails inside `ManagedRuntime` on the first request that touches the service — or never. |
| `ImportServices` only reads classes built by `createModuleContext` | `EnvModule`, `HealthModule.forRoot()`, `EffectRuntimeModule.forRoot({ layers })` contribute nothing. Call sites compensate by hand-listing keys after the metadata, which is exactly the list that drifts. |
| The layer list lives on the runtime | `EffectRuntimeModule.forRoot({ layers: [UserLive, …] })` is a second place to declare what a module owns, and it is the only place that knows the requirements. The module that owns the layer knows neither its own `RIn` nor who provides it. |

Two facts about the current call sites make this worse: `identity` and `project` pass seven
keys to satisfy the type, and none of those keys is checked against the container.

---

## 2. Chaining, and whether it is possible

It is, because the requirement check does not need to see the whole app — only the node it
is written in. `Layer<ROut, E, RIn>` already says what the layer produces and consumes. What
was missing is that **`imports` must carry that type upward**, and that a module must be able
to satisfy its own `RIn` from what it imports or registers.

Three rules make it work:

1. **A module owns its layers.** Pass the layer to `createModuleContext` at the module that
   declares the service. It contributes `ROut` to the module's context and `RIn` to its
   requirements.
2. **Imports carry the graph.** A wrapped module's `provides` and `requires` are read from
   the imported value, not from its class name. Chaining is transitive: the root sees what
   the domain module imports, because the domain module's `provides` already includes it.
3. **A module closes itself.** `Missing = RIn(layers) - provides(own ∪ imports)`. There is no
   "assume an ancestor provides it": if the module does not import or register the service,
   it does not compile.

Two doors remain for code you do not control:

- `effectModule(ref, [Tags])` gives a plain Nest or `DynamicModule` import a typed surface —
  the only place a claim about someone else's providers is made, and it is verified against
  that module's own provider list immediately (Section 7).
- A layer whose requirement crosses a module boundary must be satisfied by a **Nest token**
  the imported module registers (`useValue` / `useExisting` / `useClass`), not by another
  module's layer output. A `Layer` is opaque at runtime, so no one can order two modules'
  layers. Crossing through a token is what makes the chain orderable — and it is what the
  repo already does with ports (`DatabasePort`, `HealthRegistry`).

What chaining does **not** fix: `DynamicModule` factories stay type-opaque unless wrapped,
and two modules whose layers depend on each other's *outputs* cannot be ordered (import them
as tokens instead).

---

## 3. The node

Each module created by `createModuleContext` publishes one node:

```ts
interface ModuleGraph {
  readonly name: string;                  // "HealthDomainModule"
  readonly provides: readonly string[];   // Context.Service tokens registered here
  readonly ambient: readonly string[];    // keys visible here only, never importable
  readonly layers: readonly AnyLayer[];   // layers this module owns
  readonly imports: readonly ModuleGraph[];
  readonly opaque: boolean;               // imported without effectModule: no types
}
```

plus the type-only halves:

```ts
interface EffectGraph<P = never, R = never> extends ModuleGraph {
  readonly [Provided]?: P;
  readonly [Required]?: R;
}
```

`provides` is runtime truth, read from Nest's `providers` metadata (so a `DynamicModule`
factory is visible too). `P`/`R` are type truth, inferred from layers. Both live under one
symbol on the module value, so a node cannot drift from its graph.

Extras are **not** a second providers list. They are:

| Extra | Meaning | In `P` | In `R` | Importable |
|---|---|---|---|---|
| `Layer<A, E, R>` | "this module owns this service" | `A` | `R` | yes |
| `ServiceKey` | ambient: request-scoped, e.g. an actor | no | no | no |
| `EffectContext<S>` | ambient, already typed | no | no | no |

The ambient column is deliberate. An actor or correlation id is put in the request context by
the oRPC middleware, not by a module. It belongs in this module's context and nowhere else,
and it must not silence a missing layer requirement — otherwise the hand-written key lists
come back through the other door.

---

## 4. Type-level resolution

```ts
type ProviderProvided<P> = /* Context.Service tokens in M["providers"] */;
type ImportProvided<I>   = /* GraphProvided<GraphOf<E>> for each import */;

type NodeProvides<M, S> =
  | ProviderProvided<M["providers"]>
  | ImportProvided<M["imports"]>
  | LayerProvided<LayerExtra<S>>;              // ROut of each layer extra

type NodeAmbient<S> = IdentifierOf<KeyExtra<S>> | ContextOfExtras<S>;
type NodeContext<M, S> = NodeProvides<M, S> | NodeAmbient<S>;

type NodeRequirements<S> = LayerRequired<LayerExtra<S>>;      // RIn of each layer extra
type MissingServices<M, S> = Exclude<NodeRequirements<S>, NodeProvides<M, S>>;
```

`Layer<ROut, E, RIn>` supplies both halves; nothing is restated:

```ts
type LayerProvided<L> = L extends Layer.Layer<infer A, any, any> ? A : never;   // ROut
type LayerRequired<L> = L extends Layer.Layer<any, any, infer R> ? R : never;   // RIn
```

Imports are read through the node, never the class name, so `DynamicModule` works when its
factory returns a node:

```ts
type GraphOf<E> =
  E extends EffectGraphNode<infer P, infer R> ? EffectGraph<P, R>
  : E extends { readonly module: infer M }
    ? M extends EffectGraphNode<infer P, infer R> ? EffectGraph<P, R> : never
    : never;
```

The context a handler gets is `NodeContext` — provides plus ambient; the check runs against
`NodeProvides` only. That is why a bare key cannot satisfy a requirement.

---

## 5. The compile-time failure

TypeScript has no `static_assert`, and `Missing extends never` reports `never`. The trick
that keeps the service name is a phantom required property on the metadata parameter:

```ts
type MissingCheck<M, S> =
  [MissingServices<M, S>] extends [never]
    ? unknown
    : { readonly __missingEffectProviders: MissingServices<M, S> };

export function createModuleContext<M extends ModuleMetadata, S extends readonly ModuleExtra[] = []>(
  metadata: M & MissingCheck<M, S>,
  ...extras: S
) { … }
```

No caller writes `__missingEffectProviders`, so the argument no longer satisfies the
parameter and TypeScript prints the missing types. Real output from this PoC:

```
error TS2345: Argument of type '{ name: "LeafWithoutImport"; }' is not assignable to
  parameter of type '{ readonly name: "LeafWithoutImport"; } &
  { readonly __missingEffectProviders: HealthRegistry; }'.
  Property '__missingEffectProviders' is missing in type
  '{ name: "LeafWithoutImport"; }' but required in type
  '{ readonly __missingEffectProviders: HealthRegistry; }'.
```

The service appears by class name, at the definition site: the module the developer is
already editing.

`name` is a `createModuleContext` concern and is stripped before `@Module()` (Nest rejects
unknown metadata keys):

```ts
const { name: moduleName, ...nest } = metadata;
Module({ ...nest, providers })(EffectContextModule);
```

Rejected alternative: a required second argument carrying the error string. It forces every
call site to write a magic value and reads as a different API.

---

## 6. Layers belong to the module

`createModuleContext` appends the module's layers to its Nest providers under one token:

```ts
const providers = layers.length === 0
  ? nest.providers ?? []
  : [...(nest.providers ?? []), { provide: EFFECT_MODULE_LAYERS, useValue: layers }];
```

`EffectRuntime` collects those tokens from the container (the same `DiscoveryService` walk it
already does for providers whose token is a `Context.Service`) and builds them over the
discovered services:

```ts
const discovered = collectEffectLayer(discovery);          // existing
const contributed = Layer.mergeAll(...collectModuleLayers(discovery)); // replaces forRoot({ layers })
Layer.provideMerge(contributed, discovered);
```

Consequences:

- `EffectRuntimeModule.forRoot({ layers })` is **deleted**. A layer is declared once, in the
  module that owns it, typed where it is declared.
- A module's layer requirement is satisfied by discovered tokens, i.e. by another module's
  `providers` (Section 2, rule 2). Layers are never ordered across modules; if the dependency
  must cross a boundary, expose it as a token (`{ provide: Port, useExisting: Service }`).
- Within one module, compose the layers yourself (`ProjectLive`) so their order is the
  module's problem, not the runtime's.
- `Runtime` builds lazily as today; the first request still pays the build. Make the build
  eager in `onApplicationBootstrap` if a bad layer should fail at startup instead.

---

## 7. Modules you do not own

`effectModule` is the adapter, not a registry:

```ts
effectModule(HealthModule.forRoot({ indicators: "platform" }), [HealthRegistry]);
effectModule(PlainLifecycleModule, [AppLifecycle]);
```

It returns the same value (class or `DynamicModule`) with a node attached, and checks the
claim **at definition time** against the module's own provider list:

```
Error: effectModule(AppLifecycleModule.forRoot()): declares health/HealthService
       but the module registers lifecycle/AppLifecycle
```

Rules:

- Declare only tokens that module registers directly. A re-exported provider is declared
  where it is registered.
- The node's `provides` is the declared list, and the declared list has just been verified.
  Adapters therefore cannot lie, which is why no boot check is needed.
- Opaque (unwrapped) imports are still shown in the tree with `??`: their tokens are read at
  runtime, but nothing may be `yield*`ed from them.

---

## 8. Which check fires where

| Question | When | Mechanism |
|---|---|---|
| May a handler `yield*` this service? | compile, at `.use(Module[EffectContextOf])` | `EffectContext<NodeContext>` |
| Is a layer's `RIn` provided here? | compile, at `createModuleContext` | `MissingCheck` |
| Does the import chain actually supply it? | compile, same site | `NodeProvides` includes imports |
| Does an adapter's claim hold? | definition time | `effectModule` compares declared vs registered |
| Which provider exists at which point? | any time | `describeEffectModuleTree` |
| In what order will layers build? | runtime | `moduleLayers` in tree order |

Everything except the runtime build is static. There is no boot walk and no app-wide service
registry; the class definition is the contract.

---

## 9. Adoption in `@deployer/nest-effect`

**New file** `packages/nest/effect/src/effect-module-graph.ts`: symbols, `ModuleGraph`,
`EffectGraph`, `EffectGraphNode`, `AnyLayer`, `LayerProvided`, `LayerRequired`,
`EFFECT_MODULE_LAYERS`, `describeEffectModuleTree`, `effectModuleTreeText`, `moduleLayers`.
This is `src/effect-graph.ts` of the PoC, plus the package's `import "reflect-metadata"`.

**`create-module-context.ts`**

```diff
-export function createModuleContext<const M extends ModuleMetadata, const S extends readonly (ServiceKey | EffectContext<unknown>)[] = []>(
-  metadata: M, ..._services: S) {
-  type Services = ProviderServices<M["providers"]> | ImportServices<M["imports"]> | ExtraServices<S>;
+export function createModuleContext<const M extends ModuleMetadata & { readonly name?: string }, const S extends readonly ModuleExtra[] = []>(
+  metadata: M & MissingCheck<M, S>, ...extras: S) {
+  type Services = NodeProvides<M, S>;
+  type Context = NodeContext<M, S>;
```

Registered class gains `[EffectGraphOf]` next to `[EffectContextOf]`, and appends the
`EFFECT_MODULE_LAYERS` provider.

**`effect-runtime.module.ts`** — delete `forRoot({ layers })` and its token. `forRoot()` keeps
only `imports`/global wiring; there is no layer option left. (v3 has no compatibility layers,
so this is a removal, not a deprecation.)

**`effect-runtime.ts`** — replace `EFFECT_RUNTIME_LAYERS` with a discovery walk over the
`EFFECT_MODULE_LAYERS` providers; keep the existing `Layer.provideMerge(contributed,
discovered)` direction. Optional: `await this.context()` in `onApplicationBootstrap` to fail
fast.

**`effectModule`** — export from the package. Call sites that wrap `HealthModule.forRoot()`,
`EnvModule`, `DatabaseModule` declare the tokens they actually use; a wrong tag throws at
import time.

### Call sites

`health` today:

```ts
export class HealthDomainModule extends createModuleContext({
  imports: [HealthModule.forRoot({ indicators: "platform" })],
  controllers: [HealthController],
  providers: [
    { provide: HealthRegistryRepository, useExisting: HealthRegistry },
    { provide: HealthService, useValue: HealthService.live },
  ],
}) {}
```

→

```ts
export class HealthDomainModule extends createModuleContext(
  {
    name: "HealthDomainModule",
    // The shared registry is a module we do not own: give it a typed face.
    imports: [effectModule(HealthModule.forRoot({ indicators: "platform" }), [HealthRegistry])],
    controllers: [HealthController],
  },
  HealthLive, // Layer<HealthService, never, HealthRegistry>
) {}
```

The `useExisting` alias and the hand-written `useValue` entry disappear: `HealthRegistry` is
declared where it is registered, and the layer states what it needs. The PoC keeps the
two-module variant (`HealthRegistryModule` → `HealthDomainModule`) as the generic case, for
when the provider lives in a module of your own.

`identity` / `project` — the seven-key list becomes the layer plus an import:

```ts
export class ProjectDomainModule extends createModuleContext(
  {
    name: "ProjectDomainModule",
    imports: [DatabasePortModule, ConfigurationCoreModule, EventsModule, CoreDomainModule],
    controllers: [ProjectController],
  },
  ProjectLive,   // Layer<stores + use cases, E, DatabasePort | …>
) {}
```

Ports that the app root used to register (`{ provide: DatabasePort, useExisting:
GlobalDatabaseService }` in `identity/src/app.module.ts`) move into a `DatabasePortModule`
that the domain imports. That is the whole migration: **a port becomes a module**.

---

## 10. Limits

1. **`RIn` only exists on layer values.** A `useFactory` that builds a layer internally is
   invisible. Pass the layer, or accept a runtime-only check.
2. **`DynamicModule` factories need `effectModule`** for their tokens to be visible to types.
   Unwrapped they appear as `??` with runtime-read tokens and contribute nothing to the
   context.
3. **Layer-to-layer dependencies cannot cross a module boundary.** A `Layer` is opaque at
   runtime, so `EffectRuntime` cannot order two modules' layers. Cross boundaries through a
   Nest token (`useValue` / `useExisting`).
4. **`useExisting` registers the alias.** The underlying token must be registered too; the
   graph reports what Nest registers.
5. **Import cycles** are not detected at the type level (TypeScript handles the recursion).
   Nest fails at boot; the tree makes the cycle visible.
6. **Ambient keys are unchecked** by design: they are request-scoped, provable only per
   request. Keep them to actor/request facts, never to ports.
7. **The graph is a tree, not a DAG.** A module imported twice appears twice, under two paths.
   That is intended — "at which point" is path-dependent.

---

## 11. Relation to the `AppLive` target

`docs/audit-2026-10-25/effect-target-architecture.md` wants one explicit `MainLive`/`AppLive`
where a missing requirement fails at `Layer.launch`. This design is the bridge with the same
sets, resolved per module: a module's `R` is the `RIn` of the layers it owns, its `P` is what
it provides, and its imports are what make `R ⊆ P`. When `AppLive` lands, the tree becomes
the per-module view of the same layer set — and `describeEffectModuleTree` stays the fastest
answer to "where does this service come from?".

---

## 12. Files in this PoC

```
src/effect-graph.ts                  the architecture (no framework coupling beyond @Module)
src/demo/health.service.ts           tags + HealthLive (Layer<HealthService, never, HealthRegistry>)
src/demo/health-registry.module.ts   leaf: owns the registry token
src/demo/health.module.ts            chains itself: imports the registry, owns the service layer
src/demo/lifecycle.module.ts         forRoot() DynamicModule + plain class (adapter demos)
src/demo/app.module.ts               root: imports only, closes by inheritance
src/main.ts                          tree, per-node rows, collected layers, ambient
test/module-graph.test.ts            runtime graph, layer registration, adapter verification
test/requirements.type-check.ts      compile proofs, run by `bun run type-check`
```

`test/requirements.type-check.ts` is the contract: its two `@ts-expect-error` directives
fail as *unused* if the check ever stops firing, including the one proving that an ambient
key cannot substitute for an import.
