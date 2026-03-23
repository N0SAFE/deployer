# Q&A — Platform Direction: Project & Service Architecture

> **Module**: platform-direction  
> **Category**: project-service-model  
> **Last updated**: 2026-03-04

---

## Project vs Service model

**Q**: What is the relationship between a Project and a Service? Can a project have multiple services from different repos?

**A**: Project = logical grouping. Services are independent repos. A project groups multiple independent services (each from its own repo) under a unified namespace. This means one project could have a frontend (repo A), a backend API (repo B), and a worker (repo C), all managed as a unit.

---

## Service scaling

**Q**: Can a service run multiple replicas, and is scaling manual or automatic?

**A**: Scaling is configurable per service and per project. Supports:
- **Manual scaling**: user sets replica count explicitly
- **Auto-scaling**: based on CPU / request rate thresholds
- Configurable limits (max replicas, max CPU%, max memory) to prevent runaway scaling
- Configurable target node(s) for replicas (spread across nodes or pin to a node)

---

## Environment tiers per project

**Q**: What deployment environment tiers exist per project?

**A**: **Fully configurable** — user defines tiers (e.g. `prod`, `staging`, `qa`, `preview`). No fixed set of tiers. Preview environments are a special auto-managed tier (created per PR/branch), but users can create any named tier.

---

## Service dependencies / start order

**Q**: Should the platform manage service start-order and wait-for-healthy dependencies?

**A**: Yes — dependency graph defined in the platform UI. Platform waits for a service to pass health checks before starting dependent services.

---

## Service configuration as code

**Q**: Should services be configurable via a config file committed to the repo?

**A**: Both — UI and file-based config sync **bidirectionally**. A `deployer.json` / `deployer.yaml` in the repo defines service config. Changes in the UI propagate to the file (via a platform-managed commit) and changes to the file trigger a config sync.

---

## Static file / frontend hosting

**Q**: For static sites: how are they served?

**A**: User chooses per service:
- Platform-managed Nginx container serving the build output folder
- Push to S3-compatible bucket and serve via CDN
