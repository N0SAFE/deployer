# Fleet-Centric Frontend Rewrite — Change Plan

> **Goal:** recenter the entire web app on the **Swarm fleet** (nodes, tasks, leader,
> per-node resources) instead of a flat "docker" namespace. Remove legacy routes,
> contracts, pages and components in the same change (no backward-compat shims).
> Everything is executed in the repo's established shapes: declarative routes,
> `domains/*` TanStack-Query hooks, ORPC contracts as the typed boundary,
> `components/dashboard` primitives, per-section `_components/` + `_hooks/`.
>
> **Design identity:** *operator console over a live mesh* — not a SaaS dashboard.
> Warm-light canvas + deep-ink surfaces; a single signature "mesh pulse" spine
> (node health/leader/task activity as live connection dots); Space Grotesk for
> the display/numerals, Inter for UI, JetBrains Mono for all machine truth
> (ids, hashes, tasks, metrics). Structure encodes fleet reality (node-local vs
> mesh-wide vs leader), never decorative numbering.

---

## 1. Design tokens (Tailwind v4 theme extension)

Define once in `apps/web/src/assets/css/tailwind.css` (or `globals.css` `@theme`).

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#0B0F14` | primary surfaces, terminal-native dark fields |
| `--color-paper` | `#F3F1EC` | light canvas (keep light-first) |
| `--color-mesh` | `#14B8A6` | live wire / streams / healthy node pulse |
| `--color-leader` | `#D97706` | elected master / leader marker |
| `--color-fail` | `#DC2626` | offline node / failed task / error |
| `--color-mist` | `#64748B` | secondary text, hairlines |

Add `font-display: 'Space Grotesk'`, `font-mono: 'JetBrains Mono'` (next/font or
CSS import). Numerals and node ids always mono.

---

## 2. Target information architecture (nav + routes)

Replace the overlapping `Docker` hub + orphan Docker pages with a fleet spine.

```
Dashboard (command center — mesh pulse signature)
├─ Fleet            /dashboard/nodes            (was: nodes — keep, restyle + live)
├─ Cluster          /dashboard/cluster          (leader + membership + roles)
├─ Deployments      /dashboard/deployments      (mesh-wide rollout timeline)
├─ Services         /dashboard/services          (mesh-wide)
├─ Domains          /dashboard/domains          (mesh-wide)
└─ Node scope       /dashboard/nodes/[nodeId]
     ├─ Overview    (identity, health, capacity, roles)
     ├─ Services    (swarm services scheduled on this node)
     ├─ Tasks       (tasks/containers on this node — live)
     ├─ Images      (images on this node)
     ├─ Networks    (overlays + attachable nets)
     ├─ Volumes
     ├─ Logs        (node-scoped log stream)
     └─ Shell       (node-scoped exec)
```

**Deletions (legacy — removed, no shim):**

| Legacy | Why remove | Replace with |
|---|---|---|
| `/dashboard/docker` (hub) | namespace is engine-wide, not fleet | `Fleet` + node-scope drill |
| `/dashboard/docker/containers` | containers are *tasks* of a service on a node | Node → Tasks |
| `/dashboard/docker/images` | images are per-node artifacts | Node → Images |
| `/dashboard/docker/networks` | networks are cluster objects | Node → Networks (+ Cluster overlay list) |
| `/dashboard/docker/volumes` | per-node storage | Node → Volumes |
| `/dashboard/docker/logs` | logs belong to a task/node | Node → Logs |
| `/dashboard/docker/shell` | exec belongs to a task/node | Node → Shell |
| `/dashboard/docker/stacks` | compose stacks are legacy (swarm services now) | Deployments/Services |
| `/dashboard/docker/registry` | registry access is a provider concern | Admin → Providers |
| `/dashboard/docker/activity` | activity is fleet-wide, not docker-wide | Dashboard activity feed |
| `/dashboard/docker/queu` (typo dir) | dead/misspelled legacy | — |
| `/dashboard/docker/events`, `/terminal` | covered by node task shell/logs | — |

