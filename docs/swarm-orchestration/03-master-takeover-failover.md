# Swarm Orchestration — 03 · Master Takeover & Failover

> **Status:** Design finalized, implementation pending
> **Scope:** `apps/api/src/core/modules/swarm/election/watchdog.*`, `takeover.*`
> **Companion:** `02-master-election-algorithm.md` (election), `04-node-sharing-and-placement.md` (roles)

---

## 1. Goal

> "Define how the master should take over."

Define the **failure-detection → grace → quorum check → election → takeover → recovery** protocol so that:

1. A dead or partitioned master is replaced automatically and safely.
2. The cluster never elects into a lost-quorum state (no split-brain, no zombie master).
3. The old master, if it returns, **steps down** (term + role enforcement) instead of fighting.
4. Hot standbys take over **without promotion latency** (they are already swarm managers).

## 2. Roles recap

| Role | Swarm role | Platform role | Can become master? |
|---|---|---|---|
| Master (controlling manager) | manager (Leader/Reachable) | owns cluster writes, `cluster.master` | — (is master) |
| Hot standby | manager (Reachable) | keeps Raft quorum live, eligible immediately | ✅ yes (no promotion needed) |
| Worker (shared node) | worker | executes user tasks | ❌ not directly — must be promoted to manager first (only during re-quorum) |
| Edge node (no cluster) | none | mesh-only | ❌ excluded by eligibility (§3 of `02`) |

## 3. Failure detection (watchdog)

Every node runs a `MasterWatchdog` that observes the master via the mesh heartbeat topic (reuse `MeshPeerHeartbeatInput`/SSE streams):

```text
state machine per candidate master:
  HEALTHY ──(no heartbeat / RTT>budget for HEARTBEAT_TTL)──▶ SUSPECT
  SUSPECT ──(heartbeat resumes)──▶ HEALTHY
  SUSPECT ──(grace expires: SWARM_MASTER_GRACE_MS)──▶ CONFIRMED_DOWN
  CONFIRMED_DOWN ──(trigger election, quorum-aware)──▶ ELECTION

always: if the swarm control plane is healthy, prefer it as the source of truth (dockerode SDK, no CLI):
  - `DockerService.nodeList()` + `nodeInspect()` on any manager reveals master engine/daemon state.
  - If Raft still reports the old master as Reachable → stay HEALTHY (network partition, do NOT take over).
```

Key rule: **mesh silence is not proof of daemon death.** Cross-check with `docker node ls` (Raft view) before declaring `CONFIRMED_DOWN`. This is what prevents split-brain when the mesh path dies but the swarm control plane lives.

## 4. Quorum-loss guard (the most important gate)

Before ANY takeover:

```text
quorum_intact = reachable managers ≥ floor(Q / 2) + 1      # Q = odd manager count
if !quorum_intact:
    → do NOT elect. Swarm is in a Raft quorum-loss state.
    → enter read-only cluster mode; surface a blocking incident to ops.
    → recovery is operator-assisted (the ONE case CLI is legitimate — there is
      no SDK/API equivalent for re-initializing a lost Raft store):
         docker swarm init --force-new-cluster   (single surviving manager)
      followed by re-joining lost nodes as workers.
      All other paths in this doc are dockerode SDK calls.
```

Rationale: if more than half the managers are unreachable, Swarm itself refuses to converge (Raft). A mesh-level election would produce a **phantom master** that swarm ignores. The platform must respect Raft and only take over when the swarm control plane can actually act.

Special case — **single-node**: quorum is 1, the only manager is always "intact"; recovery is external (restart the host/daemon), and on boot the survivor re-initializes itself (`cluster.master = self, term++`).

## 5. Takeover protocol (quorum intact)

