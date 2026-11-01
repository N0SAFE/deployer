# Multi-hop relay

Status: **built and tested** (2026-10-31). This document is the design and the implementation record; the "Phase" section
below is kept as the plan it was executed from, with the deviations recorded at the end. Everything else in the mesh —
overlay, doors, token enrollment, rotation, labels/blocks, lazy links, gossip fan-out, peer routers, swarm mode,
onboarding — is in code and tested too.

## 1. Why

Today a relayed call is at most two agent hops: the caller's agent opens a link to the target node's agent and pins the
call there (`MeshRelay.relay`, `request.node !== self`). Links are lazy and pooled, so steady-state connections are no
longer the problem; gossip fan-out bounds chatter. The remaining case is a fleet where two agents **cannot open a link to
each other at all** (firewalled segment, NAT without a hole, a node that can only dial its neighbour). Today such a
target is simply unreachable, even though a third agent can reach both.

Multi-hop relay lets an agent that cannot reach the target hand the call to an agent that can, without changing how a
caller addresses anything.

## 2. Goals / non-goals

Goals:

- A pinned relay (`target.node`, `roster.view`, terminal/session traffic, any future node call) succeeds through one or
  more intermediate agents when a direct link is impossible.
- Bounded: max hops, max next-hop attempts, loop detection, no retries on target errors.
- Streaming unchanged: a stream through N hops is still pulled element by element, and cancelling the caller closes
  every hop.
- No new privilege: every hop is credential-authenticated exactly like today; the caller's headers still ride along.
- Observable and killable: counters plus `MESH_RELAY_MAX_HOPS=0`.

Non-goals:

- A routing protocol / topology discovery. Agents already know every node through gossip; multi-hop only chooses among
  known agents.
- Source routing (the caller naming hops). It leaks topology into the caller and breaks the "name a service, not a
  replica" abstraction.
- Load balancing across paths. The first hop that answers wins, deterministically ordered.
- A netns/firewall e2e in CI. Routing is covered with injected links; a real partition test belongs in the opt-in e2e
  harness.

## 3. Design

### 3.1 One contract, one new field

Reuse `relay.call` instead of adding `relay.forward`: the pinned path already forwards, and the relay's output is an
event iterator. A second procedure would duplicate the streaming contract.

```ts
// packages/contracts/node-agent/mesh/relay/call.ts
export const meshRelayViaSchema = z.object({
  /** Agents already visited, oldest first. The receiver appends itself. */
  visited: z.array(z.string().min(1)).max(16).default([]),
  /** Remaining agent hops. The receiver refuses at 0. */
  ttl: z.number().int().min(0).max(8),
});

export const meshRelayInput = meshTargetSchema.extend({
  // ...existing fields
  /** Present only on a call that already travelled: the receiving agent forwards it instead of granting a lease. */
  via: meshRelayViaSchema.optional(),
});
```

`via` is advisory routing metadata, validated and clamped by each receiver (length ≤ 16, `ttl` ≤ 8). A peer that lies
about `visited` only affects its own path.

### 3.2 Receiver algorithm

In `MeshRelay.relay`, the pinned branch becomes:

```
if target.node is set and != self:
    if request.node in (request.via?.visited ?? []): fail MeshRelayLoop
    if via is present and via.ttl == 0: fail MeshNoRoute
    if isUnreachable(target.node): return forward(target.node, request)   // negative cache
    try:
        link = linkTo(target.node)                     // lazy, pooled
        events = link.call(["relay","call"], { ...request, via: nextVia(request, self) }, { headers })
        return events
    catch transportFailure:
        markUnreachable(target.node, MESH_RELAY_UNREACHABLE_MS)
        return forward(target.node, request)
```

`forward` picks a next hop and repeats the same call with `via = { visited: [...visited, self], ttl: ttl - 1 }`. It
carries the whole request (target, path, input, headers) unchanged — the next agent runs the same algorithm, so a 3-hop
path is just the same call nested twice.

At the target's agent the call is served by the ordinary branch (resolve by key/locality/load, broker). **A forwarded
request never grants a lease**: the caller cannot reach the replica directly (that is why it forwarded), so `via` present
skips the `leaseReason`/`grantDirect` branch and always brokers. `direct`/`heavy` are ignored on forwarded requests.

### 3.3 Choosing the next hop

`NodeAgents` learns every node from gossip, but not who can reach whom. Use provenance and determinism:

- Track `learnedFrom` per known agent: `absorb` calls `know(agent, incoming.from.nodeId)`; keep a set of sources.
- Candidates: known agents minus self, target, `visited` and negative-cached nodes.
- Order: (1) agents that taught us the target (`learnedFrom` contains the target) — they demonstrably exchange with
  it; (2) agents with the most recently refreshed records; (3) remaining agents sorted by `nodeId` for determinism.
