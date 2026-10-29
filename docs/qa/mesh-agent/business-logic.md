# Q&A — Mesh agent: Business logic

> **Module**: mesh-agent
> **Category**: business-logic
> **Last updated**: 2026-10-29

---

## What the mesh is for, and who may host it

**Q**: (stated by the operator, not asked) Which services may use the mesh directly?

**A**: "the mesh is technically doing things it should not. mesh should work only accross not the bff but a micro service dedicated to have information per node in the swarm. it should exist a micro service dedicated to live on all the node of the swarm for node relative things like usage or a lot of things like that. but it should also work for things that need streaming and not related to a node. but i want the mesh things to work for this kind of things."

---

## The split into two primitives

**Q**: (stated by the operator) How should the mesh be structured?

**A**: "i think the mesh should have been split in two primitive because there is mesh communication per node and mesh communication global per node communicate with the mesh-agent and global communicate with the micro services global (they can have replicates)". The existing partial work is the mesh agent: continue that architecture, but as a new microservice called `mesh-agent`, remove the other mesh-agent, migrate to Effect, use the shared code of the API apps, and enhance its capacity to communicate with the mesh.

---
