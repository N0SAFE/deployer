# Q&A — Mesh agent: Integrations

> **Module**: mesh-agent
> **Category**: integrations
> **Last updated**: 2026-10-29

---

## Placement of the new mesh-agent service

**Q**: Where does the new mesh-agent service run? Today's agent runs below Swarm so a node can onboard and join the mesh before Swarm exists.

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
- Environment variables remain only as optional dev overrides (`MESH_NODE_ID`, `MESH_AGENT_SECRET`, `MESH_SEEDS`, `MESH_ADVERTISE_URL`), documented as such.

---
