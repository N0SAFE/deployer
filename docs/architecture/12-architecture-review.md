# 12 — Architecture Review

> **Status:** canonical. An adversarial pass over docs 01–11, with the findings
> that changed the design and the ones that remain open.
> **Method:** every load-bearing claim was checked against the actual code and
> against the other documents. Contradictions are recorded here rather than
> smoothed over.

---

## 12.1 Findings that changed the design

### F1 — The configurator cannot be a platform service *(was contradictory)*

**Problem.** Docs 01 and 04 listed `configurator` as a service under
`apps/api/services/`. Doc 02 describes the configurator being started while the
node is `INACTIVE` — i.e. **before any platform exists**. A fresh node has no
swarm and no running services, so nothing could host it. The design was
self-contradictory.

**Resolution.** The configurator is **not** a platform service. It is either:

- **remote infrastructure** — the shared relay + versioned static UI, which is
  what the tunnel path uses; or
- **served directly by the CLI** on `127.0.0.1` — the local-browser path, used
  when CLI and browser are on the same machine (dev, and the simplest single-node
  install).

Same protocol, two transports. `apps/api/services/configurator` is deleted from
the layout; nothing in `apps/api` implements the relay.

**Follow-up:** if an operator wants a self-hosted relay, it is a *separate*
deployable artifact, not an API service. Recorded as a non-goal.

---

### F2 — Auth has a second writer the table did not admit *(was false by omission)*

**Problem.** Doc 04 said "a table has exactly one owning service" and assigned
users/permissions to `svc-identity`. But Better Auth's `user`/`session`/`account`/
`verification` tables are written by Better Auth, which runs **in the BFF**. So
either the rule was wrong or the design was.

