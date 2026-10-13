# 13 — Readiness & Boot Gating

> **Status:** canonical — describes the mechanism implemented in
> `apps/api-services/shared/src/server/preflight/**` and `bootstrap.ts`.
> **Answers:** how an app proves it can serve, why the port binds first, and who
> answers "is it healthy?".

## 13.1 The problem

"Is the process running?" and "can it do its job?" are different questions, and
conflating them is how a boot reports success while every request fails.

A service whose database does not exist yet is **running and useless**:

- Nest resolves the DI graph;
- the port binds;
- `/health` returns `200`;
- the first real query throws `relation "projects" does not exist`.

An orchestrator watching only liveness sees a healthy service and routes traffic
to it. The failure surfaces as a 500 on a user request, with a stack trace that
names a table instead of the missing bootstrap step.

## 13.2 The two-part claim

Starting an app is therefore split into two claims, checked separately:

| Claim | Checked by | Failure looks like |
|---|---|---|
| The app **assembled** — DI resolved, modules loaded | Nest (`init()`) | boot crash |
| Its **dependencies are usable** — DB reachable, schema applied, Redis up | **preflight** | exit 5, readiness 503 |

Only the second passing makes the app report READY, and only READY gates traffic.

## 13.3 The checks

Two layers, deliberately separate:

**Boot gate** (`shared/server/preflight/checks.ts`) — pure functions over an
injected context (no DI, no `pg` import), run ONCE at boot:

| Check | Proves |
|---|---|
| `checkDatabase` | a trivial query round-trips |
| `checkMigrations` | `drizzle.__drizzle_migrations` exists and is non-empty |
| `checkRedis` | a TCP connect succeeds |

**Live indicators** (`shared/server/health/indicators/**`) — Terminus
`HealthIndicatorService`-based, run CONTINUOUSLY, and streamed:

| Indicator | Proves | Detail it reports |
|---|---|---|
| `database` | a real round-trip through the app's own pool | server version, latency, a classified cause on failure |
| `migrations` | the journal exists and has entries | applied count, latest timestamp |
| `redis` | a real `PING`/`+PONG` exchange (not just TCP) | latency, host |
| `memory` | heap ratio against the cgroup ceiling | heap used/total, RSS, container ratio |
| `disk` | `statfs` free-space ratio on the data volume | total GB, free GB, ratio |

Both layers share ONE definition of what "ready" means, but they answer at
different times: the gate decides whether the port may serve traffic, the
indicators report what is true now and what changed.

### Why `redis` is a PING and not a TCP connect

A TCP connect proves a socket was accepted. A Redis server can accept the socket
and still be unusable — reloading its dataset from an AOF file after a restart
answers TCP and refuses commands with `-LOADING`. Requiring `+PONG`
distinguishes the two, and RESP for `PING` is written by hand rather than adding
a client dependency to every service.

Each boot check is wrapped so it **never throws and never hangs**: a thrown error
becomes a failed check (because a report that can throw reports nothing), and a
connect is bounded so a black-holed host fails rather than blocking the boot.

## 13.4 Boot ordering — the load-bearing part

```text
bootstrapApiServer({ rootModule, port, name, dependencies })
  1. NestFactory.create(...) + app.init()      graph resolved
  2. app.listen(port)                          ★ PORT BINDS HERE
  3. PreflightService.run()                    dependencies proved
  4. not ready → app.close() + throw DependencyNotReadyError
  5. main.ts catches → exit 5
```

**Step 2 before step 3 is deliberate, not an optimisation.** A compose or swarm
healthcheck whose target port does not exist yet reports the task as **DEAD**, and
the orchestrator then restarts a process that is merely waiting for its database —
a restart loop that never converges.

Binding first means the probe always gets an answer, and the answer during startup
is the honest one:

```text
GET /health        → 200   (the process is alive)      ← from the moment the port binds
GET /health/ready  → 503   (dependencies not proved)   ← until preflight passes
```

This is verified by an integration test
(`shared/src/server/__tests__/boot-gating.integration.spec.ts`) whose captured logs
show `Nest application successfully started` **before** `Preflight: Dependencies
NOT ready` — the ordering is asserted, not assumed.

## 13.5 Waiting, and when not to

Two policies, because the callers want opposite things:

| Policy | Used by | Behaviour |
|---|---|---|
| `WAIT_FOR_DEPENDENCIES` (60s, retry every 2s) | an app at boot | a dependency that is still starting is the **normal** case — a swarm task being scheduled, a Postgres initialising. Giving up immediately turns a slow start into a failed one. |
| `REPORT_ONLY` | a caller asking a question | an operator wants an answer now, not after a minute of retrying. |

The **suite** is retried as a unit, not per-check: dependencies start together
(one scheduling window), so re-checking only what failed buys nothing and makes
the report inconsistent between attempts.

## 13.6 The verdict is cached (and that is correct)

Preflight runs **once**, at boot, and its verdict is what `/health/ready` reports
for the life of the process.