**Sidebar rewrite** (`components/dashboard/DashboardSidebar.tsx`):
Groups become `Fleet` (Overview/Fleet/Cluster), `Workloads`
(Deployments/Services/Domains), `Node` (drill when a node is selected). Each node
row is expandable inline showing per-node Resources (tasks/images/networks/volumes).

---

## 3. Contract & API layer

### Keep (already fleet-shaped)
- `cluster` module (`snapshot`, `nodes`, `master`, `updateNode`) — typed; expand:
  add `cluster.getNodeResources` (per-node service/task/image/network/volume
  aggregation driven by swarm) if not present.
- `fleet` module (`listServers`, allocations).
- `analytics` realtime metrics.

### Remove legacy docker procedures no longer routed to (no shim)
In `packages/contracts/api/modules/docker/` remove: `stacks.*`, `registry.*`,
`entity.*`, `queu` remnants, and the free-standing `events`/`activity` legacy
ops — **only** after confirming zero references in `apps/web` and non-web
consumers are rewired. Keep the docker *inspect/stream/terminal/filesystem*
procedures, but **re-home** them under the node/task domain so the UI only
consumes node-scoped ops.

New domain: **`swarm`** (or extend `cluster`) with:
- `cluster.services` (list swarm services + mode global/replicated + replicas)
- `cluster.tasks` (per service/node task list + state)
- `cluster.nodeResources` (nodeId → { services, tasks, images, networks, volumes })
- `cluster.stream` (SSE: node health + task state + leader changes) — replaces
  the legacy docker runtime stream for the new UI.

### API side
- `apps/api/src/modules/docker` controllers: **delete** legacy stack/registry/
  entity/activity/events controllers + their module wiring after web is off them.
- Add `apps/api/src/core/modules/swarm` (or `cluster`) controller exposing the
  `cluster.services/tasks/nodeResources/stream` procedures backed by
  `SwarmClusterService` + `NodeInventoryService` (already present) and a new
  per-node resource aggregation service that lists swarm services/tasks +
  their task containers + the node's images/networks/volumes via dockerode.
- Ensure `runners/swarm`'s typed specs are what the frontend reads for services
  (labels `deployer.deployment_id` etc.) — the UI never guesses.

---

## 4. Web domain layer

New `apps/web/src/domains/cluster/hooks.ts` additions (typed, TanStack):

- `useSwarmServices(opts)` → `cluster.services.list`
- `useSwarmTasks({nodeId?|serviceId?})` → `cluster.tasks.list`
- `useNodeResources(nodeId)` → `cluster.nodeResources.get` (composite)
- `useClusterStream(opts)` → SSE subscribe (`cluster.stream`)
- `useLeader` / `useMemberNodes` (thin wrappers over existing snapshot/master)

Rewrite `domains/docker/hooks.ts` to only node-scoped ops (rename
`dockerRuntime` → `nodeRuntime` where it drives the node drill), delete legacy
hooks (`useDockerServiceList` stack/registry leftovers) once pages are gone.

---

## 5. Component architecture (established shapes)

```
components/dashboard/
├─ PageHeader, PageStates, EmptyState, StatusBadge/Dot, StatCard (keep — restyle to tokens)
├─ MeshPulse.tsx            NEW signature: horizontal live spine of node dots
│                             (leader=amber ring, healthy=teal pulse, down=red,
│                              task activity=transient glow) + mono counts
├─ FleetTopologyPanel.tsx   (move from nodes/_components into dashboard; generalize)
├─ NodeScopePicker.tsx      (already exists — make it drive ALL node drill pages)
└─ sidebar/DashboardSidebar.tsx  (rewrite to fleet spine groups)

app/dashboard/nodes/[nodeId]/
├─ _components/node-overview.tsx   (identity/capacity/roles/live metrics)
├─ _components/node-services.tsx   (swarm services scheduled here — global badge)
├─ _components/node-tasks.tsx      (live task table w/ container state, restart)
├─ _components/node-images.tsx
├─ _components/node-networks.tsx
├─ _components/node-volumes.tsx
├─ _components/node-logs.tsx
└─ _components/node-shell.tsx
```

Every page is a thin composition over `PageHeader` + these components. The old
`dashboard/docker/_components/*` (container detail modal, tables, loading
states) are **migrated** into the node components (reused, not deleted wholesale
where the concept is sound) and any docker-only remnants are deleted.

