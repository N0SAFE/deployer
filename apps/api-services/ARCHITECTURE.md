# apps/api-services — Services & BFF

> **Status:** normative. Every app under `apps/api-services/` follows this document.
> A change that contradicts it is a bug, not a style choice.
>
> **Companion docs:** `docs/architecture/04-services-and-bff.md` (the model),
> `docs/architecture/05-service-anatomy.md` (this file's detail),
> `docs/architecture/06-networking-and-dns.md` (how apps reach each other).

`apps/api-services` is not one application. It is a **small monorepo of NestJS servers**
plus the shared foundation they all build on:

```
apps/api-services/
  shared/          shared foundation (internal package; consumed by every app)
  bff/             Backend For Frontend — the ONLY public HTTP surface
  services/
    identity/      users, permissions, push
    project/       projects, services, domains, environments
    runtime/       deployments, containers, images, runners
    fleet/         nodes, cluster, providers, reachability
    configurator/  configurator sessions + the pass-through tunnel
```

> **There is no orchestrator and no supervision app.** Node supervision belongs
> to the **swarm** (restart + reschedule) and boot belongs to the **CLI**
> (`deployer start`). A process whose job is to report whether the platform is up
> has a failure mode indistinguishable from the failure it reports.
> See `docs/architecture/07-swarm-runtime.md` §7.6.

## The two roles

| Role | Owns | Never does |
|---|---|---|
| **Service** | its domain's entities, business rules, persistence | know about the browser, sessions, or HTTP shape |
| **BFF** | the public surface, sessions, per-screen view models | own entities or business rules |

### The rule that decides every placement question

- **A service owns entities.** If a change alters what a row means, what invariant
  must hold, or what may be written, it belongs in a service.
- **The BFF owns screens.** If a change alters what a screen needs, how it is
  aggregated, or how a payload should look for the UI, it belongs in the BFF.
- **The BFF is not a proxy.** It never forwards a request one-to-one. It calls the
  services it needs (often several) and composes the answer the screen wants. A
  BFF endpoint that is a single pass-through call is a design smell: either the
  payload belongs to the UI (fix it here) or the rule belongs to a service (move
  it there).

## Mandatory structure — every app

Every app (BFF, each service) is the SAME shape. This is not optional; a new app
is this directory tree or it is wrong.

```
<app>/
  package.json
  tsconfig.json
  nest-cli.json
  eslint.config.ts
  vitest.config.mts
  scripts/
    build.ts              1:1 transpile (bundling breaks Nest DI — see below)
    entrypoint.dev.ts     dev boot (waits for deps, then runs)
  src/
    main.ts               composition root: build app, listen, shutdown hooks
    app.config.ts         the ONE place NestFactory options are decided
    app.module.ts         the root module — imports only
    config/               env schema/service for THIS app (zod-validated)
    <domain>/             one folder per domain (see below)
```

### Per-domain structure (services)

Feature-first, never layer-first. One folder per **entity**, containing every
layer that entity needs:

```
src/<domain>/
  <domain>.module.ts      wires providers, exports what other modules may use
  domain/
    <entity>.entity.ts    the entity model + invariants (no Nest, no Drizzle)
    <entity>.errors.ts    domain errors (extend AppError)
  dto/
    create-<entity>.dto.ts
    update-<entity>.dto.ts
    <entity>-query.dto.ts
  controllers/
    <entity>.controller.ts   oRPC handlers via @Implement — thin, delegates
  services/
    <entity>.service.ts      business rules, orchestration, transactions
  repositories/
    <entity>.repository.ts   Drizzle only — no business rules
```

Layering is one-directional and enforced by review:

```
controller → service → repository
     │            │
     └────────────┴──→ domain/ (pure types + errors, importable everywhere)
```

- A **repository** never calls a service. It executes queries.
- A **service** never touches Drizzle. It orchestrates repositories and policy.
- A **controller** never contains a rule. It binds a contract and delegates.
- **domain/** imports nothing from the app — it is the vocabulary.

### Per-screen structure (BFF)

The BFF groups by **screen**, because that is the unit that changes together:

```
src/screens/<screen>/
  <screen>.module.ts
  <screen>.controller.ts       the endpoints the screen calls
  <screen>.service.ts          composes service calls into view models
  view-models/
    <screen>.view.ts           the exact shape the screen consumes
```

A screen service **has no repository** — it owns no table. It calls services
through typed clients and composes. If it needs three services, it makes three
calls.

## Shared foundation (`shared/`)

Everything used by more than one app lives in `apps/api-services/shared` and is imported
as `@/core/*`, `@/config/*`, `@/auth` (the aliases each app's tsconfig maps into
`shared/src`). Nothing else is shared:

```
shared/src/
  core/          platform machinery: auth, database, supervisors, swarm, mesh,
                 traefik, edge, lifecycle, triggers
  config/        env schema, drizzle config + migrations, schema codecs
  server/        the shared Nest+oRPC host: bootstrap, ORPC config, health
  auth.ts        the Better Auth factory
```

Ownership rule: the BFF and every service import `shared`. `shared` imports
**nothing** from an app. It is a leaf.

> **Import specifier rule.** Shared code is reached with the app's `@/` alias
> (`@/core/...`, `@/config/...`, `@/auth`), which each app maps into
> `shared/src`. It is NEVER reached through the `@deployer/shared` package name
> from inside `shared` itself — doing so loads a module twice (two class
> objects), which Nest reports as an unresolvable provider.

## Transport between apps

Contract-first oRPC, everywhere. The contract package is the only shared artifact,
and it is the transport:

| Edge | Mechanism |
|---|---|
| browser → BFF | oRPC over HTTP (`@Implement` controllers, the public contract) |
| BFF → service | oRPC **client** (`RPCLink`) typed by the service's contract |
| service → service | only via the BFF's composition, or an explicit typed client with a service token |

- A service exposes its contract; it does not know who calls it.
- The BFF holds the session; it forwards an explicit **actor** claim. Services
  read the actor, never the browser cookie.
- **Internal addressing is by service name** (`http://svc-fleet:3009`), resolved
  by the cluster's service-name DNS. Never a loopback hostname
  (`docs/architecture/06-networking-and-dns.md`).

## The contract IS the service boundary

`packages/contracts/api/modules/<domain>/` already isolates one contract per
domain. The rule:

- the contract package name and the service name are the same word;
- the service implements exactly its contract, with `implement(...)`;
- the BFF composes the same contracts, so **public URLs never change** when a
  domain moves between services.

Entity-first contracts: derive from the canonical entity schema in
`@deployer/contracts-entities` and reduce per use-case (`entity.omit({...})`), rather
than re-declaring ad-hoc payloads. List endpoints use the shared list config
builders (`standard.zod(...)`, filter/sort/pagination configs), not bespoke query
schemas.

## Boot & supervision

- **the CLI `deployer start`** brings the platform up (configurator flow on a
  fresh node, direct boot otherwise) — `docs/architecture/02-cli-onboarding.md`;
- **the swarm** keeps it up (restart policy, rescheduling between nodes) —
  `docs/architecture/07-swarm-runtime.md`;
- **the BFF** aggregates health for humans (`deployer status`); it never restarts
  anything.

## Non-negotiables (restated here because they bite)

- **Type-check must pass** in every app. No `as any`, no `@ts-ignore`.
- **Bundling breaks Nest DI.** Each app transpiles `src/**` 1:1 (`scripts/build.ts`)
  so `design:paramtypes` is emitted. Never `bun build` an app.
- **No compatibility layers.** When code moves, the old location is deleted in
  the same change set.
- **No cross-domain imports** inside a service: `runtime/` may not import
  `fleet/` internals. Promote shared logic to `shared/core`.
- **One definition per concept.** An entity has one schema; a route has one
  contract; a value has one constant.
