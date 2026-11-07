# The service-call layer, migrated to Effect — closure plan

Scope: every piece that reaches one service from another — the BFF's fan-out, the services' own gateways and the code under
both. It is planned as a **closure**: starting at any piece, everything that depends on it and everything it depends on moves in
the same change set, and the old shape is deleted in it, not kept beside the new one (`v3/AGENTS.md`: no temporary compatibility
layers). A step that would leave a Promise path alive has to name the process boundary that forces it, or it is not allowed.

Why this note was rewritten: the first version migrated the BFF outward only, kept `AsyncLocalStorage`, `BaseClient`, the Promise
registry and `.handler(async …)` at the CLI edge "for later", and never looked at the second copy of the same client layer in
`apps/api/shared`. That is the surface-only change this note now forbids.

## 1. The closure

There are **two parallel Promise client layers** doing the same job, plus the 330 generated handlers on one of them.

| Layer | Where | Depends on | Depended on by |
|---|---|---|---|
| **A. BFF registry** | `apps/api/bff/src/clients/service-registry.ts` (`ServiceClientRegistry extends PackageRegistry`, `.for`, `.describeCatalog`) | `@deployer/service-client` registry, `@deployer/mesh-client` (`nodeAgentLink`, `serviceLink`), `@deployer/env` (`API_SERVICES`), ALS credentials | `service-client.module.ts`, `service-clients.module.ts`, the 21 generated delegation files (through a `client` getter that calls `.for`), `managed-web.client.ts`, `analytics-read.service.ts`, `orchestration.module.ts`, `platform-console.module.ts`, `delegation.module.ts`, `node-agent/src/boot/service-clients.spec.ts` |
| A′. Typed client classes | `apps/api/bff/src/clients/{fleet,health,identity,project,runtime}/*.client.ts` (6 classes, `@Injectable`, `BaseClient` subclasses) | `BaseClient`, `FlatLeaves`, `collectContractLeaves` (`packages/service-client`) | `screen-read.service.ts`, `orchestration.module.ts` |
| A″. Caller credentials | `service-auth-context.ts` + `.edge.ts` (AsyncLocalStorage, seeded by an Express edge) | `AsyncLocalStorage` | the registry's `headers()` and `link()` options, `bff/src/main.ts`, `bff/src/e2e/runtime.ts` |
| **B. Services' client** | `apps/api/shared/src/server/service-client.ts` (`ServiceClient`, `ServiceClientShape`: `clientFor`, `systemActorClientFor`, `ServiceClientModule`) | `@deployer/mesh-client`, `OpenAPILink`, `@deployer/env` | fleet `SystemActorClients` port (→ `step-up.gateway`, `deployment-trigger.gateway`), project `dns-provider.gateway`, shared `ApprovalGuard` (project, runtime-docker, shared module), `fleet/providers.module`, `fleet/secrets.module`, `project/app.module`, `runtime/docker.module` |
| C. Package | `packages/service-client` (`BaseClient`, `ServiceClientRegistry`, `contract-leaves`, `FlatLeaves`, `callService`, `normalize-error-response`, `reviveDates`, `ServiceUnreachable`) | oRPC, Effect | A, A′, node-agent spec; `packages/mesh/service` uses `reviveDates` only (stays) |
| D. Generated handlers | `bff/src/modules/delegation/generated/*.delegation.ts` (21 files, 330 handlers, `implement(c).handler(...)`) + `scripts/gen-bff-delegation.py` | A | `delegation.module.ts`; the web through the contracts |
| E. Hand-written BFF | orchestration controller (7 handlers), console-control controller (6), `domains/setup` controller (1); services `CliAuthService` (544), `OverviewCompor so oser` (321), `ScreenRead` (148), `AnalyticsRead` (60), `ManagedWebClient` (61), `PlatformHealthService` | A, A′, A″ | the BFF's HTTP surface, the CLI |
| F. Surface lists | `apps/api/bff/src/orpc/service-surface.ts`, `apps/web/src/lib/orpc/service-surface.ts`, `scripts/check-service-surface-parity.py` | contracts | web routing |

