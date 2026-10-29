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
| Addressed by | a node id (or "all nodes") | a service name, optionally a resource key |
| Path | caller -> its local mesh-agent -> (bridges) -> the target node's agent -> the service on that node | caller -> its local mesh-agent (which resolves the replica through the service directory) -> the target replica, brokered by the agent's pooled links; a **direct lease** replaces the brokered hop only for load, streams and direct resource access |
| Answered by | the services on that node | any replica, or the one replica that holds the resource |
| Typical use | per-node docker ops (containers, logs, files, terminals), node usage, inventory, ingress doors | streaming and requests not tied to a node (deployment streams, resource discovery), and work that needs the replica holding some in-memory state |

Both are **oRPC**, and every client is built with `createEffectClient` (from `@orpc/effect`) over the link, so a call
is an Effect and can use Effect features (retry, timeout, tracing, interruption, typed errors). A service declares an
ordinary contract and implements it; a caller builds the client over a mesh link:

```ts
const nodes = createEffectClient(createORPCClient(nodeMeshLink({ node: "node-b" })));
const runtime = createEffectClient(createORPCClient(serviceMeshLink({ service: "runtime" })));
const owner = createEffectClient(createORPCClient(serviceMeshLink({ service: "runtime", key: deploymentId })));
```

Callers never see topics, correlation ids, replicas or connections.

### The agent brokers every request

