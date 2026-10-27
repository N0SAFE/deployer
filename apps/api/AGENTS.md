# AGENTS.md — apps/api (BFF + services)

Read the root `AGENTS.md` first. This file adds rules specific to `apps/api`.

## What this app tree is

`apps/api` is the **new architecture**: one BFF plus five bounded-context
services, all NestJS, all sharing one internal platform package.

```
apps/api/
  shared/            @deployer/shared — the internal platform package
  bff/               @deployer/bff    — the ONLY public HTTP surface
  services/
    health/          @deployer/svc-health
    identity/        @deployer/svc-identity
    project/         @deployer/svc-project
    runtime/         @deployer/svc-runtime
    fleet/           @deployer/svc-fleet
```

The **monolith that used to live at `apps/api` was removed** and this tree took its
place: this is the only API. The monolith's last state is recoverable from git
(commit `6f5059d8`, `git show 6f5059d8:apps/api/<path>`); anything you need from it
is ported here, never imported.

## The two rules that decide every placement

1. **A service owns entities.** If a change alters what a row means, what invariant
   holds, or what may be written, it belongs in a service.
2. **The BFF owns screens.** If a change alters what a screen needs or how a
   payload looks for the UI, it belongs in the BFF.

**The BFF is not a proxy.** It never forwards a request one-to-one. It calls the
services it needs — often several — and composes the answer the screen wants. A BFF
endpoint that is a single pass-through call is a design smell: either the payload
belongs to the UI (fix it here) or the rule belongs to a service (move it there).

## The shared package

`shared/` is `@deployer/shared`, reached with the app's own aliases:

| Specifier | Resolves to |
|---|---|
| `@/*` | the app's own `src/*` — never outside the app |
| `@deployer/shared/core/*` | `shared/src/core/*` |
| `@deployer/shared/config/*` | `shared/src/config/*` |
| `@deployer/shared/auth` | `shared/src/auth.ts` |
| `@deployer/shared/e2e-harness/*` | `shared/src/e2e-harness/*` |

Shared is consumed as a package, by name. An app's `tsconfig.json` has
`rootDir: "./"` and no `paths` entry that reaches into `../shared/src`; a path
that points outside the app is how a service quietly compiles another package's
source. Inside `shared`, imports are relative — the package must not depend on a
consumer's aliases.

Ownership rule: **the BFF and every service import `shared`; `shared` imports
NOTHING from an app.** It is a leaf. A `shared` file that imports `@/modules/...`
is a layering bug.

> **Never reach `shared` through the `@deployer/shared` package name from inside
> `shared` itself.** That loads the module twice (two class objects), which Nest
> reports as an unresolvable provider.

## Contracts

Each service has its own contract package, and a service imports **only its own**:

| Package | Owner |
|---|---|
| `@deployer/contracts-entities` | shared entity schemas |
| `@deployer/contracts-common` | schemas shared across domains |
| `@deployer/identity-contracts` | `svc-identity` |
| `@deployer/project-contracts` | `svc-project` |
| `@deployer/runtime-contracts` | `svc-runtime` |
| `@deployer/fleet-contracts` | `svc-fleet` |
| `@deployer/health-contracts` | `svc-health` |
| `@deployer/bff-contracts` | the BFF's own procedures (setup/test/template) + screens |

There is no combined `@deployer/contracts-entities`. A router combining every service
exceeds TypeScript's declaration-serialization limit (TS7056), so it is composed
per-app in `src/orpc/app-contract.ts`, where `declaration` is false. The two
copies of that composition are kept identical by
`scripts/check-service-surface-parity.py`.

See `packages/contracts/AGENTS.md` for the full contract rules.

## Structure — every app is the same shape

```
<app>/
  package.json   tsconfig.json   nest-cli.json   eslint.config.ts   vitest.config.mts
  src/
    main.ts          composition root: build app, listen, shutdown hooks
    app.config.ts    the ONE place NestFactory options are decided
    app.module.ts    the root module — imports only
    <domain>/        one folder per domain
```

Per-domain structure, feature-first (never layer-first):

```
src/<domain>/
  <domain>.module.ts
  controllers/<entity>.controller.ts    thin: binds a contract, delegates
  services/<entity>.service.ts          business rules, orchestration
  repositories/<entity>.repository.ts   Drizzle only — no business rules
  <entity>.errors.ts                    domain errors (extend AppError)
```

Layering is one-directional: `controller → service → repository`. A repository
never calls a service; a service never touches Drizzle; a controller never
contains a rule.

**One class per file.** No multiple exported classes in one file.

## Effect contexts belong to the module

A module declares what its `.effect()` handlers may `yield*` by extending
`createModuleContext` (`@deployer/nest-effect`):

```ts
export class UserDomainModule extends createModuleContext({
  controllers: [UserController],
  providers: [{ provide: UserService, useClass: UserServiceImpl }],
  exports: [UserService],
}, DatabasePort) {}
```

- The context is the union of the module's own `Context.Service` providers, the
  contexts of the wrapped modules it `imports`, and any extra keys passed after
  the metadata. There is no app-wide service map: a handler can only yield what
  its own module declared.
- A controller reads it as `UserDomainModule[EffectContextOf]`:
  `.use(requireAuth()).use(UserDomainModule[EffectContextOf]).effect(...)`.
  Apply it **after** `requireAuth()` — the auth middleware merges the context and
  otherwise erases the Effect services.
- Root modules extend it too, so their context is the union of what they import.
- A service that needs a shared Nest service yields a **port**: `src/core/ports/<kebab>.port.ts`
  holds `Pick<RealClass, "method">` + a `Context.Service` tag, and the module provides
  `{ provide: Tag, useExisting: NestClass }`. The port names only the methods the
  Effect layer may use, so a service cannot reach the rest of the shared class.
- Some services cannot be a Nest provider at all: their construction needs the
  Effect context (an event bus that needs the shared stream pool) or a scope.
  Register them as a Layer and pass it to the runtime:
  `EffectRuntimeModule.forRoot({ layers: [ServiceEventServiceLayer] })`; the
  runtime builds it *over* the discovered providers and disposes it on shutdown.
  A module whose handlers yield such a service lists its tag as an extra key:
  `createModuleContext({ … }, DatabasePort, ServiceEventService)`.

`createOrpcModule({ extraContext })` still puts the runtime `Context` under
`effect/context` per request; `extraContext.inject` is a tuple, so `resolve`
receives typed instances with no cast.

## Workflows

```bash
# Per app, from the app directory:
bun --bun run type-check
bun --bun run lint
bun --bun x vitest run            # all suites
bun --bun x vitest run <pattern>  # one spec
```

The suites share one local SQLite file. **Run them sequentially** — in parallel
they fail with `database is locked`, which looks like a real failure.

The BFF also has generators; run them from `apps/api/bff`:

```bash
python3 scripts/check-service-surface-parity.py   # from the repo root
python3 scripts/gen-bff-delegation.py             # regenerates src/modules/delegation/generated
```

## Boundaries

- Do **not** recreate the removed monolith or import from the deleted `@deployer/contracts-entities`.
- Do **not** add a bridge, alias export, or shim to a removed package. Replace, never bridge.
- Do **not** put a single class in a file named after a folder, and do not put
  several classes in one file.
- `shared/` must stay app-agnostic: if it needs a service's type, it needs a
  contract package instead.
