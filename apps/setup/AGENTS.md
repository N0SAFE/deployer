# AGENTS.md — apps/setup (NestJS)

Follow the root `AGENTS.md` first. This file adds setup-app-specific guidance.

## What this app is

A **one-way onboarding app**. It exists to get the platform onto a cluster and
then get out of the way:

1. found or join the swarm,
2. serve the wizard and persist the operator's choices,
3. **open the gate** so the API may start,
4. watch the API converge, hand the entry port over, and exit.

It is NOT "the API in a special mode". That arrangement is what this app
replaces: the API used to boot pre-setup, run a sub-app pipeline, and swap a
gateway fallback at runtime. The API now boots one normal graph and this process
covers the phase before it.

## The gate — the most important thing in this app

`GET /setup/health` is a compose healthcheck, and **compose starts the API behind
it** (`api-dev: depends_on: setup-dev: service_healthy`). So:

> **Setup's health means "the platform may start the API". It is an INPUT to the
> API's existence, never a report about it.**

The chain is one direction, with no edge back:

```text
setup ──healthy──▶ api ──healthy──▶ web
```

- It opens at the **`launching`** phase, i.e. when the operator's choices are
  persisted to `node_config` (`SetupGateService.open`).
- It **stays** open through `provisioning` / `handover` / `ready` — compose
  re-probes continuously, so a dip to 503 would tear the API down mid-boot.
- It closes on `failed`, so a broken platform is not reported as startable.
- On a restart where `node_config.setupState` is already `setup_done`, it opens at
  boot without the wizard — the same flow minus the collecting step.

**Never make this gate depend on the API.** An earlier design did (the gate
opened only once the API was green), which is a cycle: compose starts the API
behind this healthcheck, so the API could never start. `SetupPhaseService.isReady`
and `SetupReadinessIndicator.check` are the two places that decide it — they must
agree, which is why the indicator delegates to `isReady()` rather than repeating
the phase check.

## Scope Rules

- Read this file before changing any code in `apps/setup/`.
- **Never add a product feature here.** No auth, no project/docker/deployment
  surfaces, no global Postgres. Those belong to `apps/api`, which starts only
  after this app has finished.
- The wizard is a **thin proxy over the setup contract** (`/setup/*`) EXCEPT for
  the trigger, which this app intercepts: `POST /setup/trigger` is what opens the
  gate, and it must be handled locally because forwarding it would require the
  API to already exist. Provisioning itself stays in the API — this app has no
  Drizzle schema, migrations or auth stack.
- Setup writes only **two** Traefik files (`dynamic-api.yml`,
  `dynamic-setup.yml`). Every other dynamic file belongs to the API, and writing
  one here would be a second writer for the same file.
- Setup is the **only** writer of the shared `node_config` row during onboarding;
  the API only reads it. That is what makes sharing the SQLite volume safe with
  no lock.

## Architecture: event-driven, no polling

Every state change is published and every consumer subscribes. There is **zero**
`setInterval` in this app.

| Service | Primitive | Why |
|---|---|---|
| `SetupPhaseService` | `BehaviorSubject` for state, plain `Subject` for edges | a late reader gets the current value, but an EDGE is never replayed (replaying "on failure, recover" would re-fire handled work) |
| `ClusterOrchestratorService` | `concatMap` over a `Subject` | serialises attempts so a retry cannot race the engine founding a cluster |
| `HandoverOrchestratorService` | `concatMap` over a `Subject`, triggered by the **gate edge** (`onEnter("launching")`) | starts the moment the details are collected — so in prod it schedules the API only AFTER a database is known; serialises retries so two handovers cannot race on the same two ingress files |
| `ApiReadinessWatcherService` | `timer` + `switchMap` | `switchMap` CANCELS an in-flight probe, so a slow API cannot accumulate overlapping polls |
| `WizardStreamService` | `takeUntil(clientGone)` | one teardown path for both the response and the upstream reader |
| `SetupExitService` | `onEnter("ready")` | exits on the terminal phase only |
| `SetupGateService` | `implements OnApplicationBootstrap` + `open()` | the single writer of the gate: persists the choices, then publishes `launching` |

Rules when adding state:

- A mutator that changes observable state **MUST emit**. A silent mutation forces
  every consumer back to polling — that is exactly why the API's readiness used
  to poll.
- Use `BehaviorSubject` for STATE and a plain `Subject` for EDGES.
- Report the phase that matches the work. Collecting the operator's details is
  `collecting`; waiting for the API is `provisioning`; only the ingress swap is
  `handover` (`setup-phase.types.ts` documents each).

## Workflows

- Dev (compose-managed API): `bun --bun run setup`
- Type-check: `bun --bun run setup -- type-check`
- Test: `bun --bun run setup -- test:unit`
- Build (transpiles + runs the graph check): `bun --bun run setup -- compile`

## The handover invariants (load-bearing)

Each prevents a specific outage. Do not reorder them:

1. The API is polled to `/health/ready` **before** the ingress is touched.
   Swapping earlier points `api.<host>` at a process that is not serving.
2. `dynamic-api.yml` is retargeted **before** anything else, so the hostname
   changes BACKEND and never disappears (a missing router is a Traefik 404).
3. `dynamic-setup.yml` is rewritten **before** this app exits, so
   `setup.<host>` degrades to the done page rather than 404ing for an operator
   who bookmarked the wizard.
4. `ready` is published **last** — it is the signal that setup is about to exit,
   so publishing it early would report a platform that has not been handed over.

**The gate is NOT invariant 4.** It opened back at `launching`. `ready` means
"converged", which is a later and different fact — see the gate section above.

**Failure stays retryable.** A failed handover does not tear anything down, does
not rewrite the setup route, and does not exit: the phase goes `failed` with the
reason and the wizard offers a retry. Exiting would leave a dead container with
no surface to recover from.

## Boundaries

- **No business logic in packages.** `@repo/nest-*` exports mechanisms
  (`forRoot`-configured primitives, storage, network probing). The DECISIONS —
  which mode to enter, when to hand over, where the operator lands — live here.
- **No env var may be assumed from the API.** This app has its own
  `setupEnvSchema`; the package holds no schema at all. If a value is needed by
  both, each app declares it.
- `SETUP_MODE` is the ONLY behavioural branch. `dev` resolves the address compose
  will fill in; `prod` creates the service as a swarm task. Everything
  downstream — gate, retarget, exit — is identical, so the local path is a
  faithful rehearsal of a real deployment.
- Setup deliberately does **not** reimplement the mesh handshake or WireGuard
  (plan §5.5.1): the API's `RemoteInitializationService` executes that over HTTP,
  and WireGuard is a compose-provided sidecar. Writing either again here would
  duplicate code that already runs and is free to drift.

## References

- Plan: `docs/setup-app-refactor-plan.md` (§9.3 handover, §10 stream piping, §11 compose).
- Platform service model: `apps/api/AGENTS.md`.
