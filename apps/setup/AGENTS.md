# AGENTS.md — apps/setup (NestJS)

Follow the root `AGENTS.md` first. This file adds setup-app-specific guidance.

## What this app is

A **one-way onboarding app**. It exists to get the platform onto a cluster and
then get out of the way:

1. found or join the swarm,
2. serve the wizard and drive the API to provision,
3. hand the entry port over,
4. exit.

It is NOT "the API in a special mode". That arrangement is what this app
replaces: the API used to boot pre-setup, run a sub-app pipeline, and swap a
gateway fallback at runtime. The API now boots one normal graph and this process
covers the phase before it.

## Scope Rules

- Read this file before changing any code in `apps/setup/`.
- **Never add a product feature here.** No auth, no project/docker/deployment
  surfaces, no global Postgres. Those belong to `apps/api`, which starts only
  after this app has finished.
- The wizard is a **pipe**, never a second producer: the setup contract
  (`/setup/*`) is implemented ONCE, in the API, because provisioning needs the
  Drizzle schema, migrations and the auth stack. This app forwards.
- Setup writes only **two** Traefik files (`dynamic-api.yml`,
  `dynamic-setup.yml`). Every other dynamic file belongs to the API, and writing
  one here would be a second writer for the same file.

## Architecture: event-driven, no polling

Every state change is published and every consumer subscribes. There is **zero**
`setInterval` in this app.

| Service | Primitive | Why |
|---|---|---|
| `SetupPhaseService` | `BehaviorSubject` for state, plain `Subject` for edges | a late reader gets the current value, but an EDGE is never replayed (replaying "on failure, recover" would re-fire handled work) |
| `ClusterOrchestratorService` | `concatMap` over a `Subject` | serialises attempts so a retry cannot race the engine founding a cluster |
| `HandoverOrchestratorService` | `concatMap`, `filter` on the stream | reacts to the cluster result instead of polling a phase; serialises retries so two handovers cannot race on the same two ingress files |
| `ApiReadinessWatcherService` | `timer` + `switchMap` | `switchMap` CANCELS an in-flight probe, so a slow API cannot accumulate overlapping polls |
| `WizardStreamService` | `takeUntil(clientGone)` | one teardown path for both the response and the upstream reader |
| `SetupExitService` | `onEnter("ready")` | exits on the terminal phase only |

Rules when adding state:

- A mutator that changes observable state **MUST emit**. A silent mutation forces
  every consumer back to polling — that is exactly why the API's readiness used
  to poll.
- Use `BehaviorSubject` for STATE and a plain `Subject` for EDGES.
- Report the phase that matches the work. Waiting for the API is `driving`; only
  the ingress swap is `handover` (`setup-phase.types.ts` documents each).

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
4. `ready` is published **last** — it is what compose gates on, so publishing it
   early starts the dashboard on a half-handed-over platform.

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
- `SETUP_MODE` is the ONLY behavioural branch. `dev` waits for the
  compose-managed API; `prod` creates it as a swarm service. Everything
  downstream — gate, retarget, exit — is identical, so the local path is a
  faithful rehearsal of a real deployment.
- Setup deliberately does **not** reimplement the mesh handshake or WireGuard
  (plan §5.5.1): the API's `RemoteInitializationService` executes that over HTTP,
  and WireGuard is a compose-provided sidecar. Writing either again here would
  duplicate code that already runs and is free to drift.

## References

- Plan: `docs/setup-app-refactor-plan.md` (§9.3 handover, §10 stream piping, §11 compose).
- Platform service model: `apps/api/AGENTS.md`.
