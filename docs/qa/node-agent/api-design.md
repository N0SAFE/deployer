# Q&A — Mesh agent: API design

> **Module**: node-agent
> **Category**: api-design
> **Last updated**: 2026-10-29

---

## Global mesh: direct, with discovery, redirects and replica peers

**Q**: (stated by the operator) How does the global mesh route?

**A**: "global mesh is direct service to service but still as a service discovery to know for specific in memory related content so it can request the right replicate of the service. and sometime we only request the service without having to know its replicate. this should be handle by a little framework that will permit to request a service and this service can answer with a redirect to a specific replicate for inter service replicate work. so that the caller can request a service and have auto redirect to the right one. also service can request other replicates of there own service to find resources to redirect or just forward resources"

---

## oRPC clients

**Q**: (stated by the operator) Which client constructor do oRPC clients use?

**A**: "the orpc client should all use the createEffectClient to be able to use effect related things inside it"

---

## Redirects are an interceptor plus a custom error code

**Q**: (stated by the operator) Where does the auto redirect live?

**A**: "the auto redirect should be done by an orpc interceptor on each caller and the service called should respond with a custom error code and the interceptor should catch it and do the things to retry the error on the right replicate or the right forwarded way"

---

## Separate routers, non-public mesh contracts

**Q**: (stated by the operator) How are mesh contracts organised?

**A**: "the different contract type should be in different router so the peer request and the external service and per node request should be in different router and also all contract should be not public so inside a dedicated mesh folder."

---

## Server-side clients use the RPC link

**Q**: (stated by the operator) Which link do service-side oRPC clients use?

**A**: "all service side orpc client should use rpc link instead of openapi so that its persistent link"

---

## The agent brokers every request; direct links are leases

**Q**: (stated by the operator) Do services call each other directly?

**A**: "every request should path at least for discovery from the mesh agent. its him that hold the rpc links opened for inter services access. the only case where a service as a direct connection to another service is for load and stream or direct ressource access where the mesh agent as to much load and return to the service a dedicated request with a direct link to the requested service/replicate it still should go thrue rpc links and make pool inside rpc links for inter services requests"

---

## External access always goes through the agent; locality first; the agent answers redirects

**Q**: (stated by the operator) How is a service resolved, and who handles `MESH_REDIRECT`?

**A**: "external service access should always go thrue the mesh agent that will redirect to the same node if the service request is replicated on this node instead of going to another node. also the mesh agent should be the one that will respond to the mesh redirect error response"

**Supersedes**: the earlier decision that a client interceptor on each caller follows `MESH_REDIRECT`. The caller interceptor now handles `MESH_DIRECT` only.

---

## Fleet's old mesh control plane (2026-10-29)

**Q**: What should replace fleet's old mesh control plane (peers, grants, keyring, topology, node config, resource dispatcher)?

**A**: Port every procedure: keep the whole `meshContract` surface and reimplement each procedure over the agent.

---

## What the dropped procedures were, and what replaces the kept ones (2026-10-29)

**Q**: For the keyring, strict mode, manual peer connect and the resource dispatcher, drop them or keep them as stubs?

**A**: Drop them.

---

**Q**: Should the kept mesh procedures get new schemas that match what the agent knows, or keep the old schemas with defaults for the fields the agent lacks?

**A**: New schemas.

---
