# Swarm Orchestration — 02 · Master Election Algorithm

> **Status:** Design finalized, implementation pending
> **Scope:** `apps/api/src/core/modules/swarm/election/**` + mesh mutations
> **Companion:** `03-master-takeover-failover.md` (failure & takeover), `docs/mesh/mesh-peer-selection-algorithm.md` (mesh stream peers — different concern, reused scoring primitives)

---

## 1. Goal

> "Master should be gathered around the mesh when multiple nodes exist so create an algo to find the perfect master."

Elect and maintain exactly **one controlling manager (master)** per swarm cluster, chosen by the mesh, such that:

1. The master is always a **swarm manager** (Raft quorum member).
2. The master is the **best** node: lowest latency to its peers, healthy, stable, with capacity headroom, and quorum-friendly.
3. Election is **hysteresis-gated** (no flapping), **term-guarded** (no split-brain), and **quorum-aware** (never elect a node that would lose the cluster).
4. `N=1` falls out naturally (the only node is master, term=1).

## 2. Definitions

- **Candidate**: eligible node — reachable (reachability module), authenticated (mesh identity), `docker info.Swarm.LocalNodeState == active`, swarm `NodeRole == manager` (or promotable worker kept as hot-standby manager — see §3 Eligibility).
- **Controlling manager (master)**: the single elected node. Persisted as `cluster.master = { nodeId, term, electedAt, reason }`.
- **Term**: monotonic epoch `T ∈ ℕ`, stored in shared PG and incremented on every successful election/takeover. CAS (`UPDATE ... WHERE term = :old`) is the write gate.
- **Quorum**: odd number of swarm managers, `Q = min(quorumMax, nodeCount)`, default `quorumMax = 3`. Only manager nodes count toward quorum.
- **Hot standby**: an eligible, non-master node that is **already a swarm manager** (so it can win without promotion latency).

## 3. Eligibility filter

A node must pass all gates to be a candidate:

1. **Mesh presence**: peer session active, latest heartbeat within `HEARTBEAT_TTL` (reuse `MeshPeerHeartbeatInput` from `SystemMeshTopologyService`).
2. **Reachability**: reachability module reports the node internally reachable (overlay/private network) — never elect an ingress/external-only node for cluster writes.
3. **Swarm membership**: `LocalNodeState == active` and `NodeRole ∈ {manager}` — read via dockerode (`DockerService.getSystemInfo()` + `swarmInspect()`); **workers are ineligible as master candidates by default**; promotion to manager happens at join time for designated hot-standby slots.
4. **Engine health** (NEW `ClusterProbe`, dockerode SDK only): `getSystemInfo()` ok, `dockerSystemDf()` within threshold, no lost quorum in the last window (`nodeList()` reachable-manager count).
5. **Term sanity**: node's view of `cluster.master.term` is not stale by more than `MAX_TERM_SKEW` (prevents a partitioned node from campaigning with an old view).

## 4. Scoring function (lower is better)

Reuse the normalized-metric approach of the mesh peer-selection doc. For candidate $i$:

| Metric | Derivation | Normalized |
|---|---|---|
| Latency $L_i$ | Authenticated ORPC mesh ping, p50 RTT over last cycle | $L_i = \frac{RTT_{p50}}{L_{budget}}$, clamped to $[0,1]$ |
| Jitter $J_i$ | $\frac{p95 - p50}{p50}$ clamped to $[0,1]$ | |
| Memory pressure $M_i$ | $\frac{used}{limit}$ from engine/telemetry | |
| CPU headroom $C_i$ | $\frac{free\ vCPU}{total\ vCPU}$ (higher is better) | used as $(1 - C_i)$ |
| Stability $S_i$ | alarm-weighted uptime: $S_i = 1 - \frac{\text{failures}_{window}}{\text{failureBudget}}$, clamped to $[0,1]$ (1 = stable) | |
| Quorum fit $Q_i$ | 0 if the node is already a manager and keeps the manager count odd; 1 if it would force an even manager count or a promotion | boolean-ish |
| Current master $H_i$ | 0 if node is the current healthy master, else 1 | used as hysteresis boost |

Score:

$$
Score_i = w_L L_i + w_J J_i + w_M M_i + w_C (1 - C_i) + w_S (1 - S_i) + w_Q Q_i + w_H H_i
$$

Default weights (sum to 1, quorum and hysteresis dominate):

$$
w_L = 0.30,\quad w_J = 0.10,\quad w_M = 0.10,\quad w_C = 0.10,\quad w_S = 0.15,\quad w_Q = 0.15,\quad w_H = 0.10
$$

Hard rules (cannot be overridden by weights):

- **Eligibility gate** (see §3) — non-eligible nodes never score.
- **Quorum preservation**: if the current master is healthy, no standby is chosen unless it beats the master by $\delta_{master} = 0.25$ (hysteresis) — the current master keeps its $H_i = 0$ advantage.
- **Odd-count constraint**: candidate manager count after election must be odd and $\ge 1$; if equal to `Q_max`, new candidates are only accepted as **worker** roles.
- **Tie-break**: deterministic — by ascending `nodeId` UUID when scores tie within $\epsilon = 10^{-6}$; this makes the algorithm reproducible.

