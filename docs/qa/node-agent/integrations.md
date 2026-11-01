# Q&A — Mesh agent: Integrations

> **Module**: node-agent
> **Category**: integrations
> **Last updated**: 2026-10-29

---

## Placement of the new node-agent service

**Q**: Where does the new node-agent service run? Today's agent runs below Swarm so a node can onboard and join the mesh before Swarm exists.

**A**: Global-mode, so handled by Swarm. But for onboarding there should exist another agent that is there only for onboarding and should not be persisted.

---

## The `@deployer/mesh-network` package

**Q**: What happens to the `@deployer/mesh-network` package (WireGuard driver, roster, gossip protocol, agent client)?

**A**: Fold it into the new service.

---

## How global (non-node) mesh messages travel

**Q**: How do global (non-node) mesh messages travel between replicated services?

**A**: "i trust youre vision on this one. i dont have any idea what can be the best but i want a robust design that work perefctly without downside the goal is that everyhting should use orpc os that its better. but it should go thrue the mesh with an orpc abstraction so we dont have to handle mesh related things for everyhting. the goal is that when i have to make inter communication we should have to create bridges that are always there. for mesh dont create constant connection without understanding but instead use orpc rpc link for constant connection. dont connect everything together the connection flow should be intellignet so any service on any node on any replicate can communicate with the desired service without having a connection between every one it should go thrue bridges. (this design is for very big mesh. for little mesh everything can be connected together intelligently.)"

---

## Nodes are plug and play; env is dev-only; the agent owns the local DB

**Q**: (stated by the operator) How is a node created and configured?

**A**: "creation for a new node should never be done using env variable. env variable are only for dev related things like enabling api or feature or doing onboarding automatically and seeding etc. it can also be done for a next implemented cli node creation but a new creation will never be directly based on env variable by default it should be plug and play and configured later in db. also the system of local db should be handle by the mesh agent since its the only service that run on all nodes."

**Decisions taken from it**:
- An agent starts empty. On first boot it generates its own node id and a standalone credential and persists them in its local store; nothing is read from the environment by default.
- Joining a swarm is done with a join token issued by an agent already in the swarm, not with a pre-shared environment secret. The token carries the swarm credential and a seed address; the joining agent persists both and rejoins by itself after a restart.
- The node-local SQLite database is owned by the agent. Services do not open it; they ask the agent. The existing `@deployer/node-state` tables (`node_config`, `node_mesh_config`) move behind the agent in a later step.
- Environment variables remain only as optional dev overrides (`MESH_NODE_ID`, `NODE_AGENT_SECRET`, `MESH_SEEDS`, `MESH_ADVERTISE_URL`), documented as such.

---

## The agent is a node image, built but not yet launched by setup

**Q**: (design decision, 2026-10-30) How does the new agent reach a node?

**A**: As an image produced by the deployment, not by a compiled binary. `infra/docker/builder/node-agent/Dockerfile.svc-node-agent`
prunes `@deployer/svc-node-agent` and runs it from source (a `tsconfig.json` discovery trap: the working directory must be
the app's, or Nest decorators get the TC39 signature and the process dies at import). It installs `wireguard-tools` and
`iproute2`, keeps `/var/lib/deployer/node-agent` as its volume, and is built by `build-svc-node-agent` in
`docker-compose.services.dev-supervised.yml`, tagged `NODE_AGENT_IMAGE`. Nothing launches it yet: setup still starts
the old agent, which is the only server of the enrollment/admission API. A test build boots the service, maps its
routes and creates its local socket.


## The switch is `NODE_AGENT_IMAGE`

**Q**: (design decision, 2026-10-30) How does a deployment move from the old agent to the new one, and back?

**A**: One variable. With `NODE_AGENT_IMAGE` set, setup's launcher and the API's boot ensure the new agent's container
instead of the old one; unset, both keep today's agent. The new container keeps the old one's name and role label, so it
**replaces** it (two agents cannot both own the host interface) and reverting replaces it back; its data lives in its own
volume (`deployer-node-agent-data`). Both branches are exercised only against the engine fake — a real flip still needs a
node run. One socket serves both the relay link and the node door: `NODE_AGENT_SOCKET` (default
`/run/deployer-node/agent.sock`) for the node-door client,
while `NODE_AGENT_SOCKET` continues to point at the old agent until the deletion.


## Only one agent (2026-10-30)

**Q**: (design decision) When can the old agent be removed?

**A**: Once every duty it served has a replacement: status/settings (`node.status`/`node.settings`), settings writes
(`roster.setting`), admission (join tokens), labels (`node.labels`), member revocation (`roster.block`), container
creation (`packages/node/agent-container`), cluster settings (`ClusterSettings`). That is now true; `apps/mesh-agent`,
`@deployer/mesh-network` and the shared `node-agent` module are deleted, and `NODE_AGENT_IMAGE` is the only agent
image. The old Dockerfile and `build-mesh-agent` producer are gone with them.


## The agent can be a swarm service (2026-10-31)

**Q**: (design decision) Should the agent run as a swarm service instead of a host container?

**A**: It can, opt-in, with `NODE_AGENT_SWARM_MODE=true`: a `node-local` GLOBAL service (one task per node) with the same
image, host network, `NET_ADMIN`, the same data/run volumes and the docker socket. The supervisor removes the
platform-managed host container when it takes over, so the ON direction is safe. The reverse is manual
(`docker service rm deployer-node-agent-swarm` before clearing the flag), and the flag should only be set on a node whose
mesh already exists: the agent must exist before Swarm, so a brand-new node with the flag on founds Swarm without the
mesh address. The host container stays the default.

