# `EffectHost` — one place a process starts Effect work

Date: 2026-11-01. Code: `packages/nest/effect/src/effect-host.ts`, `effect-host.module.ts`.

## The problem it replaces

Before this, every adapter that needed to run an Effect outside a request injected the Nest class:

```ts
constructor(private readonly runtime: EffectRuntime) {}
await this.runtime.runPromiseUnwrapped(Effect.gen(function* () { … }));
```

That works, and it is wrong in three ways that compound as the Effect migration grows:

1. **The runtime is a host detail, and it leaked into domain code.** `DockerEntityDomainService`, the container
   orchestrator and the runner registry all held it; the requirement audit cannot see collaborators reached through
   `runPromise`, so those services were outside the gate (`requirement-modules.md` §14).
2. **Shutdown had no owner.** A `setInterval` or a forked fiber started in a factory had no single place that could list
   what is running and interrupt it. Each adapter reinvented "start in a factory, stop in a hook".
3. **Tests had to fake a Nest class.** A spec that wanted to assert "the loop ran" mocked `runPromise`, which also erased
   the failures the adapter was supposed to handle.

## The service

```ts
export type EffectHostShape = {
  run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  runUnwrapped: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  fork: <E, R>(label: string, effect: Effect.Effect<void, E, R>) => () => Promise<void>;
  context: () => Promise<Context.Context<unknown>>;
  contextFor: (controller: unknown) => Context.Context<unknown>;
  size: () => number;
};
```

- `run` / `runUnwrapped` are the Promise boundary for an adapter that returns a Promise or an Observable (a stream, an
  edge provider, an event subscriber).
- `fork(label, effect)` starts a long-lived program and returns the stop: it interrupts the fiber and resolves when it is
  done. That is the only way a loop is started now.
- `context` / `contextFor` are what the transport needs to build a per-connection or per-request `effect/context`.
- `size()` is the fibre count, for the shutdown log and for tests.

`EffectHostModule` (`createGlobalModule`) provides it once per process. Global on purpose: the oRPC host injects
`EffectHost` **inside its own module factory**, and a root-module provider is not visible there — the first attempt failed
with `Nest can't resolve dependencies of the Symbol(ORPC_NEST_MODULE_CONFIG) (REQUEST, …, ?)`.

## How each call site changed

| Before | After |
|---|---|
| `createOrpcModule({ extraContext: { inject: [EffectRuntime], resolve: (ctx, runtime) => runtime.contextFor(…) } })` | `inject: [EffectHost]`, `resolve: (ctx, host) => host.contextFor(…)`; `EffectHostModule` imported by the root |
| `registerProjectEventAdapter(coreEventSync, runtime)` | `(coreEventSync, host)` → `host.run(…)` |
| `startPreviewTtlCleanup(runtime, interval)` with `setInterval` | `startPreviewTtlCleanup(host, interval)` → `host.fork("preview-ttl", Effect.repeat(tick, Schedule.spaced(interval)))`; the returned stop is awaited by the provider's `onModuleDestroy` |
| `startIngressDnsReconciler(runtime, interval)` | same shape, stop awaited by `onApplicationShutdown` |
| `CloudflareTunnelEdgeProvider(runtime)` | `@Inject(EffectHost)` + `host.runUnwrapped` |
| `DockerRuntimeActivityPersistenceService(runtime)` | `(events, host)` + `host.runUnwrapped` |
| `DockerRuntimeStreamOrchestratorService(runtime, …)` | `(events, host, …)`, no per-call runtime |
| `RuntimeRunnerRegistryService(runtime)` | `host.run(…)`; the `RuntimeRunnerRegistry` tag stays the only Effect face |
| `MeshTransportService(runtime)` | `host.runUnwrapped` + `host.context()`, provided by the transport module |

## What is a tag now, and what stays a boundary

Converted to `Context.Service` with `static live` (and the provider audit covers their shapes):

- `DockerContainersOrchestratorService` (was a `@Injectable` holding the runtime),
- `DockerEntityDomainService` and `DockerEntityOrchestratorService` (the domain's two `runPromise(DockerCatalog…)` calls
  are now `yield*`),
- `DockerContainerResolution` / `DockerContainerAccess` (their helpers no longer take a runtime),
- `DockerEntityCachePort` (new port over the Promise cache).

Deliberately still boundaries, not tags:

- the four Observable streams per domain (`containerStreamsOver(host)`, `entityStreamsOver(host)`) — RxJS at the edge,
  rebuilt from the Effect accessors;
- `DockerRuntimeActivityPersistenceService` — subscribes to an Observable shared with the domains;
- the runner registry's Promise face — the deployment workflow is still Promise.

## Rules

1. A domain service never injects `EffectRuntime`. It yields tags; a collaborator is visible or the build fails.
2. A boundary (transport, stream adapter, loop, edge provider) takes `EffectHost` and nothing else from the runtime.
3. A loop is `host.fork`, and the stop is awaited in the owning provider's destroy/shutdown hook.
4. `EffectRuntime` remains only in `EffectRuntimeModule` (the owner), `createModuleContext` internals, and the health
   service's `scopeReport()` migration report.

Current counts: `rg "EffectRuntime" apps/api/services` → comments plus `EffectRuntimeModule` and that one `scopeReport()`
call; zero injections.
