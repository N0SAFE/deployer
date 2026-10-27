# 09 — Implementation Plan

> **Status:** canonical plan
> **Answers:** the exact order of work, what is deleted, and how "done" is verified.

Atomic steps, type-check green at each. No step leaves a bridge behind
(`core-rules`: replace, never bridge).

---

## Phase 0 — Cleared (already done)

- [x] `apps/api/shared` extracted (`@deployer/shared`): `core/`, `config/`,
      `auth.ts`, `server/`. 868 imports rewired across 282 files by the
      `@/core/*` · `@/config/*` · `@/auth` alias remap. **Type-check green.**
- [x] Orchestrator scaffold deleted (rejected design).
- [x] Old `api-bff-orchestrator.md` draft deleted.
- [x] This documentation series written.

---

## Phase 1 — Shared foundations ✅ (done)

Everything below is a prerequisite for any service or the BFF.

- [x] **`shared/server`**: the one Nest+oRPC bootstrap every app imports
      (`createOrpcModule`, `bootstrapApiServer`, health endpoints, error
      translation, compression, coercion, auth plugin).
- [x] **`service-catalog.ts`** — `service-address.ts`: one table of
      `{ name, portOffset, description }` that drives ports, compose entries,
      swarm specs and BFF clients. Adding a service = one row.
- [x] **`apiServiceUrl(name)`**: resolves by **internal DNS name**
      (`http://svc-fleet:3105`), never a loopback hostname.
- [x] **Port allocation** from the catalog (`apiServicePort(name)`,
      operator-overridable via `API_SERVICE_PORTS`).
- [x] **Preflight** (`shared/server/preflight/**`): `checkDatabase`,
      `checkMigrations`, `checkRedis`, `runPreflight`, `PreflightModule`,
      `PreflightService`. Reused by apps AND (next) the CLI.
- [x] **Boot gating**: `bootstrapApiServer` binds the port, then proves
      dependencies, then exits 5 via `DependencyNotReadyError`.
- [x] **Node status**: `deriveNodeState` + `exitCodeForState` (derived, pure).
- [ ] **Shared build script**: the 1:1 transpile + alias rewrite, extracted so
      every app reuses it (`apps/api/scripts/build.ts` is monolith-only today).

**Verified:** `apps/api/shared` type-check 0 errors; 33 tests green, including a
boot-gating **integration** test that starts a real app and asserts the port
binds before the checks run and that a missing dependency refuses to serve.

---

## Phase 2 — Delete the old onboarding (in one change set)

Removing it first is deliberate: leaving it in place invites "make the old path
work too", which is a bridge.

- [ ] Delete `apps/setup/**`.
- [ ] Delete `SetupGateService`, `setupPhaseService`, the `/setup/health` gate,
      `SetupExitService`, `setup-phase.types.ts`.
- [ ] Delete the `/setup/*` pre-boot ORPC surface. There is **no** configurator
      service to keep it for: the configurator protocol is served by the CLI or
      the remote relay, never by `apps/api` ([12](./12-architecture-review.md) §12.1 F1).
- [ ] Delete `HostnameService` (166 `*.deployer.localhost` refs, ~30 files).
- [ ] Delete the compose `setup-dev` service and the
      `depends_on: setup-dev: service_healthy` wiring.
- [ ] Delete `SetupDevService` (phase-0 dev bootstrap) — dev DB comes from compose
      env; prod comes from the CLI flow.

**Verify:** nothing references `SetupPhase`, `setupHostname`, or
`deployer.localhost`; `type-check` green.

---

## Phase 3 — Networking rewrite

- [ ] Point every Traefik backend at a **service name**
      ([06](./06-networking-and-dns.md) §6.4).
- [ ] Derive CORS / Better Auth `trustedOrigins` / passkey origins from
      `DEPLOYER_PUBLIC_DOMAIN`; delete `DEPLOYER_PREFIX`, `AUTH_BASE_DOMAIN`,
      `SETUP_API_URL`, `NEXT_PUBLIC_*` in prod.
- [ ] Update `lanes.schema.ts` and `platform.contract.ts` to drop the local-lane
      hostname (keep the lane for visibility).
- [ ] Dev ports: one `DEPLOYER_PORT_BASE`, offsets in the catalog.

**Verify:** dev stack reachable on ports only; no hostname construction left;
prod config has exactly one domain variable.

---

## Phase 4 — BFF, rebuilt as a real app

The current `apps/api/bff` is the rejected generated forwarder. Replace it.

- [x] `bff/src/main.ts` + `bff.module.ts` on `shared/server`.
- [x] `clients/service-registry.ts` — typed clients per service, built from the
      catalog. **`OpenAPILink`**, because services serve OpenAPI-shaped routes.
- [x] **Screen module #1** (`screens/platform-health/`): composes every
      service's `/health/ready` into the platform roll-up
      ([10](./10-developer-journeys.md) §10.7). This is what `deployer status`
      reads, and the proof the BFF is not a proxy.
- [x] Auth: parse the session here; forward a signed `Actor` claim.
- [ ] Public router composed from the service contracts (unchanged URLs).
- [ ] Ingress: move `TraefikIngressConfigService` behind the BFF.
- [ ] Screen modules for the real front screens (projects, docker, deployments…).

