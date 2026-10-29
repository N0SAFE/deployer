# Q&A — Mesh agent: API design

> **Module**: mesh-agent
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