Every request starts at the local mesh-agent, at least for discovery. A service process holds **one persistent RPC
link to its local agent** and nothing else; the agent owns the links used for inter-service access (pooled, see
below). A service never opens a connection to another service on its own initiative. By default the agent brokers the
call end to end: it resolves the target in the service directory, uses its pooled link to the target replica (or to
the target node's agent, which uses its own pooled link to the replica), and relays the answer.

The one exception is the **direct lease**. When brokering would put too much on the agent (large payloads, long
streams, a hot resource), or the caller asks for it (`{ mode: "direct" }`, typical for a resource it will keep
using), the agent does not relay. It answers with a dedicated error code, `MESH_DIRECT`, carrying
`{ replica, address, token, ttl }`: a short-lived, agent-signed grant for a direct link to that exact replica. Like
`MESH_REDIRECT`, it is caught by the caller's oRPC interceptor, which opens (or reuses) a pooled RPC link to the
replica and replays the call there. The replica checks the token, the lease expires or is revoked when the replica
dies, and a refused or expired lease falls back to the brokered path. A lease is still an oRPC RPC link, never
OpenAPI, and still built with `createEffectClient`.

**Pools live inside the RPC link.** The link implementation owns a bounded pool of websocket connections per target
(the local agent, or a leased replica): multiplexed calls and streams over a few connections, a size cap, idle
close, reconnect with backoff, and health eviction. Callers and handlers never see the pool; there is no connection
per service pair.

### Global mesh: directory, redirects and replica peers

The global mesh is a small framework (an Effect library, `@deployer/service-mesh`) with three parts.

1. **Service directory.** Each replica registers itself (service, replica id, address on the overlay network, load)
   and the resource keys it currently holds in memory (a deployment, a terminal session, a stream). The directory is
   replicated through the mesh-agents' roster gossip, so every node can answer
   `resolve(service, { key? })` locally (the agent answers every discovery, whether it then brokers or leases): the replica holding `key`, else a replica chosen by affinity hash, else the
   least loaded. Registrations carry a TTL and a generation, so a dead replica's keys age out.
2. **Redirects, done by a client interceptor.** A caller may address only the service. When the replica that
   receives a call does not hold the resource, it fails with a dedicated oRPC error code, `MESH_REDIRECT`, whose data
   is `{ replica, reason }` (a handler throws it through a helper such as `redirectTo(replica)`). Following it is not
   a link feature: it is an oRPC client interceptor (`meshRedirectInterceptor`) installed on every caller's link. The
   interceptor catches `MESH_REDIRECT` and retries the same call, naming the replica, through the local agent (which
   brokers it or answers with a direct lease) or through the forwarding path below, up to a hop limit with a loop guard, and remembers `key -> replica` for a short TTL so the next call goes
   straight there. Handlers and callers stay plain oRPC; the error code is declared once in a shared error map that
   every contract spreads in, so it is typed and testable.
3. **Replica peers.** A service can ask its own other replicas: `peers.ask(procedure, input, { first | all })` to find
   which one holds a resource (the replicas reach each other through their local agent too; then redirect the caller to it), or `peers.forward(replica, procedure, input)` to
   fetch it on the caller's behalf when a redirect is not wanted (for example the caller cannot reach that replica).
   Redirect or forward is the handler's choice.

Brokered calls and leased direct links are normal oRPC over RPC links; the directory only decides *where*, and the
agent decides *how* (broker or lease). Links are created on first use and closed when idle.

## Contract routers and visibility

A service that takes part in the mesh keeps three kinds of contract in three separate routers, never mixed:

| Router | Called by | Contains |
|---|---|---|
| `external` | other services and the BFF (through the global mesh) | the service's ordinary mesh-facing procedures |
| `peer` | the service's own other replicas | resource lookup, state handover, forwarded requests (`peers.ask` / `peers.forward`) |
| `node` | the local mesh-agent, over the node mesh | per-node operations (containers, logs, files, usage, inventory) |

Mesh contracts are **not public**: they are not part of the public API contract and are never exposed to the web
client or the generated docs. They live in a dedicated `mesh/` folder of the owning contract package, for example
`packages/contracts/runtime/mesh/{external,peer,node}/`, assembled into `meshContract = { external, peer, node }` and
exported only from a `./mesh` entry that server-side code imports. The public contract index never re-exports it.
Each router is served on its own link, so a replica can refuse `peer` calls from anything but its own service, and
`node` calls from anything but the local agent. The `MESH_REDIRECT` error map is shared by `external` and `peer`.

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

## oRPC clients

**Server-side clients use the RPC link, never the OpenAPI link.** Every service-to-service and service-to-agent client
is built on the oRPC RPC protocol over a persistent websocket (`@orpc/client/websocket`), not the OpenAPI/fetch link.
The websocket is opened once and reused, so calls, streams and redirects share one long-lived connection instead of
paying a connection setup per request, and server-to-client streams (event iterators) work natively. The OpenAPI
link stays for the public surface only (browsers, third parties). Connections are per peer, not per service pair, are
opened on first use and reconnect with backoff; the redirect interceptor and `createEffectClient` sit on top of that
link unchanged.


Every server-side oRPC client (the service-client registry, the shared `service-client`, the mesh links, the
initialization service) is built with `createEffectClient`, so callers get Effects instead of Promises. Today these
call `createORPCClient` directly: `packages/service-client` (registry), `apps/api/shared/src/server/service-client.ts`,
the shared e2e harness client and `mesh-initialization.service.ts`. The browser clients (`apps/web`, `apps/setup`,
the BFF views) are covered by the open question below.

## Migration order

1. **Scaffold** `apps/api/services/mesh-agent` from the health service anatomy; port roster, gossip and the WireGuard
   driver to Effect behind ports, with their tests.
2. **Node mesh link** (built with `createEffectClient`) and the agent's local socket server; per-node routing for the
   small-mesh topology. Move the existing server-side clients onto `createEffectClient`.
3. Move runtime's per-node docker operations behind node-mesh contracts; delete the docker mesh services.
4. Move fleet's mesh use (cluster, reachability) behind node-mesh contracts.
5. **Global mesh**: the `@deployer/service-mesh` framework (directory, redirects, replica peers), then the bridge
   topology for large node meshes.
6. **Onboarding agent**, then remove `apps/mesh-agent`, `@deployer/mesh-network` and the shared mesh modules.

## Things to verify before building

- A Swarm service can run with host networking and `NET_ADMIN` on the engines the platform targets (WireGuard needs
  both); otherwise the agent needs another placement.
- Where a global-mode task keeps its identity across restarts (a bind mount on the node), and what happens on a node
  that is drained and rejoins.
- The roster size at which cells become worthwhile (the default threshold above is a guess).
- Whether the browser clients (`apps/web`, `apps/setup`, BFF views) should also use `createEffectClient`, or only the
  server-side ones and the mesh links.
- The hop limit and `key -> replica` hint TTL for redirects (proposed: 3 hops, 5 s).
