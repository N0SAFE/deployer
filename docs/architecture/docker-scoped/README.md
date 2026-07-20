# Scoped Docker Architecture — Overview

> **Status:** Proposal / Design Document  
> **Date:** 2026-07-17  
> **Scope:** Docker container management, image management, vulnerability scanning

## The Problem

The current architecture treats Docker as a **global, node-level resource**:

```
Docker daemon → API → Global entity stream → All containers, all images
                 ↓
           Scanner → scans ALL images on the node
                 ↓
           No project/service boundary → everything mixed
```

- Containers have `projectId`/`serviceId` fields but they're often populated with container hash fallback (not real project IDs)
- Orphan containers (not managed by a deployment) have no project/service scope at all
- The entity stream emits **every** container/image/network/volume on the Docker host regardless of project membership
- Security scanning runs on **all** images without project/service context
- Container list filtering by `projectId`/`serviceId` happens **after** fetching everything from Docker
- Mesh fanout queries return results from ALL nodes without project scoping, requiring expensive client-side filtering

## The Solution: Scoped Architecture

```
Project A ──→ Service A1 ──→ Environment "prod" ──→ Container(s)
                ↓                    ↓                    ↓
           Service A2 ──→ Environment "staging" ──→ Container(s)
                ↓                    ↓
           Builds Image A2:latest ──→ Scanner (scoped to project A)

Project B ──→ Service B1 ──→ Environment "dev" ──→ Container(s)
```

Each level knows its containers/images:
- **Project** owns a set of containers and images (directly and via services)
- **Service** owns its containers across environments
- **Environment** scopes containers within a service
- **Scanner** is triggered per-project with service-level filters
- **Images** are associated with projects through deployment/build records

## Key Changes

| Aspect | Current | New |
|--------|---------|-----|
| Container listing | Global, filters after fetch | Scoped by project/service/environment |
| Image catalog | Global | Scoped by project |
| Entity stream | All entities from daemon | Filtered by project membership |
| Security scanning | All images on node | Per-project, with service-level filters |
| Scan results | Global table | Linked to project + service + image |
| Orphan containers | No scope, shown everywhere | Listed separately, tagged per-project |
| Mesh queries | Full node fanout | Scoped by projectId |

## Documentation Index

| Document | Description |
|----------|-------------|
| `01-data-model.md` | New entity schemas, relationships, scoped fields |
| `02-container-lifecycle.md` | How containers are created, scoped, and tracked |
| `03-image-catalog.md` | Scoped image management per project/service |
| `04-scanning-architecture.md` | Vulnerability scanning per project with service filters |
| `05-api-surface.md` | New ORPC contract endpoints and filters |
| `06-migration-plan.md` | Step-by-step migration from global to scoped |