```text
1. ELECTION triggered (watchdog CONFIRMED_DOWN | node join | config change)
2. eligible = filterEligible(mesh + engine probes)          # 02 §3
3. winner = argmin(score(eligible))                         # 02 §4
4. winner attempts CAS UPDATE cluster_master (term+1)       # atomic, single winner
       ├─ success → winner becomes master → continue
       └─ 0 rows → another node won → stand down, refresh cache
5. winner performs cluster takeover tasks, in order (all dockerode SDK):
   a. verify quorum via `DockerService.nodeList()`; promote self if needed (only
      when it was demoted worker — rare; hot standbys skip this step)
   b. re-sync join tokens from swarm secrets; rotate if the old master might
      still hold them (only on confirmed death, not partition)
   c. for each swarm service: verify desired state matches DB (reconcile)
   d. for each Traefik route: verify labels present (traefik swarm provider
      re-reads automatically; only verify, do not hand-write)
   e. emit mesh event `cluster.master-changed { nodeId, term, reason }`
   f. update `cluster.master` cache on every node (stream re-home)
6. standby managers that did NOT win: remain Reachable, adopt new master.
7. the pre-takeover master, if it returns:
       - sees its own term is stale (master.term > its term)
       - sees its swarm role now `Reachable` (not Leader) or demoted
       → STEPS DOWN automatically: marks own platform role as standby,
         updates cache, never issues cluster writes again.
```

**Split-brain prevention matrix:**

| Situation | Guard |
|---|---|
| Two nodes both think they are master | PG CAS — only one `UPDATE` succeeds |
| Old master returns after failover | term comparison → step down (protocol step 7) |
| Mesh partitioned but Raft intact | §3 cross-check → no takeover at all |
| Raft lost quorum | §4 gate → no election, incident |
| Master watchdog on a non-manager | ineligible (02 §3) → never campaigns |

## 6. Takeover during an active deployment

- Deployments are owned by `ownerNodeId` (existing mesh "resolve deployment" handler). The master is the **default execution owner** only when placement is cluster-wide.
- On takeover, in-flight `docker service` operations are **not aborted** — Swarm continues the update on its own (services are cluster-agnostic to the API node executing them). The new master re-attaches to the service state from Swarm and reconciles the DB.
- Truly stateful executors (direct-container path — only for edge nodes) are **never** eligible for cluster takeover; their ownerNodeId semantics stay as today. See `04` §6.

## 7. Recovery & return-to-steady-state

1. After takeover: master runs `ClusterService.reconcile()` → `cluster.nodes` inventory matches `docker node ls` (labels, roles, availability).
2. If hot-standby count < `Q - 1` (the dead node was a manager), the master **promotes** a designated worker to manager (odd-count plan, 02 §5) or, if the dead node comes back, re-joins it with a fresh token.
3. Term keeps incrementing on every election — the DB retains a `cluster_master_history` table (audit trail: nodeId, term, electedAt, reason, howLong).
4. Ops/UI: read-only mode flag clears only when a new master holds `cluster.master` with a valid `heartbeatAt` and `docker node ls` shows full quorum.

## 8. Configuration (defaults)

| Knob | Default | Meaning |
|---|---|---|
| `SWARM_HEARTBEAT_TTL_MS` | 30_000 | max silence before SUSPECT |
| `SWARM_MASTER_GRACE_MS` | 15_000 | SUSPECT → CONFIRMED_DOWN |
| `SWARM_TAKEOVER_MIN_UPTIME_MS` | 120_000 | winner must be up before takeover (prevents takeover churn) |
| `SWARM_FORCE_NEW_CLUSTER_HELP` | — | admin-only recovery path, documented in UI incident view |

## 9. Failure mode encyclopedia (test matrix input)

| Scenario | Expectation |
|---|---|
| Master process killed, host alive | SUSPECT → grace → `docker node ls` shows Manager Down → quorum ok (2 of 3) → standby elected → services keep running |
| Master host dies, 2 standbys alive | same as above; takeover in ≤ TTL + grace |
| 2 of 3 managers die | quorum lost → **no election**, incident, `--force-new-cluster` on survivor |
| Master engine wedged, mesh fine | Raft marks Manager Unreachable → takeover via swarm truth |
| Mesh links down, swarm fine | §3 cross-check keeps master; no takeover (streams re-home via `MeshStreamRouterService` when links return) |
| Old master returns | term stale → step down → rejoin low-latency pool |
| Partitioned 4th node campaigns | term-sanity + reachability gates exclude it |
| Takeover mid-service-update | Swarm continues update; DB reconciled after |
| Single node restarts | boot self-election (term++) — same code path as multi-node