- Try at most `MESH_RELAY_NEXT_HOP_ATTEMPTS` candidates (default 2); the first that answers wins. Each attempt is the
  same nested call with its own ttl.
- If none answers: `MeshNoRoute` (typed), with the target and the hops tried.

### 3.4 Failure classification

Forward only on **transport** failure (the link could not open, the websocket dropped, a dial timeout). A target that
answers — even with an error, a redirect or a lease — is never retried elsewhere: that would turn one call into N calls
with side effects. Concretely: the direct attempt catches non-`ORPCError` errors (wrapped today as `BAD_GATEWAY` by
`toOrpcError`) and forwards; an `ORPCError` from the peer is returned unchanged.

### 3.5 Streaming and cancellation

The intermediate agent returns the next hop's event iterator as its own `events`; `relayEvents` already `return()`s the
iterator in `finally`, so cancelling at the caller propagates one hop at a time. Test a 2-hop stream and a mid-stream
cancel; assert every fake iterator was closed.

### 3.6 Security

All hops use the same swarm credential and the same transport verification. Forwarding adds no capability: any agent
could already call any other. `visited`/`ttl` are bounded to prevent payload abuse; the caller's headers are forwarded
untouched (the target still authenticates the original caller); no hop sees a session it did not already carry.

### 3.7 Observability

- In-memory counters per agent: `forwarded`, `noRoute`, `unreachable` (exposed as `node.status.relay`, additive).
- A warn line per `MeshNoRoute` naming target and visited hops; a debug line per hop in dev (`MESH_DEBUG_RELAY=1`).
- Negative cache: `unreachableUntil[nodeId]` (default 30 s) prevents a dial timeout on every call; cleared on a
  successful direct call or when a peer re-learns the node at a new address.

## 4. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MESH_RELAY_MAX_HOPS` | `2` | Hops a forwarded call may take. `0` disables forwarding entirely. |
| `MESH_RELAY_NEXT_HOP_ATTEMPTS` | `2` | Next hops tried per forwarding decision. |
| `MESH_RELAY_UNREACHABLE_MS` | `30000` | How long a failed direct link is remembered. |
| `MESH_DEBUG_RELAY` | unset | Logs each forwarding decision. |

Deployment settings, not node configuration (the same rule as the other `MESH_*` knobs).

## 5. Implementation steps

### Phase 1 — contract and errors (small)

- [x] `packages/contracts/node-agent/mesh/relay/call.ts`: add `meshRelayViaSchema`, `via` on `meshRelayInput`; rebuild.
- [x] `mesh.errors.ts`: `MeshNoRoute` (`dependency_missing`, target + hops), `MeshRelayLoop` (`validation`, node).
- [x] `mesh-client` (`relayLink` / types): pass `via` through; no signature change for callers (it stays internal to the
  agent hop; `relayLink` never sets it).

### Phase 2 — agent routing (main work)

- [x] `node-agents.service.ts`: `know(agent, learnedFrom?)` keeps a source set; `sourcesOf(nodeId)`;
  `markUnreachable(nodeId, ms)` / `isUnreachable(nodeId)`; clear on `know` with a new address and on `forget`.
- [x] `roster-gossip.service.ts` (`absorb`): pass `incoming.from.nodeId` to `know`.
- [x] `relay.service.ts`: extract `direct(target, request)` and `forward(target, request, self)`; wire the pinned branch
  per §3.2/3.3; skip leases when `via` is present; add counters.
- [x] `mesh.module.ts`: provide `RelaySettings` (max hops, attempts, unreachable window) from `ConfigService`;
  `node.status` exposes the counters.
- [x] `node-agent.env.ts`: the four variables; `resolveRelaySettings`.
- [x] Clamp `ttl` to `MESH_RELAY_MAX_HOPS` on receipt; ignore `via` from an agent that is not a known peer? (Not needed:
  the transport already only accepts credentialed peers.)

### Phase 3 — tests

Unit / fixtures (`MeshRelay.live` with fake `NodeAgents`/`AgentLinkFactory`):

- [x] Direct success: no forwarding, `via` unchanged.
- [x] Direct transport failure: forwards to the preferred next hop with `visited += self` and `ttl - 1`.
- [x] Next-hop preference: the agent that taught us the target is tried first; a dead first candidate falls through to
  the second; no candidate → `MeshNoRoute`.
- [x] Loop: `visited` already contains the target (or self) → `MeshRelayLoop`, no call made.
- [x] TTL 0 → `MeshNoRoute`, no call.
- [x] Target error (`ORPCError`) is returned, not forwarded.
- [x] Forwarded request sets `via`, gets brokered (no `grantDirect`) even for a `heavy`/`direct` request.
- [x] Headers survive every hop.
- [x] Negative cache: second call skips the failing direct attempt and forwards immediately; a re-learn at a new address
  clears it.