**Resolution.** Stated explicitly (doc 04, "the two deliberate single-writer
exceptions"):

- `auth_*` is written **only by the BFF** — session validation happens on every
  request, and a network hop to `svc-identity` per request would make identity a
  hard dependency of all traffic;
- `svc-identity` owns everything *after* identity (permissions, roles,
  preferences) and reads the actor from the forwarded claim.

The alternative (auth in `svc-identity`, BFF calls it per request) was rejected
on latency and coupling grounds. The rule now matches reality instead of hiding it.

---

### F3 — One database, N services: the exit path had to be made real

**Problem.** "Services own their tables" is only an honest claim if the ownership
can actually be enforced. All four services share one Postgres.

**Resolution.** Two rules make it enforceable without splitting databases today:

1. FKs are allowed **within** an owner's tables only.
2. A cross-service reference is an **ID + a validation call**, never a FK.

So extracting an owner is mechanical: move its tables, delete its validation
call. And cross-owner reads never `JOIN` — the BFF joins in code, which is also
what makes §4.2's "not a proxy" claim testable.

**Residual risk.** Without a lint or a runtime guard, rule 2 is a convention. A
`svc-*` importing another service's repository is still *compilable*. **Open item
O1.**

---

### F4 — The CLI must be the sole `node_config` writer, and the docs said "CLI and services"

**Problem.** Docs 02 and 08 implied the platform provisioned itself from
`node_config` while the CLI also wrote it. Two writers to the state that decides
"is this node configured" is the exact class of bug the old design had.

**Resolution.** `node_config` has **one writer: the CLI**. Everything else reads
it. The BFF's bootstrap module runs migrations and creates the admin, but it is
**invoked** by the CLI's provisioning step and never decides setup state.
The rule is now in doc 04's exception table.

---

### F5 — Port offsets vs the real dev ports *(flight-checked)*

Doc 06 defines `DEPLOYER_PORT_BASE + offset` (web 3000, bff 3005, services
3006+, configurator 3010). The **existing** dev stack uses `API_PORT=3005` and
`web:3000`, which agrees — so the new scheme does not break `dev:api`/`dev:web`
habits, and the offsets can be adopted without a migration window.

One conflict: the old stack used `3010` for the **setup wizard**. With setup gone
and the configurator served by the CLI, `3010` is free for the local configurator
UI. No collision remains.

---

## 12.2 Findings that are inherent trade-offs (accepted, not "fixed")

### T1 — The BFF is a single point of failure for the public surface

**Accepted.** Every alternative (browser talks to N services) moves routing,
auth and composition into the browser, which is worse. Mitigations are already
structural: the BFF is stateless (session lives in Postgres), and the swarm can
run more than one replica. Documented as expected operational behaviour rather
than hidden.

### T2 — Cross-service latency for a screen needing three services

**Accepted.** The BFF fans out with `Promise.all`, so the added latency is one
hop, not three sequential. This is the price of the boundary, and it is paid at
read time only.

### T3 — The configurator requires egress from the node

**Accepted.** The outbound tunnel is the whole point of the design (no inbound
port). A node with **no** internet and no reachable relay falls back to the
CLI-served local UI (F1) — which covers the air-gapped case without changing the
protocol.

### T4 — Two dev profiles that behave differently

**Accepted, and now documented.** `plain dev` (compose owns processes) and
`dev-supervised` (the platform owns them) genuinely differ. Doc 10 makes the
difference explicit with a profile-selection table, because the failure of *not*
documenting it is a developer debugging a swarm problem in a profile with no swarm.

---

## 12.3 Remaining structural gaps (open items)

| # | Gap | Impact | Proposed resolution |
|---|---|---|---|
| **O1** | Cross-service ownership (F3) is convention-only | an accidental cross-owner JOIN compiles and works today, then blocks the exit path | an ESLint rule on `apps/api/services/**` forbidding imports of another service's `repositories/`; plus an integration test asserting no query touches a foreign table |
| **O2** | `deployer configure` is specified but the **revision/implementation** path for a *change* (as opposed to a first install) is not fully worked | a config change could take a different route than first-run, reintroducing two paths | extend doc 03 with the change case: same revisions, same pipeline, the diff computed by the CLI |
| **O3** | Who owns `svc-fleet`'s "engine facts" the BFF shows for `deployer status` | `deployer status` needs engine/swarm facts that are read from the **local** Docker socket | `svc-fleet` reads them on the node that runs it and exposes them; the CLI's local `doctor` reads them directly. Two readers, one truth (the engine) — no shared state |
| **O4** | The relay's own deployment (uptime, scaling, storage) | the tunnel path depends on infrastructure not described here | out of scope for this series; it is a separate deployable. Until it exists, the local-browser path (F1) is the supported default |
| **O5** | The web app's env still contains `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_API_URL` | doc 06 says prod derives origins from one domain | covered by Phase 3 of doc 09; listed so it is not forgotten |
| **O6** | `packages/contracts/api` still contains the `setup` module and a `template` module with zero implementations | dead contract surface after this redesign | Phase 2 deletes `setup`; `template` needs a decision (implement or delete) |

---

## 12.4 Structural gaps found by **cross-checking against the actual code**

### C1 — The 67 cross-module imports are real work, not a footnote

Measured on the current tree: 67 imports cross module boundaries inside
`apps/api/src/modules/**`, dominated by `deployment → providers` (7) and
`providers → shared` (6). Under the new rules these become **cross-service calls**
or move to `shared/`.

This is the single largest piece of real work in the migration and it is **not**
mechanical: `deployment → providers` means the deployment service needs provider
resolution, which is either (a) a BFF-composed call, or (b) a provider-resolution
policy promoted to `shared/core`. Deciding per-case is design work, scheduled in
Phase 5 (doc 09).

### C2 — `apps/api/src/core` is larger than `apps/api/src/modules`

327 files vs 221. The "shared" side of the split is the *bigger* side. This is
why Phase 0 (extract `shared`) came first and is already green: doing the modules
first would have left the shared platform tangled in every moving piece.

### C3 — `template` and `events` contract modules are registered but unwired

`template`: 16 operations, zero implementations. `events`: fully implemented but
never mounted. Both are pre-existing, both are now visible dead surface. Doc 09
Phase 2 deletes or implements them rather than carrying them into the new layout.

---

## 12.5 Is the architecture "strong"? — the specific claims, graded

| Claim | Verdict | Evidence |
|---|---|---|
| A fresh node can come up with no server running first | **holds** | the CLI is the entrypoint; `node_config` is a local file (F4) |
| A first run and a restart share one boot path | **holds** | both converge on the same boot-existing steps (doc 08 §8.1 vs §8.2) |
| `deployer status` works when everything is down | **holds** | derived from a file + the engine (doc 10 §10.7) |
| The BFF is not a proxy | **holds, and is testable** | screen modules have no repository; cross-owner joins happen in code (F3) |
| Services are independently ownable | **holds, convention-guarded** | F3 + open item **O1** |
| The public URL surface is unchanged | **holds** | the BFF composes the same `appContract` (doc 04 §4.4) |
| No `*.deployer.localhost` anywhere | **planned, not yet true** | 166 refs remain; Phase 3 (doc 09) |
| No orchestrator / supervisor app | **holds** | deleted this change set; ownership reassigned to the swarm (doc 07 §7.6) |

**Honest summary.** The load-bearing structural claims hold, and the two that did
not hold when first written (F1, F2) were real contradictions that are now fixed.
The remaining weaknesses are either explicit trade-offs (T1–T4), open items with
proposed resolutions (O1–O6), or scheduled migration work (C1–C3). Nothing is
claimed as done that is not: the `deployer.localhost` removal and the service
split are **planned**, with Phases 2–5 in doc 09.