Two things are already Effect and are reused, not rewritten: `callService` (one outgoing call as an Effect, interrupt-aware,
`ServiceUnreachable`) and `procedure()` / `effectMiddleware` (the request boundary).

**No forwarding layer anywhere in this change set** (`docs/architecture/service-implementation-rule.md`, normative). The BFF's new
gateways are `live` classes whose methods *are* the call — not a class that builds a `Ports` record of clients and delegates each
method to an `implOverPorts(ports)` function returning the same shape. The same ban applies to every service file this plan
touches (step 6): a `Ports` record, `portsOf`, `implOverX(deps)` and a single-use `<X>Ports` union are all conversions left
unfinished. What stays allowed: a plain function with no collaborators, and a `private` helper on `live` shared by several
operations (`Effect.gen({ self: this }, …)` to keep `this`).

## 2. Decisions (made; they are not left to the operator)

1. **One client layer, not two.** A and B collapse into one `ServiceClients` tag in `@deployer/service-client`. The BFF and every
   service provide it with their own *transport* (origin resolver + optional agent link); the call logic, the failure type and the
   credentials contract are written once. `ServiceClientShape`, `ServiceClientModule`, the `SystemActorClients` port, the BFF's
   `ServiceClientRegistry` and `BaseClient` are all deleted.
2. **Credentials move into the Effect context. `AsyncLocalStorage` is deleted.** The three reasons the old note kept it do not
   survive scrutiny:
   - *Cached clients.* The client is cached, but the credentials are passed **per call** as the oRPC client `context`
     (`client.x(input, { context: { headers } })`), which the link reads on that call. Caching and per-caller headers are
     independent; no AsyncLocalStorage is needed for it, and the cross-caller leak the ALS comment warns about becomes
     structurally impossible (a call without credentials has no headers, not "whoever was last in the store").
   - *Code outside a handler* (CLI, bootstrap, supervisors) has no request, so it provides its own credentials explicitly
     (`CallerCredentials.none` or `.system(claim)`). That is better than an implicit empty store: it is visible at the call site.
   - *Seeding at the edge* is replaced by a middleware, `provideCallerCredentials()`, that reads the cookie, `authorization` and
     API key off the request and provides `CallerCredentials` to the rest of the pipeline. The generator emits it on every
     delegated procedure, so no handler can forget it.
3. **No flattening proxy.** `BaseClient`, `FlatLeaves`, `collectContractLeaves` and the six client classes are deleted. Calls use
   the namespaced path (`client.user.findById(input)`), which is already what the generated code and the contracts say and keeps
   one name per procedure. The few hand-written consumers (4 call sites: `screen-read` ×2, `analytics-read`, `managed-web.client`)
   each become a small `live` gateway class for their screen that owns its own contract pairing.
4. **The far end's refusal passes through verbatim.** The first draft mapped oRPC codes onto the seven `ErrorKind`s. That is lossy:
   a contract-defined error with its own code and `data` would become a generic kind and the typed web client would stop
   recognising it. So `ServiceCallFailed` carries `{ service, code, status, data, message }` as a typed domain error, and the BFF's
   domain-error interceptor re-emits it as the same `ORPCError` (it already re-emits kinds through `mapDomainError`; this adds one
   verbatim case). `ServiceUnreachable` stays and maps to `bad_gateway` (502), not 500. This replaces `passThroughFailures` exactly,
   with a type.
5. **The three hand-written controllers keep composing several services.** The migration is the shape of a call, not the cut of the
   screens. (Unchanged from the first draft, now a decision.)
6. **CLI.** `nest-commander` commands call Effect services through `EffectHost.run` at the one place the CLI hands control to
   Nest. That is the single permitted Promise boundary in this scope and it is written at that call, with this reason.

## 3. Target shape

`packages/service-client` (no app imports; the app supplies the transport):