**Verify:** `GET /health` answers; each screen module composes ≥2 services and
returns a **front-shaped** payload; no screen module has a repository.
**State:** type-check 0 errors; the roll-up endpoint exists and degrades
correctly. Still to do: contract composition + the remaining screens.

---

## Phase 5 — Services, one concern at a time

For each service, in dependency order (a service is finished before the next
starts — no half-migrated platform):

1. `health` — ✅ **done** (the reference implementation of the anatomy).
2. `configurator` — ✖ **not an API service** (see
   [12](./12-architecture-review.md) §12.1 F1). The CLI serves the UI or the
   remote relay does; nothing here implements it.
3. `identity` — users, permissions, push.
4. `project`.
5. `runtime`.
6. `fleet`.

Per service ([05](./05-service-anatomy.md) §5.8):

- [x] (`health`) `apps/api/services/<name>/` scaffolded from the catalog row.
- [x] (`health`) One directory per domain; entity / repository / service / controller.
- [x] (`health`) Business rules **recreated** (not relocated).
- [x] (`health`) Its contracts implemented; tables owned by one repository.
- [x] (`health`) `*.service.spec.ts` (happy / unavailable / error message).
- [ ] (`health`) Dockerfile (dev + prod) + swarm spec.
- [x] (`health`) Compose entry (`docker-compose.config.services.yml`).
- [ ] Delete the corresponding code from `apps/api/src/**`.

**Verified (`health`):** type-check 0 errors; 5 tests pass.

**Verify per service:** `type-check`, `lint`, `test` green; it reports healthy in
the dev stack; no other service's table is written.

---

## Phase 6 — CLI

- [ ] `deployer status` (derived states, [01](./01-lifecycle-and-ownership.md) §1.2).
      The derivation and exit codes already exist in
      `shared/server/node-status.ts`; the command is a thin wrapper.
- [ ] `deployer start` (branch on `setupState`, [02](./02-cli-onboarding.md) §2.3).
- [ ] First-run configurator flow: session + outbound tunnel
      ([03](./03-configurator-protocol.md)).
- [ ] `deployer stop` / `logs` / `restart` / `join` / `upgrade` / `doctor`.
- [ ] **Client mode** ([11](./11-cli-as-a-client.md)): `login`/`logout`, token store
      (`0600`), `platform-client.ts` (typed oRPC over the BFF), `--json`/`--quiet`,
      the exit-code table.
- [ ] `deployer configure` re-opens the configurator with the current config
      (no second validation path); `deployer config get/set/export/diff`.
- [ ] Resource commands (`projects`, `services`, `deployments`, `nodes`, `users`,
      `health`, `events`) — each mapping to an **existing** contract procedure.
- [ ] Service specs move to the **shared builder** the CLI and compose both call.

**Verify:** fresh node → `start` → running platform, using an empty config dir;
`status` returns the same state before and after the platform is up.

---

## Phase 6b — Dev profiles

- [ ] **plain dev** compose: one entry per catalog row, ports from the offsets,
      no swarm ([10](./10-developer-journeys.md) §10.1).
- [ ] **dev-supervised** compose: image-build jobs + the production start flow,
      and **no** compose-managed platform services
      ([10](./10-developer-journeys.md) §10.2).
- [ ] **local** (`turbo run dev`) keeps working with the same port offsets.

**Verify:** each of the three profiles brings up a working stack; killing a task
in dev-supervised is rescheduled by the swarm with no config change.

## Phase 7 — Docs & repo hygiene
- [ ] Rewrite `apps/api/AGENTS.md` and `apps/api/ARCHITECTURE.md` for the new
      layout; add one `AGENTS.md` per app.
- [ ] Mark `docs/setup-lifecycle-complete.md`, `docs/startup-flow-explained.md`,
      `docs/setup-app-refactor-plan.md`, `docs/setup-unification-plan.md` as
      superseded (or delete).
- [ ] Update the root `AGENTS.md` MCP section (app list, ports).
- [ ] `knip` for dead code; delete the empty `apps/api/src/**` shell.

---

## Definition of done (whole effort)

- [ ] `apps/api/**` contains only `shared/`, `bff/`, `services/*`, and no monolith
      `src/`.
- [ ] `deployer status` and `deployer start` work on a machine with an empty
      config directory.
- [ ] No `*.deployer.localhost`, no setup app, no orchestrator, no gate.
- [ ] Every service and the BFF satisfy [05](./05-service-anatomy.md) §5.8.
- [ ] The BFF has **zero** passthrough controllers: every public route is either a
      screen-shaped read or a command that services execute.
- [ ] `deployer status` answers correctly with the platform **down**
      ([10](./10-developer-journeys.md) §10.7).
- [ ] `deployer configure` changes configuration through the **same** revision +
      implementation pipeline as first-run ([11](./11-cli-as-a-client.md) §11.4).
- [ ] All three dev profiles work ([10](./10-developer-journeys.md)).
- [ ] `bun --bun run type-check`, `lint`, `test` green across the repo.