- [x] Stream through 2 hops: items arrive in order; cancel closes both iterators (fake iterators record `return`).

Boot / integration:

- [x] Three agents A → B → C with A's link to C replaced by a failing transport (injected in `bootAgent` options or a
  fixture), a real B–C websocket: a call pinned to C from A returns C's value, and A's `node.status.relay.forwarded` is 1.
- [x] Existing `mesh-cluster` and `mesh-lifecycle` boot specs unchanged and green (no forwarding on the happy path).

### Phase 4 — docs and rollout

- [x] `docs/architecture/node-agent-service.md`: replace "not built yet: multi-hop" with the design summary and a link
  here; add the counters to the `node.status` description.
- [x] `apps/doc/.../mesh-agent.mdx`: same, in the operator-facing voice.
- [x] `ROADMAP.md` §8 row; tick the item in `roadmap/networking.md` if an ID matches (`NET-*`).
- [x] Default on with `MESH_RELAY_MAX_HOPS=2`; kill switch `0`; document in `.env.example`.
- [x] Optional: a netns/firewall e2e script under `apps/api/services/node-agent/scripts/` (not CI) proving a real
  partition.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Routing loops | `visited` + ttl + target-was-visited check; bounded list length. |
| Amplification (one call → many) | Forward only on transport failure, max 2 next hops, ttl 2 by default, no retry on target errors. |
| Stale/wrong addresses causing constant timeouts | Negative cache 30 s, cleared on re-learn. |
| Forwarded lease the caller cannot use | `via` disables the lease branch; always brokered. |
| Stream leak on cancel | Per-hop `finally { return() }` already in `relayEvents`; test with recording iterators. |
| A forwarded call reaches an agent that also cannot route | ttl bounds it; the last hop returns `MeshNoRoute`, which the first forwarder returns to the caller. |
| Headers/session leakage | Unchanged: the caller's headers are already forwarded one hop; multi-hop does not add a new reader (agents never parse them). |

## 7. Rollout

1. Merge behind the default-on flag with `MESH_RELAY_MAX_HOPS=2`; counters visible in `node.status`.
2. Watch `relay.forwarded` / `relay.noRoute` on a real multi-node deployment; `noRoute` on a healthy full mesh means an
   address problem, not a routing one.
3. If forwarding misbehaves, set `MESH_RELAY_MAX_HOPS=0` (no redeploy of the mesh needed; the next call skips forwarding)
   and the old two-hop behaviour returns immediately.

Effort: **2–3 engineer-days** (Phase 2 is the bulk; Phase 1 and 4 are hours). No schema migrations, no new dependency.

## 8. Open questions

1. Should the intermediate agent be allowed to answer from its **own** replica when it cannot reach the target? Not in
   this plan: a pinned call means "that node", and answering elsewhere would silently change semantics.
2. Should `visited` be signed? No: the transport already authenticates the hop, and a lying sender only harms its own
   route.
3. Do we need per-node reachability gossip (a "who can reach whom" map)? Only if real fleets show partitions where the
   provenance heuristic fails; add then, with measurements.

## 9. What actually landed (deviations from the plan)

- **Boot partition test**: a real asymmetric link cannot be produced through gossip/env (every peer sees the same
  advertised address), so `src/boot/multihop-relay.spec.ts` boots **three real agents** and gives A a fake, dead link to
  C through `bootAgent({ nodeAgents })`; B–C is a real websocket. A pinned call returns C's value and A reports
  `node.status.relay = { forwarded: 1, noRoute: 0, unreachable: 1 }`.
- **Counters**: `RelayMetrics` is a per-agent tag (`relayMetricsOver()`), provided by `mesh.module.ts` and exposed as
  `node.status.relay` (`forwarded`, `noRoute`, `unreachable`).
- **ttl semantics**: no `via` seeds `ttl = MESH_RELAY_MAX_HOPS` (default 2 = one intermediate agent); a forward writes
  `visited += self`, `ttl - 1`; `ttl === 0` returns `MeshNoRoute` before attempting anything. `maxHops = 0` still tries
  the direct link, then refuses to forward.
- **Loop detection**: target or self already in `visited` → `MeshRelayLoop`; a direct success clears the negative mark,
  only non-`ORPCError` failures mark and forward; a peer's `ORPCError` is returned untouched.
- **Provenance**: `absorb` now calls `know(agent, incoming.from.nodeId)` unconditionally (the old same-address guard
  would skip recording the teacher), and re-learning at a new address clears both the cached link and the mark.
- **`MESH_DEBUG_RELAY`** is read through `relayDebug()` at the decision point rather than a tag, so `RelaySettings` stays
  `{ maxHops, nextHopAttempts, unreachableMs }`.
- **Client type**: `NodeDoorStatus.relay` is optional, so setup/fleet fixtures did not need to change.
- No receipt-time clamp of `via.ttl` beyond the contract's `0..8`.