```ts
export class CallerCredentials extends Context.Service<CallerCredentials, CallerCredentialsShape>()('service-client/CallerCredentials') {
    /** What a call carries: cookie, authorization, api key — or, for a peer service, one system-actor claim. */
    static readonly none: CallerCredentialsShape
    static readonly system = (claim: string): CallerCredentialsShape => …
}

export class ServiceCallFailed extends domainError('ServiceCallFailed', 'bad_gateway')<{
    readonly service: string; readonly code: string; readonly status: number; readonly data: unknown; readonly reason: string
}>() { /* publicMessage = reason; the interceptor reads code/status/data */ }

export type ServiceClientsShape = {
    /** One call on the owning service: interrupted with the fiber, credentials read from the context, typed failure. */
    readonly call: <T extends RouterContract, A>(
        service: string, contract: T, run: (client: ContractRouterClient<T>) => Promise<A>
    ) => Effect.Effect<A, ServiceCallFailed | ServiceUnreachable, CallerCredentials>
    readonly catalog: Effect.Effect<readonly { name: string; url: string; description: string }[]>
}

export class ServiceClients extends Context.Service<ServiceClients, ServiceClientsShape>()('service-client/ServiceClients') {
    static readonly live = class ServiceClientsImpl implements ServiceClientsShape {
        constructor(private readonly transport: ServiceTransport) {}   // origin resolver + optional agent link, from the app
        …
    }
}
```

Each app provides one `ServiceTransport` (the BFF from `API_SERVICES`; a service from `apiServiceUrl` + `nodeAgentLink`) and
`{ provide: ServiceClients, useFactory: (t) => new ServiceClients.live(t) }` — the factory only wires, per the live-class rule.

Generated handler:

```ts
@Implement(identityUserContract.findById)
findById_user() {
    return procedure(identityUserContract.findById)
        .use(provideCallerCredentials())
        .effect(function* ({ input }) {
            const clients = yield* ServiceClients
            return yield* clients.call('identity', userContract, (c) => c.user.findById(input))
        })
}
```

`procedure()` (not `implement()`) so the gate, the request boundary and the requirement check apply. No `requireAuth()` or
`accessRequired()` is emitted: the access declaration travels on the contract and the gate evaluates it at the BFF. `accessDeferred`
would suppress the gate, so it is never generated. Streams (`observable` outputs) pass through `call` unchanged and read their
credentials at subscription through the same per-call context.

## 4. Order of work — one change set, green at every commit

The old API is deleted at the end of this change set, and a gate in §5 fails the change if any deleted symbol is still imported.
The only overlap allowed is *inside* this change set, between steps 1 and 6.

1. **Package.** Add `CallerCredentials`, `ServiceCallFailed`, `ServiceTransport`, `ServiceClients` (+ specs, including the
   two-concurrent-callers test in §6). Old exports untouched so every consumer still compiles.
2. **Interceptor.** Teach `@deployer/effect-orpc`'s domain-error interceptor the verbatim `ServiceCallFailed` case (+ spec).
3. **Edge.** `provideCallerCredentials()` middleware in `@deployer/shared` (it is also what services need for `systemActor`
   calls: `CallerCredentials.system(claim)` replaces `systemActorClientFor`).
4. **Generator + D.** Update `scripts/gen-bff-delegation.py`, regenerate the 21 files, format (`git checkout` the other generated
   files first, then `cd apps/api/bff && bun fmt`). The generator's `< 300 procedures` guard stays.
5. **BFF hand-written (E).** In this order: `domains/setup` controller and its two `serviceOver` files → `live`; orchestration and
   console-control controllers `.handler(async)` → `.effect`; `AnalyticsRead`, `ScreenRead`, `OverviewComposer`,
   `ManagedWebClient`, `PlatformHealthService`, `CliAuthService` → `live` classes over `ServiceClients`; the CLI boundary per §2.6.
6. **Services (B).** `ApprovalGuard`, fleet `step-up.gateway`, `deployment-trigger.gateway`, project `dns-provider.gateway` move to
   `ServiceClients` (`CallerCredentials.system(claim)` where they used `systemActorClientFor`); the `SystemActorClients` port and
   its two `useExisting` bindings go; `ServiceClientModule` is replaced by one provider per app.
