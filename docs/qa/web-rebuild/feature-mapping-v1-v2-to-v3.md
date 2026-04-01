# V1/V2 → V3 Web Rebuild Feature Mapping (Baseline)

> Last updated: 2026-03-24
> Scope: `apps/web` user-facing surfaces used to rebuild the v3 web app from a clean base.

## Summary

- `v1` and `v2` expose a broad project-centric deployment UX (projects/services/deployments/config tabs).
- Current `v3` web is organization/admin/profile heavy and missing most deployer feature pages.
- Immediate objective: rebuild v3 web using v1/v2 as source-of-truth for feature scope, while keeping v3 typed routing + domain-layer patterns.

## Feature matrix

| Feature area | v1 evidence | v2 evidence | v3 status | Notes for rebuild |
|---|---|---|---|---|
| Project configuration shell + tabs | `v1/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/layout.tsx` | `v2/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/layout.tsx` | Missing | Core IA missing in v3; port first as navigation spine. |
| Project general config | `v1/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/general/page.tsx` | `v2/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/general/page.tsx` | Missing | Start with read-only + save scaffold, then wire API mutations. |
| Project environment vars config | `v1/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/environment/page.tsx` | `v2/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/environment/page.tsx` | Missing | Important for deploy flow; include secret masking/import/export UX. |
| Project environment instances (prod/staging/preview) | `v1/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/environments/page.tsx` | `v2/apps/web/src/app/dashboard/projects/[projectId]/(tabs)/configuration/environments/page.tsx` | Missing | Strong deployer differentiator; should land in phase 1. |
| Project/service/deployment domains (global scope) | `v1/MIGRATION-FEATURE-INVENTORY.md` (sections: Project/Service/Deployment/Domain modules) | same feature parity implied by v2 migration bridge | Missing | Build pages in v3 around contracts already present in API migration stream. |
| Dashboard landing | `v1` dashboard ecosystem (project-centric) | `v2` same shape | Partial | Exists: `v3/apps/web/src/app/dashboard/page.tsx` but currently not project/deployment-centric and has type drift. |
| Organization management | Present in inventory (team/org support) | present | Present | Existing routes/pages in v3: `dashboard/organizations/**` can be kept and integrated into rebuild. |
| Admin system views | Inventory includes admin/system operations | present | Present | Existing `v3` admin pages exist and can remain as control-plane surfaces. |
| Profile/account | inventory has user/profile flows | present | Present | Existing `v3/apps/web/src/app/dashboard/profile/page.tsx`; currently has role typing issues to fix. |
| Template/demo/showcase surfaces | N/A (not deployer target) | N/A | Removed from `src` | `showcase`, `build-info`, and `dashboard/demo` references removed from source route surface. |

## Current v3 page inventory snapshot (for parity tracking)

Current pages under `v3/apps/web/src/app/dashboard/**`:
- `page.tsx`
- `admin/organizations/page.tsx`
- `admin/servers/page.tsx`
- `admin/system/page.tsx`
- `admin/users/page.tsx`
- `organizations/page.tsx`
- `organizations/new/page.tsx`
- `organizations/[organizationId]/page.tsx`
- `organizations/[organizationId]/invites/page.tsx`
- `organizations/[organizationId]/members/page.tsx`
- `organizations/[organizationId]/settings/page.tsx`
- `profile/page.tsx`

Notably absent (must be created for deployer parity):
- `dashboard/projects/**`
- `dashboard/services/**`
- `dashboard/deployments/**`
- project configuration tab stack from v1/v2

## Recommended implementation order (v3)

1. **Fix baseline type stability** in current dashboard/profile/session typing (unrelated to template purge but blocks clean checks).
2. **Create project-centric route skeleton** (`dashboard/projects`, `[projectId]`, tab layout) with typed route metadata.
3. **Port configuration tab IA** (`general`, `environments`, `environment`) from v2 with modernized UI and domain hooks.
4. **Add deployment list/detail pages** and connect to deployment domain hooks.
5. **Add service list/detail pages** and service CRUD hooks.
6. **Wire activity/log streams + deployment logs UX**.
7. **Polish + consistency pass** (design tokens, loading/error/empty states, permissions).

## Immediate blockers discovered during validation

- `v3/apps/web` type-check currently fails due session/role typing mismatches:
  - `src/app/dashboard/page.tsx`
  - `src/app/dashboard/profile/profile-form.tsx`
  - `src/app/dashboard/admin/users/page.tsx`
  - `src/utils/providers/SessionHydrationProvider.tsx`
- Web test suite also reports setup-path dependency mismatch around ORPC utils import.

These are **not caused by template-route removal**, but should be resolved before major feature-port batches.