Re-running the suite per probe would be wrong twice over: it queries the database
every interval forever (the interval is a compose/swarm setting this process does
not control), and it turns a transient blip into a decision.

A dependency that fails *after* boot is a **different condition with a different
owner**: the swarm restarts the task, and `deployer status` reports the roll-up
([10](./10-developer-journeys.md) §10.7). Boot readiness answers "may traffic be
routed here?", which is a question about startup.

## 13.7 One verdict, two consumers

`PreflightModule.forRoot({ dependencies })` binds `SERVICE_READINESS` to the
preflight verdict with `useExisting`, so:

- the **boot gate** (`bootstrapApiServer`) and
- the **readiness endpoint** (`/health/ready`)

are the same answer by construction. They cannot disagree, because there is one
object.

A dependency set is declared per app, because it is a property of the app:

```ts
DEPENDENCIES.none      // serves only its own probes
DEPENDENCIES.database  // Postgres reachable AND migrated
DEPENDENCIES.platform  // the above + Redis
```

A service that forgets to require the database is a **visible** omission in its
root module rather than a silent one that fails its first request.

## 13.8 Who answers "is it healthy?"

Three answers, three owners, and they must not be confused:

| Question | Answered by | Mechanism |
|---|---|---|
| Is this container alive? | **swarm** | the service's `healthcheck` (`/health/ready` in compose/swarm); a failing task is restarted |
| May traffic be routed here? | **preflight** → `/health/ready` | 503 until this process proved its own dependencies |
| Is the platform fine? | **the BFF** | it composes every service's `/health/ready` into one roll-up |

There is **no supervisor app** ([07](./07-swarm-runtime.md) §7.6): the swarm owns
restart and rescheduling, preflight owns each app's own honesty, and the BFF only
aggregates for humans.

### Deferral is not failure

A dependency that does not exist *yet* is reported honestly as "not ready", not as
"broken". The distinction is what stops a normal, in-progress boot from looking
like an incident.

## 13.8b Streaming health (rxjs)

`/health/ready` answers one question at one instant. The questions an operator
ACTUALLY has are about change — "is it still up?", "when did the database go
down?", "has it recovered?". Those are streams, so the registry owns one:

| Stream | Emits |
|---|---|
| `HealthRegistry.snapshots$` | every completed pass (`shareReplay(1)`, so a late subscriber gets the current value instantly) |
| `HealthRegistry.changes$` | **only transitions** — `distinctUntilChanged` on a stable `name:status` signature, so an unchanged picture emits nothing |
| `HealthRegistry.indicator$("database")` | one indicator's verdicts across passes |

Exposed over **SSE** at `GET /health/stream`, with a 15-second heartbeat so a
proxy does not close an idle connection and a client can tell "nothing changed"
from "the stream died". SSE rather than a WebSocket because the flow is one-way
and SSE reconnects on its own.

Why this and not polling: building transitions from a polling function means
every consumer re-derives them, which is how two components end up disagreeing
about whether a service is healthy.

**The pass runs checks in parallel** (`mergeMap`), with a per-check timeout so a
hung dependency fails its own check instead of stalling the pass. Results are
collected with `toArray`, which preserves DECLARATION order regardless of
completion order — the payload is stable between passes.

**The cadence is chained, not `setInterval`**, so a slow pass can never stack on
the next one (the same correction the monolith's readiness service documents).

## 13.8c Where each health surface lives

| Surface | Port | Answers | Cost |
|---|---|---|---|
| `GET /health` | app's own | liveness — never touches a dependency | O(1) |
| `GET /health/ready` | app's own | the gate: 503 until preflight passed | O(1), cached |
| `GET /health/stream` (SSE) | app's own | transitions, as they happen | one background pass per interval |
| `GET /health/detailed` (contract) | app's own | the full Terminus report, on demand | one pass per call |
| `GET /health/platform` | **BFF** | the roll-up across every service | N probes |

## 13.9 Reuse by the CLI

The checks are pure functions over an explicit context specifically so the CLI —
which has no Nest container — can run the **same** definition of "the database is
ready" that the apps do, instead of drifting into a second one.

`deployer status` combines:

```text
deriveNodeState({ setupState, platform })   ← pure, from shared/server/node-status.ts
   setupState : node_config.setupState      ← local file read (works with nothing running)
   platform   : the BFF roll-up             ← null when nothing answers
```

which is why `deployer status` is correct even when the platform is completely
down ([01](./01-lifecycle-and-ownership.md) §1.2).

## 13.10 Exit codes

| Code | Meaning |
|---|---|
| `0` | success (including `provisioning` — in flight is not a failure) |
| `1` | generic failure |
| `3` | configuration required (`INACTIVE`) |
| `4` | platform unhealthy (`DEGRADED` / `FAILED`) |
| `5` | engine or **dependency** unavailable (`STOPPED`, or preflight failed) |
| `6` | authentication required (CLI client mode) |

`DependencyNotReadyError` carries the full report, so the operator sees **which**
dependency and **why** — `database (connect ECONNREFUSED …, migrations (none
applied))` — rather than "a dependency failed".
