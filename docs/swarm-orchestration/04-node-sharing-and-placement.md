# Swarm Orchestration — 04 · Node Sharing & Placement

> **Status:** Design finalized, implementation pending
> **Scope:** swarm node labels, placement preferences/constraints, `cluster.nodes` inventory
> **Requirement:** "…be able to share node with worker so we don't have nodes that only run the worker."

---

## 1. Requirement

> Every node should run **both** control-plane and worker workloads. A fleet must never contain nodes that merely execute tasks — managers host user services too, and workers host platform services too.

Why: dedicated worker-only nodes waste capacity, complicate the manager/worker story, and contradict the self-hosted mesh model where each node runs the full API. Swarm already supports this natively — **managers schedule tasks by default**. The design goal is to keep that default and only add constraints where a hard reason exists.

## 2. Node roles (platform-level)

| Role label value | Meaning | Scheduling effect |
|---|---|---|
| `both` (**default**) | Runs control-plane + user workloads | No constraint |
| `control` | Prefers control-plane services, still accepts user workloads unless capacity-full | Slight preference only |
| `worker` | Operator-declared: user workloads first, control-plane tolerated | Preference only (never a hard ban) |
| `ingress` (boolean) | Host can bind Swarm ingress ports (public IP / traefik) | `deployer.ingress=true` constraint on Traefik service (see §4) |

**Hard rules:**

- Role is a **label preference**, never a hard partition — the `worker` role label does not forbid control-plane scheduling.
- The only permitted hard constraints are:
  1. `deployer.ingress=true` (only nodes with the ingress port)
  2. `deployer.tenant.<id> = true` when a project explicitly demands dedicated placement (opt-in per project)
  3. `node.platform.os==linux` style infra constraints (never role-based)

## 3. Control-plane services on all nodes

| Platform service | Placement | Replicas |
|---|---|---|
| `api` | spread across all nodes (`max_replicas_per_node: 1` + `placement.preferences: spread`) | `max(2, nodeCount)` — **all nodes run one API replica** (this is also what the mesh needs) |
| `web` | spread, `max_replicas_per_node: 1` | `nodeCount` |
| `traefik` | `deployer.ingress=true` (any node can be tagged) | `min(nodeCount, 3)` — on managers too |
| mesh/stream helpers | colocated with `api` | n/a (per-api) |

Placement style — **preferences, not constraints**. The YAML below is the *declarative* shape (input to the typed `StackSpec`); at runtime it is compiled by `NodePlacementService` into a dockerode `SwarmServiceSpec` (`Placement.Preferences` / `Placement.Constraints`) and applied via `DockerService.createService|updateService` — never through the CLI:

```yaml
# api service — runs on EVERY node (managers + workers)
services:
  api:
    deploy:
      replicas: 6
      placement:
        preferences:
          - spread: node.labels.deployer.node.role   # 'both' spreads evenly
        constraints:
          - node.role == worker                      # managers included
      max_replicas_per_node: 1
```

```ts
// What the runner actually sends (dockerode SDK)
const spec: SwarmServiceSpec = {
  TaskTemplate: {
    Placement: {
      Preferences: [{ Spread: { SpreadDescriptor: "node.labels.deployer.node.role" } }],
      Constraints: ["node.role == worker"], // managers included → no dedicated workers
    },
  },
  // …
};
await this.dockerService.createService(spec);
```

The `Constraints: ["node.role == worker"]` line is the key: in Swarm, **managers are also workers**, so this constraint admits every node. A "manager-only" constraint (`node.role == manager`) is **never** used for platform services — it would create exactly the wastefulness this requirement forbids.

## 4. Ingress placement

- Traefik needs the host ports (`80/443` and the Swarm ingress mesh port) — only nodes with public/ingress capability get `deployer.ingress=true`.
- Those nodes are usually the **managers** in a small fleet (they already have public IPs for the platform), so Traefik runs on manager nodes naturally — *without* a manager-only rule.
- `deployer.ingress=true` is a per-node operator decision, applied through the SDK (`NodeService.update({ Spec: { Labels } })`) — or by an operator in the UI, which calls the same endpoint:

```ts
await this.dockerService.getNode(nodeId).update({
  Version: node.Version.Index,
  Spec: { Labels: { "deployer.ingress": "true", ...node.Spec.Labels } },
});
```

## 5. User deployments on shared nodes

- Default: **no constraints** — user services schedule anywhere (including the master node / managers). This is the shared-node requirement fulfilled.
- Project-level opt-ins (stored in the project placement policy, applied by the swarm runner):
  - `dedicated`: `constraints: [node.labels.deployer.tenant.<projectId> == true]`
  - `exclude-ingress`: `constraints: [node.labels.deployer.ingress != true]` (e.g. PCI-grade isolation)
  - `prefer-region`: `placement.preferences: [spread: node.labels.deployer.region]`
  - capacity guard: `resources.reservations` + `limits` per service (already in `RuntimeExecutionInput` via `cpuShares`/`memoryLimitBytes` → map to Swarm `resources`)
- Spreading defaults: `max_replicas_per_node: 1` for stateless replicas ≥ 2 (matches `production-deployment.mdx` replica policy).

## 6. Edge nodes (NAT, no overlay) — the exception that proves the rule

Nodes unreachable on Swarm control-plane ports (2377/tcp, 7946/tcp+udp, 4789/udp) **cannot join the cluster** without a WireGuard overlay. For those:

- They keep the **mesh-only / supervisor** path (existing `MANAGED_*_ENABLED` model, direct-container runner).
- They are marked `cluster.membership = none` in `cluster.nodes`.
- They are **not candidates** for master (already excluded by eligibility §3 in `02`).
- The moment a WireGuard overlay exists (`wireguard-state-mesh-*` volumes already in `docker-compose.dev.yml`), the node becomes joinable and moves to `both`.

This is the clean seam: **swarm = reachable nodes; mesh = everything**. No dedicated workers anywhere in either path.

## 7. Capacity & co-location policy

- Managers co-host user workloads — so the Raft quorum nodes should reserve a **small manager budget** (`resources.reservations` on api/traefik equals the manager overhead; user services can then use the remaining unreserved capacity).
- UI must show per-node split: `control-plane` vs `user` usage bars (from `docker node inspect` resources + service placement), so "no dedicated workers" is visible and verifiable.
- `ClusterService.reconcile()` enforces label drift: a node whose labels changed (operator renamed role) gets its services re-spread naturally — preferences are dynamic in Swarm.

## 8. Summary of rules (enforceable)

| # | Rule |
|---|---|
| 1 | Default role is `both` for every joined node |
| 2 | No platform service may use `node.role == manager` constraint |
| 3 | Worker-labelled nodes still accept control-plane replicas (preference only) |
| 4 | Only `deployer.ingress`, `deployer.tenant.<id>`, and infra constraints may be hard |
| 5 | `max_replicas_per_node: 1` + spread for all multi-replica platform services |
| 6 | Edge nodes (no cluster) are mesh-only and never candidates |
| 7 | Project placement opt-ins are stored in DB policy, applied by the swarm runner |

## 9. Files affected

- `apps/api/src/core/modules/swarm/services/node-placement.service.ts` (label → constraint builder)
- `apps/api/src/core/modules/swarm/services/node-inventory.service.ts` (docker node ls ↔ `cluster.nodes`)
- `packages/contracts/entities` — placement policy schema for projects
- UI node detail page — role label editor + usage bars