## 5. Quorum sizing & standby slots

```text
Q   = min(quorumMax, nodeCount)            # default quorumMax = 3
Q   = Q % 2 == 0 ? Q - 1 : Q               # force odd
hot = Q - 1                                # master occupies 1 manager slot
```

Fleet-size handling:

| nodeCount | managers | master | hot standbys | notes |
|---|---|---|---|---|
| 1 | 1 | node1 (term=1) | 0 | winner-take-single |
| 2 | 2 (interim, even) | best of 2 | 1 | even quorum tolerated **only** as transition; UI warns; a 3rd node fixes |
| 3 | 3 | best of 3 | 2 | canonical minimum |
| 4–5 | 3 | best | 2 | extra nodes join as workers |
| 6+ | 3 | best | 2 | workers scale; managers fixed at `quorumMax` |

When `nodeCount` grows, the master **promotes** eligible workers up to `quorumMax` manager slots (if they can prove overlay reachability); when a manager leaves permanently, the master **demotes or replaces** to keep the count odd (Swarm's own `docker node demote` + join-token management).

## 6. Election protocol (steady state)

```text
every T_eval (adaptive: 15s stable → 5s when volatile):
 1. candidates = filterEligible(mesh + engine probes)
 2. if len(candidates) == 0: stay in "no master" mode (read-only cluster ops)
 3. scores = score(candidates)
 4. winner = argmin(scores)  (tie-break by nodeId)
 5. quorumPlan = ensureOddManagerCount(winner)
 6. if winner != currentMaster:
        if now < lastElection + COOLDOWN (default 60s): skip (hysteresis)
        if score(winner) < score(currentMaster) - δ_master: SKIP (hysteresis)
        startTakeover(winner)   → 03-master-takeover-failover.md
 7. else: refresh currentMaster.heartbeatAt (mesh event) + metrics
```

Winning is **declared once, atomically**:

```sql
-- shared PG, executed by the winner only
UPDATE cluster_master SET node_id = :winner, term = term + 1, elected_at = now()
 WHERE term = :observed_term
   AND (node_id = :current_master OR :current_master IS NULL);
-- 0 rows → someone else won concurrently → stand down
```

Then the winner emits a mesh event `cluster.master-changed { nodeId, term, reason }` so `MeshStreamRouterService` re-homes control-plane streams and all nodes refresh their cached master reference.

## 7. `N=1` behavior (single-node requirement)

- Candidates = `{self}`; score is trivially minimal; winner = self; term stays stable.
- **No special-case branch** — the loop above already handles a one-element candidate set, which guarantees the single-node dev/prod path exercises the exact election code.
- Master watchdog in `N=1` mode only validates local engine health (a dead single node has no one to take over; recovery is external restart → term increments on boot).

## 8. Relationship to mesh peer selection

| Concern | Peer selection (`mesh-peer-selection-algorithm.md`) | **Master election (this doc)** |
|---|---|---|
| Elects | $k$ stream peers per node | 1 controlling manager per cluster |
| Purpose | Event propagation topology | Cluster write authority + orchestration |
| Constraint | latency/load budget | Swarm quorum + eligibility |
| Persistence | transient, per-node | `cluster.master` + term in shared PG |
| Cadence | adaptive, per-peer | adaptive + event-triggered + cooldown |

Both re-use the same authenticated ping → normalized metrics → weighted score pipeline; the master election adds the quorum/CAS/hysteresis layer. **Implementation may share the metrics collector service.**

## 9. Config knobs (defaults)

| Knob | Default | Meaning |
|---|---|---|
| `SWARM_QUORUM_MAX` | 3 | max managers |
| `SWARM_ELECTION_EVAL_STABLE_MS` | 15_000 | evaluation interval when stable |
| `SWARM_ELECTION_EVAL_VOLATILE_MS` | 5_000 | interval when volatile |
| `SWARM_ELECTION_COOLDOWN_MS` | 60_000 | min time between takeovers |
| `SWARM_ELECTION_DELTA_MASTER` | 0.25 | hysteresis threshold vs current master |
| `SWARM_HEARTBEAT_TTL_MS` | 30_000 | master heartbeat TTL (watchdog) |
| `SWARM_MASTER_GRACE_MS` | 15_000 | suspect → confirmed grace window |
| `SWARM_MAX_TERM_SKEW` | 2 | max accepted term lag for candidates |

## 10. Failure modes included

- **Concurrent elections** → PG CAS makes exactly one winner; losers stand down.
- **Flapping** → cooldown + `δ_master` hysteresis + term monotonicity.
- **Even manager count** → §5 planning forces odd before/after takeover.
- **Master but no quorum** → see `03-master-takeover-failover.md` §3 (quorum-loss guard): never take over into a broken cluster.
- **Partitioned candidate** → term-sanity + reachability gates exclude it.