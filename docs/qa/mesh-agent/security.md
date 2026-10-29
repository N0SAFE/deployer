# Q&A — Mesh agent: security

> **Module**: mesh-agent
> **Category**: security
> **Last updated**: 2026-10-29

---

## The agent follows the standard service anatomy, and how it authenticates

**Q**: (operator) "why there is no nestjs in it ???" and "it should follow the same exact standard as the other api micro services".

**A**: The first slice was framework-free by mistake. The service now has the same anatomy as `health` (bootstrap, root module of imports, domain module, controller, Effect services as module-provided constants, contract package).

**Q**: The standard service imports AuthModule (needs Postgres), but an agent runs on every node, including before the swarm exists. How should it authenticate?

**A**: "i dont understand this point find the best way to do it with a perfect structure and a production ready code". Decision taken: a mesh credential, no database. The agent keeps the standard transport and replaces Better Auth with the `x-mesh-credential` header, checked in constant time against `MESH_AGENT_SECRET`.

---
