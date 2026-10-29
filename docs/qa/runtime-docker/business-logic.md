# Q&A — Runtime docker: business-logic

> **Module**: runtime-docker (Effect migration of `apps/api/services/runtime/src/modules/docker`)
> **Category**: business-logic
> **Last updated**: 2026-10-29

---

## Strategy

**Q**: The runtime docker module is a 4,232-line `DockerRepository` facade under about 40 Promise services. How should it be migrated?

**A**: Split by domain: carve the facade into Effect repositories per domain (networks, volumes, images, containers, scans, runtime catalog) over the `DockerEngine` tag, then migrate each domain's services and controller handlers to Effect services. One domain per commit, tests green each time; start with networks + volumes.

---

## Errors

**Q**: Should docker domain errors stay as the current `AppError`/`RuntimeNotFound` style, or become tagged `domainError`s?

**A**: Tagged `domainError`s, mapped by kind through `serve()`, matching identity, project and fleet.

---