7. **Delete.** `ServiceClientRegistry` (BFF and package), `BaseClient`, `FlatLeaves`, `contract-leaves`, the six client classes and
   `service-clients.module.ts`, `service-auth-context*.ts`, `shared/src/server/service-client.ts`, `SystemActorClients`; update the
   `BaseClient` mentions in `packages/contracts/*/index.ts`; drop `ServiceClientModule` from `bff.module.ts`; update
   `main.ts` and `e2e/runtime.ts` (which seed the ALS); port `node-agent/src/boot/service-clients.spec.ts`.
8. **Surface lists (F).** `python3 scripts/check-service-surface-parity.py`; no change expected, it is run because the BFF's
   procedure set must not move.
9. **Docs and ledgers.** `docs/architecture/effect-migration-audit-2026-11-06.md` (BFF row), the make-to-live inventory
   (`serviceOver` BFF entries), `nest-roles.ledger.json` of the BFF, the handoff prompt's "next steps".

## 5. Gates — the change is not done until all of these are empty / green

```bash
# nothing may import what was deleted
grep -rnE "ServiceClientRegistry|BaseClient|FlatLeaves|collectContractLeaves|runWithServiceAuth|serviceAuthHeaders|currentServiceAuth|systemActorClientFor|SystemActorClients|ServiceClientShape|ServiceClientModule" apps packages --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist
# no Promise handler left in the BFF
grep -rn "\.handler(async\|implement(" apps/api/bff/src --include='*.ts'
# no injectable service left in the BFF
grep -rn "@Injectable" apps/api/bff/src --include='*.ts'
```

Plus `bun x turbo run type-check test lint --filter=@deployer/service-client --filter=@deployer/effect-orpc --filter=@deployer/shared
--filter=@deployer/bff --filter=@deployer/svc-fleet --filter=@deployer/svc-project --filter=@deployer/svc-runtime
--filter=@deployer/svc-node-agent --filter=@deployer/web` (one process, no `--concurrency` unless it OOMs), and the BFF e2e surfaces
`src/e2e/delegation-workflows/delegated-routes.e2e-spec.ts` and `module-workflows/module-contract-surfaces.e2e-spec.ts`.

## 6. What must be tested because it can regress silently

- **Credentials never cross callers.** Two concurrent calls through one cached client with different cookies each arrive with their
  own cookie; a call with no `CallerCredentials` arrives with none. This replaces the ALS isolation test and is the reason the
  ALS removal is safe.
- **The far end's status survives.** A service answering `NOT_FOUND`, `FORBIDDEN`, a contract-defined error with `data`, and an
  unknown code each reach the BFF client as the same code/status/`data`; an unreachable service is 502, not 500.
- **Interruption.** Interrupting the fiber aborts the request (already covered for `callService`; extend to `call`).
- **Streams.** An observable procedure delegated through `call` still streams, and the credentials are read at subscription.
- **System claim.** `CallerCredentials.system(claim)` sends only `x-deployer-system-actor`, never a cookie.

## 7. Done already

- The BFF no longer forwards `x-mesh-internal-key` (the mesh shared secret it belonged to is gone; nothing verifies it).
- `ApprovalGuard` is a live class that signs a system-actor claim (it moves onto `ServiceClients` in step 6).

## 8. Risks

- **Size.** About 21 generated files, ~25 hand-written files, 5 service files and the package: one change set, so it is worked by
  partition (package → generator → BFF → services), each partition owning disjoint files, one turbo process at a time.
- **`packages/service-client` is imported by the node-agent's boot spec**, which exercises the real registry over sockets; it is
  rewritten against `ServiceClients` and is the best end-to-end check of the new transport.
- **`serviceLink` takes `headers: () => …` with no per-call input today** (`packages/mesh/client/src/service-link.ts`). Per-call
  credentials need it, and `OpenAPILink`'s `headers`, to read the oRPC call `context`; that is a small change in `@deployer/mesh-client`
  and belongs to step 1, with its own spec. If the link cannot read the call context, decision 2 falls back to passing the headers
  through a per-call link built from the credentials (cheap: a link holds no state), never back to AsyncLocalStorage.
- **Not exercisable here:** a live multi-node call through the agent link. The transport keeps the exact `serviceLink` /
  `OpenAPILink` split of both old layers, and the boot spec covers the agent path.
