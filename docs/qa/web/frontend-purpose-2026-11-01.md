# Q&A — front end: purpose and experience (2026-11-01)

> **Module**: web  
> **Category**: business-logic / api-design  
> **Last updated**: 2026-11-01

---

## Direction

**Q**: What do you want for the front end?

**A**: A complete roadmap for the front — research the best dashboard usage and how the UI/UX can be enhanced, and state
what its purpose and user experience should be. Research online, using several sub-agents.

## What the roadmap decided (design, not operator input)

Recorded here so the next session does not re-open them silently:

1. **Purpose**: the console answers "is it serving / what changed / what can I do now" in ten seconds. It is a control
   room, not an analytics product.
2. **Primary unit**: the service, not the project or the deployment.
3. **No KPI strips**, one verdict sentence per page (extends the rule already in `apps/web/AGENTS.md`).
4. **Six required states** per data surface: loading, empty, filtered-empty, error, stale/offline, no-access.
5. **Consolidated IA**: global and project lists share one component; scope (node/project/env) lives in the header; the
   URL is the state.
6. **Trust before features**: the fake/mislabelled surfaces are Phase A and block everything else.
7. **Permissions from the catalog**: no role literal in a component (`useCan`).

## Still open (do not block Phase A)

- Landing page at `/`: public marketing page or redirect into the console? (audit `WEB-106`).
- Organizations in the IA or not (audit `DEC-WEB-6`, recommendation: skip).
- Whether the UI may edit file-managed resources (`deployer.yaml`), which changes the settings surfaces.
- Product analytics: a privacy-light event bus behind a flag, or none at all.