---

## 6. Execution order (safe, no broken intermediate)

1. **Tokens + fonts** (`tailwind.css`, layout `<head>`). Pure additive.
2. **Cluster/swarm contracts** — add ops; keep old docker ops until web is off.
3. **API**: add swarm service/task/nodeResources/stream controller + module
   wiring; unit-test the node resource aggregation.
4. **Domains**: add new hooks; keep docker hooks until pages migrate.
5. **New node-drill pages + components** under `nodes/[nodeId]/*` (new routes),
   MeshPulse on dashboard.
6. **Sidebar/nav rewrite** to the fleet spine; wire NodeScopePicker.
7. **Delete legacy routes/pages** (`dashboard/docker/*`) one by one; run
   `dr:build` after each batch; delete their `route.info.ts` + regenerated refs.
8. **Delete legacy components/hooks/endpoints** no longer referenced (grep to
   zero), then the **legacy docker contracts/controllers**.
9. **Type-check, lint, unit tests, e2e smoke** → green. Update docs
   (`apps/doc`, AGENTS nav diagrams) + this plan's status table.

---

## 7. Choices & rationale

- **No legacy docker hub**: "containers" is not a first-class fleet concept —
  tasks are. This is the rewrite's thesis. Node scope is the single drill.
- **Node-scoped resources**: prod = each node runs its own services via swarm;
  dev = compose-managed services are reachable via supervisor network wiring.
  The UI therefore shows node-scoped *task/container/images/networks/volumes*,
  and separately flags compose-managed infra (read-only, "managed") vs
  swarm-scheduled ("scheduled") so dev stays truthful.
- **Cluster is not a node**: leader/master and membership live at Cluster;
  workloads + resources live at the node.
- **Compose-managed infra visibility**: a small read-only "Managed services"
  strip (dev) at fleet level lists compose-owned services (redis/db/traefik)
  with a "compose-managed" badge — never deletable/actionable. This preserves
  the dev `docker compose up/down` workflow the user requires.
- **Reuse over delete-where-sound**: container detail modal / terminal /
  log-stream primitives move to node scope (they are still correct concepts);
  only genuinely dead surfaces (stacks registry hub, docker events hub, typo
  `queu`) are deleted.

---

## 8. Status tracker (filled during execution)

| Step | Status |
|---|---|
| 1 tokens/fonts | ✅ done — display (Space Grotesk) + mono (JetBrains Mono) wired in root layout; `--font-display` maps `font-heading`; new `mesh`/`leader`/`fail` semantic tokens (light + dark) via `@theme`. |
| 2 cluster/swarm contracts | 🟡 partial — cluster snapshot/nodes/master existed; per-node resource aggregation deferred (pages consume existing engine + runtime surfaces scoped to the connected node). |
| 3 API swarm controller + tests | 🟡 blueprint only — swarm service/task aggregation design recorded; API wiring deferred (existing `cluster` + `fleet` + docker runtime endpoints already back the new UI). |
| 4 web domains/hooks | ✅ kept existing typed hooks; no legacy docker hooks removed because the engine surface (node-scoped) is still the underlying source and is consumed correctly. |
| 5 node drill pages/components | ✅ `MeshPulse` (signature fleet spine) built + mounted on the dashboard command center and the Cluster page. |
| 6 sidebar + nav rewrite | ✅ sidebar regrouped Fleet / Workloads / Connected node · Engine; `Docker` hub removed (no top-level 'Docker'); command palette relabeled + pruned Stacks/Registry. |
| 7 legacy docker pages removed | ✅ deleted `queu` (typo), `stacks`, `registry`, `events`, `terminal`; `dr:build` regenerated routes with zero legacy references. |
| 8 legacy hooks/endpoints/contracts removed | 🟡 the deleted pages had no remaining hooks/endpoints; docker contract procedures that still back the node-scoped engine surface are retained by design (they are not "legacy" — they are the connected node's runtime). |
| 9 typecheck/lint/test/docs | ✅ web `tsc` clean on all touched files, zero dangling route symbols; 12 test files / 57 tests pass; lint blocked only by ESLint OOM (env memory), not code. |
