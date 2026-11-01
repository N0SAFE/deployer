# Q&A — Mesh agent: Business logic

> **Module**: node-agent
> **Category**: business-logic
> **Last updated**: 2026-10-30

---

## What the mesh is for, and who may host it

**Q**: (stated by the operator, not asked) Which services may use the mesh directly?

**A**: "the mesh is technically doing things it should not. mesh should work only accross not the bff but a micro service dedicated to have information per node in the swarm. it should exist a micro service dedicated to live on all the node of the swarm for node relative things like usage or a lot of things like that. but it should also work for things that need streaming and not related to a node. but i want the mesh things to work for this kind of things."

---

## The split into two primitives

**Q**: (stated by the operator) How should the mesh be structured?

**A**: "i think the mesh should have been split in two primitive because there is mesh communication per node and mesh communication global per node communicate with the node-agent and global communicate with the micro services global (they can have replicates)". The existing partial work is the mesh agent: continue that architecture, but as a new microservice called `node-agent`, remove the other mesh-agent, migrate to Effect, use the shared code of the API apps, and enhance its capacity to communicate with the mesh.

---

## How a node is created

**Q**: (stated by the operator) Should a new node be created from environment variables?

**A**: "creation for a new node should never be done using env variable. env variable are only for dev related things like enabling api or feature or doing onboarding automatically and seeding etc. it can also be done for a next implemented cli node creation but a new creation will never be directly based on env variable by default it should be plug and play and configured later in db."

Consequences, as implemented on 2026-10-30:

- An agent boots with no configuration and generates its identity and a standalone credential in its own database; a
  fresh node reports `configured: false`.
- `node.configure` (the node door, unix socket only) is what creates the node: it writes the node record into the
  agent's local database. Setup, the API and a future CLI all drive that one procedure; none of them decides a node id.
- `MESH_NODE_ID` is only a seed for a store that has no identity yet (dev, a test). Once the store holds one, the store
  wins, so dropping the variable does not rename the node.
- The API no longer creates a placeholder `node_config` row at boot from `MESH_NODE_ID`/a random UUID; an unconfigured
  node simply has no row, and `getNodeId()` returns `""` until the node is configured.

## Which id is the node's

**Q**: (arising from the above) The agent already generates an identity on first boot — is that the node's platform id?

**A**: No. There are two ids with two lifetimes. `agentId` (`node-<uuid>`) is the agent's own mesh identity, generated
on first boot and never configured. The platform node id is a UUID written when the node is configured (setup or a
CLI), through `node.configure`; it is what `cluster_nodes.node_id` is keyed by. An unconfigured node has no platform
id, which is exactly why nothing may invent one.

The API reads the record from the node's agent at boot (`readNodeRecord`, node door only) and takes the platform id
from it when configured; otherwise it falls back to the local `node_config` row, and then to nothing — never to
`MESH_NODE_ID`.

The API's node-config repository is agent-first: `find` reads the record from the node's agent and `upsert` writes it,
falling back to the local `node_config` file only while the agent stays silent (absent, too old, or a timeout). The
readers await it now (`runPromiseUnwrapped`), because asking the agent is I/O; the ones that cannot (the global-db
pool's connection factory and the global-db supervisor's sync config callbacks) still read the file.

## Who owns the node-local database

**Q**: (stated by the operator) Which service should hold the node's local database?

**A**: "the system of local db should be handle by the mesh agent since its the only service that run on all nodes."

The agent owns it (`agent.db`): identity, credential, seeds, replicated settings, revoked tokens and the node record.
The legacy `@deployer/node-state` tables remain readable by setup and the API until their readers/writers move onto
`node.state` / `node.configure`; the two databases do not share a file yet.

## Who assigns an overlay address

**Q**: (design decision, 2026-10-30) The overlay needs one address per node — who allocates it, and what happens on a collision?

**A**: The node itself, deterministically. `10.88.0.0/16`, host `1..65534`, derived from `FNV-1a(nodeId#salt)`. A
collision is resolved by a total rule with no coordinator: a node keeps its address only if no known peer with a LOWER
node id holds it, otherwise it moves to the next salt and persists that salt. Two nodes therefore never move together,
and a restarted node comes back on the address it settled on. The address is advertised in the roster
(`AgentInfo.overlay`), so peers plan against it; `node.status` reports the interface state and handshakes.


## The agent is the only one (2026-10-30)

**Q**: (design decision) Is there any node-local mesh component left beside the agent?

**A**: No. The old agent and its package are deleted. The agent owns the overlay (keys, address, peers), the doors, the
node record, settings, join tokens, labels and the blocklist; the platform reads all of it through the node door and
publishes through it. Nothing else on a node opens the mesh.

