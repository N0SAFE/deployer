# AGENTS.md — apps/api-services (BFF + services)

Read the root `AGENTS.md` first. This file adds rules specific to `apps/api-services`.

## What this app tree is

`apps/api-services` is the **new architecture**: one BFF plus five bounded-context
services, all NestJS, all sharing one internal platform package.

```
apps/api-services/
  shared/            @deployer/shared — the internal platform package
  bff/               @deployer/bff    — the ONLY public HTTP surface
  services/
    health/          @deployer/svc-health
    identity/        @deployer/svc-identity
    project/         @deployer/svc-project
    runtime/         @deployer/svc-runtime
    fleet/           @deployer/svc-fleet
```

`apps/api` is the **monolith**. It is NOT being deleted yet and it is NOT part of
this tree. It keeps its own `src/core`, `src/config` and `src/auth.ts`. Do not
move anything from `apps/api` into `apps/api-services`, and do not import across
the boundary.

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
| `@/core/*` | `shared/src/core/*` |
| `@/config/*` | `shared/src/config/*` |
| `@/auth` | `shared/src/auth.ts` |
| `@/e2e-harness/*` | `shared/src/e2e-harness/*` |
| `@/*` | the app's own `src/*` |

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

The BFF also has generators; run them from `apps/api-services/bff`:

```bash
python3 scripts/check-service-surface-parity.py   # from the repo root
python3 scripts/gen-bff-delegation.py             # regenerates src/modules/delegation/generated
```

## Boundaries

- Do **not** edit `apps/api/**` as part of a change here. The monolith is frozen
  until every service is verified.
- Do **not** import from `apps/api` or from the deleted `@deployer/contracts-entities`.
- Do **not** add a bridge, alias export, or shim between the monolith and this
  tree. Replace, never bridge.
- Do **not** put a single class in a file named after a folder, and do not put
  several classes in one file.
- `shared/` must stay app-agnostic: if it needs a service's type, it needs a
  contract package instead.
