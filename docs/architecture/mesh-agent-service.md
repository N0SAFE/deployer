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
`MESH_REDIRECT`, it is caught by the caller's oRPC interceptor (the only interceptor a caller needs), which opens (or reuses) a pooled RPC link to the
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
   `resolve(service, { key? })` locally (the agent answers every discovery, whether it then brokers or leases). The
   order is: the replica holding `key`; else **a replica on the agent's own node** (locality: a service replicated on
   this node is served from this node and never crosses to another one); else a replica chosen by affinity hash;
   else the least loaded.
2. **Redirects, answered by the mesh-agent.** A caller may address only the service. When the replica that receives
   a call does not hold the resource, it fails with a dedicated oRPC error code, `MESH_REDIRECT`, whose data is
   `{ replica, reason }` (a handler throws it through a helper such as `redirectTo(replica)`). The call reached the
   replica through an agent, so the **agent** is the one that receives this error: it resolves the named replica,
   replays the call there over its pooled links (through the target node's agent when it is on another node), up to a
   hop limit with a loop guard, and returns the final result to the caller. The caller never sees the redirect, and
   the agent remembers `key -> replica` for a short TTL so the next call goes straight there. The error code is
   declared once in a shared error map that every contract spreads in, so it is typed and testable. A replica reached
   over a direct lease may also answer `MESH_REDIRECT`; the caller's link does not chase replicas itself, it hands the
   error to its local agent, which resolves again. The only code the caller's interceptor acts on is `MESH_DIRECT`.
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

## Load and failure

The agent is a per-node relay, not one gate: each agent carries only its own node's services, and locality keeps most
calls on one node. It still must not become the data path for everything.

- **Relay frames, do not re-parse them.** The agent routes on the procedure and headers only and forwards the payload
  untouched, with backpressure and per-caller fair queuing, so a slow stream cannot stall the others.
- **Proactive leases.** Contract procedures marked `heavy` (streams, uploads, big reads) get a direct lease by default.
- **Reactive leases.** The agent also grants a lease when a caller/target pair crosses a call-rate threshold, or when
  its own event-loop lag, bytes per second or open streams pass a limit. The agent then stays the control plane
  (discovery, locality, redirects, admission) and carries only low-volume traffic.
- **Agent restarts.** Callers keep their last directory snapshot and their active leases, retry idempotent calls on
  reconnect and fall back to the brokered path, so a restart drops in-flight calls on that node and nothing else.
- **Measure first.** The thresholds are defaults to be set by an early load test of the relay, not by estimates.

## Service anatomy

`apps/api/services/mesh-agent` is a standard API service, the same shape as `health`: `main.ts` boots through
`bootstrapApiServer` on the port the shared catalog gives it (`apiServicePort("mesh-agent")`, 3106), `app.module.ts` is
imports only, and the `mesh` domain module owns the controller and the providers. Every service is a constant
registered under its Effect tag (`{ provide: MeshDirectory, useValue: MeshDirectory.live }`), dependencies are yielded
from the Effect context, and the controller only maps results to the contract.

```
modules/mesh/
  controllers/   mesh-directory.controller.ts      thin, .effect() handlers
  services/      directory, broker, key-hints, node-identity, mesh-clock
  repositories/  directory.repository.ts           the in-memory directory
  rules/         resolve-replica, lease-policy, lease-token   pure functions
  (the pooled RPC link and its connection pool live in packages/mesh/client: @deployer/mesh-client)
  testing/       mesh.fixtures.ts
```

Two deliberate differences from the other services, both because an agent runs on every node, before the swarm and
its database exist:

- **No database and no Better Auth.** The service imports neither `DatabaseModule` nor `AuthModule`, and declares no
  preflight dependency.
- **Mesh credential instead of a session.** `createMeshOrpcModule()` is `createOrpcModule()` with the same transport
  policy (interceptors, compression, coercion, the Effect context), but a request is authenticated by the
  `x-mesh-credential` header, verified against `MESH_AGENT_SECRET` in constant time, before any handler runs.
  `context.auth` is permanently anonymous, and the caller acts as the `mesh-peer` system actor.

Its boot spec runs beside the unit specs instead of in `src/e2e`: the e2e project provisions a Postgres container.

## The relay, as built

Every call between services is one oRPC procedure on the local agent, `relay.call` (contract in
`@deployer/mesh-agent-contracts`, `mesh/relay/`). The caller names a target, `{ service, key?, node?, direct?, heavy? }`,
plus the procedure `path` and `input`; `relayLink` in `@deployer/mesh-client` turns every procedure of a client into
such a call, and `grantFollowingLink` replays it on a replica when the agent answers `MESH_DIRECT`.

The answer is an oRPC event iterator: one `value` event for a unary result, or a `stream` event then one `item` per
element. It is a plain iterator and not the builder's `observable`, deliberately: an iterator is pulled, so a slow
caller slows the stream at its source instead of an unbounded buffer growing on the agent, and the builder's
observable output is wrapped in a detailed `{ status, body }` structure that the RPC protocol cannot validate.

`MeshRelay` (in the service) decides, in order: forward to another node's agent when the call is pinned to a node that
is not this one; grant a direct link when `leaseReason` says so; otherwise broker through `MeshBroker`, which resolves
the replica (key, locality, load), calls it over the pooled link, answers `MESH_REDIRECT` itself and returns the final
result. The target's own errors reach the caller with their code and data.

Built and tested over real oRPC RPC peers (in-memory ports): unary, streams, redirects, errors, node pinning and grants.

## The transport and the roster, as built

- **Websocket.** `@deployer/mesh-server` serves an oRPC router over a persistent websocket on the service's own HTTP
  port, at `MESH_WEBSOCKET_PATH` (`/mesh/ws`). The mesh credential travels in the `credential` query parameter and is
  checked at the upgrade, so an unauthenticated peer never holds a socket. Silent peers are pinged and dropped, and the
  oRPC context is read per call, not per connection. The agent serves its directory, relay and roster procedures on it
  with the same controllers that serve HTTP, so the two surfaces cannot drift.
- **Client links.** `@deployer/mesh-client` opens those websockets (`openWebSocketConnection`), pools them
  (`pooledLink`), follows grants (`grantFollowingLink`), relays (`relayLink`), builds Effect clients
  (`createMeshClient`) and keeps a replica registered (`replicaHeartbeat`). A refused handshake counts as a failed
  attempt and fails the waiting calls after a bounded number of tries.
- **Roster gossip.** Agents exchange what they know every few seconds (`roster.exchange`): the replicas and the agents
  each one can reach. One reachable seed (`MESH_SEEDS`) is enough, because an exchange also carries the agents the peer
  knows of, so a fresh agent finds the whole mesh through it. A node's own replicas are never taken from gossip, only
  from registration, and expiry ages out a node that stopped being gossiped. Records expire on the clock of the agent
  that stamped them, so agents' clocks must be kept in sync (NTP) to within a fraction of the registration TTL.
- **Proven over real sockets.** `src/boot/mesh-cluster.spec.ts` boots two real agents and one real replica: the replica
  registers with agent A, agent B learns it by gossip alone, a call to B reaches the replica through B's relay, a heavy
  call is granted and followed directly, an unauthenticated call is refused, and a call pinned to another node is
  forwarded to that node's agent.

Not built yet: the remaining `MeshCoreModule` imports in the runtime, byte accounting from the transport (the lease policy's bytes-per-second input is fed by nothing), the
bridge topology for large meshes (agents currently connect to every agent they learn of, which is the small-mesh
design), the onboarding agent, services registering themselves with their agent (`replicaHeartbeat` exists, no
service calls it), the per-service `external`/`peer`/`node` routers, a swarm global-mode deployment of the agent, and the
removal of the old mesh code.

## Plug and play: alone first, swarm later

A node is never created from environment variables. An agent starts empty, on a node that is in no swarm, and works at
once; it is configured later, by joining a swarm.

**First boot.** The agent owns the node's local store, a SQLite file in its data directory (`MESH_DATA_DIR`, a mount
point, default `/var/lib/deployer/mesh-agent`; owner-only permissions). On the first boot it creates the file, applies its
schema steps and generates two things: the node's id (`node-<uuid>`) and a standalone credential of its own. Every later boot
reads them back, so a node is the same node after a restart. Nothing is read from the environment, and nothing
reaches the agent until someone holds its credential.

**Everything else is in memory** and rebuilt by registration and gossip: the directory, the key hints, the pooled links
and the load counters. Two runtimes on one node register with their local agent and are resolved by key, locality and load,
redirected between each other and relayed, exactly as in a cluster; there is simply nobody else to gossip with.

**Joining.** An agent that is already in a swarm, or a standalone one (which becomes the first node of a new swarm,
under a fresh swarm id, by issuing a token), issues a join token with `roster.token`. The new node redeems it with
`roster.join { token }`. The token carries the address of an agent of the swarm, the swarm's credential and an expiry
(an hour by default, a day at most); it is the swarm's secret, so it is shown once. Redeeming it:

1. decodes and checks the token (a malformed or expired one is refused and changes nothing);
2. installs the swarm's credential in the store first, then in force, so the very first connection already carries it;
3. remembers the seed in the store, so a restarted node rejoins by itself;
4. gossips with the seed at once: everything the agent already holds is sent, everything the swarm knows comes back.

The seed is retried every round until it answers, so the swarm does not have to be up yet. A node's own replicas are
only ever taken from registration, never from a peer, so joining cannot overwrite what the agent knows first-hand.

**The environment is dev-only.** `MESH_NODE_ID`, `MESH_AGENT_SECRET`, `MESH_SEEDS` and `MESH_ADVERTISE_URL` exist so a
developer or a test can pin a value or form a stack without a token; a node that is plug and play sets none of them. A
future CLI will drive the same `roster.token` and `roster.join` procedures.

**Who owns the node-local database.** The agent, because it is the only service on every node. Today it holds the node's
identity, credential and seeds. The existing `@deployer/node-state` tables (`node_config`, `node_mesh_config`) and the
`NODE_LOCAL_DB_PATH` file that each service opens now are to move behind the agent, and services will ask the agent over
the mesh instead of opening the file.

The node id must outlive the join. It is generated once and stored, so a join does not change it.

## How a service reaches its agent without the credential

The agent listens on two doors. The network door (the service's HTTP port, `/mesh/ws`) is for other agents and is
guarded by the swarm's credential. The node door is a unix socket, `run/agent.sock` in the agent's data directory, for the
services of its own node; the socket's file permissions are the only credential there, so a service never holds the swarm's
secret and there is nothing in it to leak or to rotate.

A service takes part in the mesh with `joinMesh` from `@deployer/mesh-service`, and the only thing it needs is the path of
that socket:

- it registers with its agent over the socket, every few seconds, with its address, load and the keys it holds;
- it serves its own mesh router on its websocket, and when a peer connects it asks the agent whether to trust it
  (`access.verify`), because the agent alone holds the credential. The peer presents either the swarm's credential (an
  agent relaying a call) or a direct grant's token (a caller the agent sent), and the agent checks both. An answer is
  remembered for 30 seconds, and an agent that cannot be reached refuses the peer: unknown is not trusted.

Known limits, stated plainly: the swarm credential is one shared secret with no rotation yet, a token cannot be revoked
before it expires, the advertised address defaults to the host's name (no overlay-address discovery yet), and a service
on the node reaches its agent through the socket, so it never holds the credential.

## Runtime on the mesh

The runtime is the first real service on the mesh. Its node router lives in `@deployer/runtime-contracts` under `mesh/`
(reached as `@deployer/runtime-contracts/mesh/index`, never composed into the public BFF router): `containers`
(list, inspect, catalog), `runtime` (logs, processes, process logs, files, read, write, delete, rename, create directory,
terminal open, events, input, close) and `images` (inspect). Each procedure takes the old topic payload's query or body
as its input and answers its snapshot or acknowledgement as its output, with no envelope, correlation id or responder:
the mesh pins the call to the node that owns the container, so the answer needs no signature to say whose it is.

At boot, after its port is bound and its dependencies are proven, the runtime looks for the agent of its node (the socket
`/var/lib/deployer/mesh-agent/run/agent.sock`, or `MESH_AGENT_SOCKET`). Without one it runs exactly as before. With
one it takes part through `joinMesh`: it registers every few seconds, announcing every container id on the node as a key,
so a call about a container reaches the node that owns it, and it serves the node router on its websocket. It holds no
credential: its agent vouches for the peers that connect.

The runtime's docker callers (container resolution, container access, the runtime catalog) ask the other nodes through
`DockerNodeMesh`, which replaced the topic-based docker mesh services and their registrar, now deleted. It keeps the old
methods' names, arguments and result shapes, so the code that merges lists, dedupes by responder and falls back to the node
that owns a container did not change; what changed is how a node is reached. It asks through the runtime's link to its own
agent: a question about a container goes first to the node that announced that container id (the directory's key holder),
and to every other node if that fails or nobody announced it; a question with no owner (a list, a catalog, a terminal
session, which is not announced as a key) goes to every other node. Each node answers from its own engine only. A runtime
with no agent, or with nobody to ask, gets no responses, which is what a lone node always meant.

Runtime events are pulled, not broadcast. The node router has an `events.stream` procedure that serves this node's own
events (the engine's, plus what the node adds by hand, such as a scan announcing itself). `DockerRuntimeMeshRelayService`
merges its own events with a stream it follows on every other node: one loop per node that reconnects after a pause when
the stream breaks, with the set of nodes re-read every few seconds, so a node that is slow or gone costs only its own
stream and nothing is buffered for it. Every event carries the id of the node it happened on. The deployment mesh no
longer exists: a deployment's streams are served from the node that runs it.

## The dashboard's view of the mesh

Fleet serves the mesh surface the dashboard reads (`meshContract`, delegated by the BFF), and it reads it from the agent
of its node rather than keeping a picture of its own. `MeshViewService` asks `roster.view` (this agent's node and the
agents it knows of) and `directory.snapshot` (every replica), and the procedures answer with schemas that hold only what
the agents report: `getLocalNode` and `listPeers` give nodes (id, address, whether it is this one), `membershipSnapshot`
gives nodes plus replicas (service, node, load, announced keys), `streamTopology` sends a snapshot again whenever it
differs, `lookupResource` is `directory.resolve` (which replica a call about a key would reach, and why), and
`issueJoinToken` is `roster.token`. A node without an agent is a swarm of one: it lists itself, has no replicas, and
cannot issue a token, because it holds no swarm credential.

Dropped, because the agent has nothing to answer them with: the trust keyring and strict mode (the agent generates and
verifies its own credential), manual peer connect/disconnect/heartbeat and membership reconcile (agents connect to every
agent they learn of), the resource index and the route and queue-partition planners (the directory resolves), and the
control-envelope and session-stream transport of the old mesh. No link latency, jitter or loss is shown: nothing
measures them. Still served by the old controller: the ping, the node's metrics, the node configuration procedures and the
event-stream procedures.

## Enrollment: how a node joins a fleet

The operator brings one thing: a join token. On a node of the fleet, the dashboard issues it (`issueJoinToken`, which is
`roster.token`); it carries where to find the swarm, the swarm's credential and an expiry, so it is shown once. On the new
node's setup wizard the operator pastes it, and nothing else is typed: no address, no account.

1. **`agent_join`**: the setup flow gives the token to this node's own agent (`roster.join`). The agent adopts the swarm's
   credential, remembers the seed so it rejoins by itself after a restart, and gossips; this node's id is the one its agent
   generated on first boot.
2. **`mesh_handshake`**: the node asks the fleet to describe itself through the mesh (`enrollment.describe`, a mesh-only
   contract fleet serves next to its own). The agent finds a fleet replica as gossip teaches it where they are, so the
   flow waits for that rather than failing at once. The answer is the fleet's version and the WireGuard mesh the
   node's entry must name.
3. **`version_check`**: a node behind the fleet's version is refused; one ahead may join.
4. **`register_node`**: `enrollment.enroll` records the node in the fleet's registry and answers the shared database URL,
   the swarm role the fleet decides (a node can neither promote itself nor found a rival swarm) and the WireGuard roster
   that admits the node's signed entry. Then `finalize` persists the node config and the swarm join converges.

The token is the only authorization, and it is checked by the agent: the fleet holds no swarm credential, so before it
answers it asks its own agent `roster.check`, which says whether the token is the swarm's and still good, and never
returns the credential. A node with no agent enrolls no one. The old exchange (a Better Auth sign-in on the remote node,
a one-time grant, a shared secret and a peer service token handed back) and the setup probes that served it
(`probeMesh`, `remoteAuth`) are gone. Revoking a token before it expires is not built: tokens are as short as the
operator makes them.

## Services and their clients on the mesh

Every service (health, identity, project, fleet, runtime) joins the mesh of its node at boot, after its port is bound and its
dependencies are proven, if the node has an agent (`MESH_AGENT_SOCKET`, default
`/var/lib/deployer/mesh-agent/run/agent.sock`). Without one it runs exactly as before and is reached directly. With one it
registers with its agent and serves its contracts over the mesh websocket (`joinServiceMeshOnNode`).

**How a service serves its contracts without rebuilding them.** Its contracts are already implemented once, in its
controllers, behind the pipeline that makes it what it is: Better Auth resolving the session, the guards, the interceptors, the
Effect context and the error mapping. A second implementation for a second transport would be a second place for that to
drift. So the mesh endpoint is a loopback router: each procedure of each contract is mounted under the contract's id
(`contractId`, a fingerprint of the contract's procedures, derived the same way by the caller and the service, because a
service answers several contracts whose paths are relative to their own root), and a call to it becomes the same call on
the service's own HTTP surface on `127.0.0.1`, carrying the caller's own headers. The persistent link is the mesh's (agent to
replica, one websocket); the hop to the controller is in-process. What comes back is what the service answered: typed errors
keep their code and data, dates are revived by the contract's output schema, and an event stream stays a stream.

**How a client reaches a service.** `ServiceClientRegistry` (the BFF's) takes an optional link factory. With an agent, every
call is a relayed call: `relayLink` sends `{ service, path: [contractId, ...path], input, headers }` to the local agent, which picks the replica
(key, then locality, then load), answers any redirect itself, and carries the answer back; when it would rather not carry
the bytes it answers with a grant that the link follows. The caller's credentials (cookie, authorization) ride on each call as
`headers`, and arrive as the headers of the call at the service, so the service authenticates the caller exactly as if it
had been called directly: one connection serves many callers, each with their own. Without an agent the registry calls each
service's origin directly, as a node does alone. `BaseClient` and every client class are unchanged.

**What the runtime adds.** It also answers its node router under `mesh.node` (see "Runtime on the mesh"), and announces its
container ids as keys.

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
opened on first use and reconnect with backoff; the grant interceptor (`MESH_DIRECT`) and `createEffectClient` sit on top of that
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
