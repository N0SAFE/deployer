# The mesh-agent service

Status: **design for review** (2026-10-29). Nothing below is built yet; the decisions it rests on are in
`docs/qa/mesh-agent/`.

## Why

The mesh is hosted by services that should not host it: the BFF mounts the mesh agent module, runtime hosts the
docker mesh services and the handler registrar, fleet hosts a mesh namespace, and `apps/api/shared` carries about
15,000 lines of topic, topology and discovery code every service imports. The operator's rule: the mesh lives in one
dedicated service, `mesh-agent`, running on every node; everyone else is a client.

## Two primitives

| | **Node mesh** | **Global mesh** |
|---|---|---|
| Addressed by | a node id (or "all nodes") | a service name (any replica) |
| Answered by | the services on that node, through the node's mesh-agent | any replica of the named service |
| Typical use | per-node docker ops (containers, logs, files, terminals), node usage, inventory, ingress doors | streaming and requests not tied to a node (deployment streams, resource discovery) |
| Replaces | `callMany` / `registerCallHandler` namespaces | direct service-to-service wiring |

Both are **oRPC**. A service declares an ordinary oRPC contract and implements it; a caller builds an ordinary oRPC
client whose link is a mesh link:

```ts
const client = createORPCClient(meshLink({ node: "node-b" }));      // node mesh
const client = createORPCClient(meshLink({ service: "runtime" }));  // global mesh
```

The link sends to the caller's **local** mesh-agent (unix socket / loopback), which routes. No service holds mesh
connections, topics or correlation ids.

## Transport and topology

- **Constant connections are oRPC RPC links** (`@orpc/client/websocket` on the dialling side, `@orpc/server/websocket`
  on the answering side), multiplexed, over the WireGuard network. One long-lived link per *agent pair that needs it*,
  never one per service pair.
- **Small mesh** (up to a configurable size, default 8 agents): every agent links to every other. A request goes
  directly to its target agent.
- **Large mesh**: agents are grouped into cells. Each cell has a small, deterministic set of **bridge** agents
  (chosen by rendezvous hashing over the signed roster, so every agent computes the same answer with no election and
  no control plane). Bridges link to every other cell's bridges; ordinary agents link only to their cell's bridges.
  A request to a node in another cell goes `local agent -> own bridge -> target cell's bridge -> target agent`.
  A bridge that disappears is replaced by the next in the hash order.
- **Routing is a pure function**: `route(roster, from, to) -> path`. The roster (signed membership, already gossiped)
  is the only shared state, so routing is testable without a network.
- **Global mesh addressing**: each agent advertises the services it hosts (name, replica id, load) in its roster
  entry; a call to a service name picks a replica by rendezvous hashing on an optional affinity key, else least
  loaded, then routes like any other request.
- Links open lazily and close when idle, except bridge links, which stay up with heartbeats.

## Agents

- **mesh-agent** (global-mode Swarm service, one task per node): owns the node's WireGuard identity and link, the
  roster and its gossip, the node's doors, and the routing above. Built as an Effect service on the shared API code.
- **onboarding agent** (not persisted): a short-lived container for a node that is not in a swarm yet. It performs
  the join and admission handshake and brings the WireGuard link up, hands the identity to the node's persistent
  volume, then exits; the Swarm-managed mesh-agent takes over.

## What is removed

- `apps/mesh-agent` (the bun-compiled agent) and `infra/docker/builder/mesh-agent`'s binary build.
- `packages/infrastructure/mesh-network`: its protocol, WireGuard driver, roster and gossip move into the service.
- `apps/api/shared/src/core/modules/mesh-agent` and `MeshAgentModule` in the BFF.
- `apps/api/shared/src/core/modules/mesh` (topics, topology, resource discovery) once its users are on the links.
- The docker mesh services and handler registrar in runtime, and fleet's mesh namespace.

## Migration order

1. **Scaffold** `apps/api/services/mesh-agent` from the health service anatomy; port roster, gossip and the WireGuard
   driver to Effect behind ports, with their tests.
2. **Node mesh link** and the agent's local socket server; per-node routing for the small-mesh topology.
3. Move runtime's per-node docker operations behind node-mesh contracts; delete the docker mesh services.
4. Move fleet's mesh use (cluster, reachability) behind node-mesh contracts.
5. **Global mesh**: service advertisement, replica choice, and the bridge topology for large meshes.
6. **Onboarding agent**, then remove `apps/mesh-agent`, `@deployer/mesh-network` and the shared mesh modules.

## Things to verify before building

- A Swarm service can run with host networking and `NET_ADMIN` on the engines the platform targets (WireGuard needs
  both); otherwise the agent needs another placement.
- Where a global-mode task keeps its identity across restarts (a bind mount on the node), and what happens on a node
  that is drained and rejoins.
- The roster size at which cells become worthwhile (the default threshold above is a guess).
