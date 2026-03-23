# Permission System Design v3 — Unified Org-Centric Model with PermissionEngine

> **Module**: permissions
> **Category**: architecture
> **Last updated**: 2026-03-09
> **Status**: ✅ Design validated — ready for implementation
> **Supersedes**: v2 design (open questions resolved — see Q&A log below

---

## Summary

**2-layer** permission architecture. No separate project permission layer. Everything is unified in org roles with **resource rules** that support **Directus-style JSON filters** and **cascading** through the resource graph.

| Layer | Roles | Permissions | Resource access |
|---|---|---|---|
| **Platform** | Hard-coded (`superAdmin`, `admin`, `user`) | Hard-coded in `platformAc` | Platform-wide resources |
| **Organization** | Dynamic via Better Auth `dynamicAccessControl` | Hard-coded org resources + **resource rules with filters** for project/service/deployment | Org resources + all project-scoped resources |

**Key idea**: an org role doesn't just say `project: ["read"]`. It says `project: read WHERE { id: { _in: ["proj-1", "proj-2"] } }` — and child resources (services, deployments) **cascade** from project access automatically.

---

## Why this design

### Problem with the previous 3-layer approach
- Per-project permission grants = a separate DB table, separate evaluation logic, separate admin UI
- Two places to manage access (org roles AND per-project grants)
- Adding a user to 10 projects means 10 separate grant operations
- Cascading was hacked on top rather than built in

### What this design gives
- **One place** to manage all access: the org role
- **One evaluation engine** for all resource access checks
- **Automatic cascading**: grant `project:read` on project-1, automatically get `service:read` + `deployment:read` on everything inside it
- **Directus-style filters**: fine-grained "which exact resources" via JSON conditions
- **Custom roles per org**: org admins create roles like `"team-frontend"`, `"devops"`, `"contractor-readonly"`

---

## Layer 1: Platform (unchanged)

Hard-coded roles + permissions. Evaluated by Better Auth's admin plugin.

| Role | Description |
|---|---|
| `superAdmin` | **Bypasses all checks** — full platform access, all orgs, all projects |
| `admin` | User/session management, platform settings, analytics. **Cannot** access org/project resources unless also an org member |
| `user` | Default role. Own profile only. Must be an org member to access anything |

Resources: `user`, `session`, `system`, `setup`, `platformAnalytics`, `platformLogs`, `traefik`, `platformDomain`

**No changes needed** — keep `platformBuilder` in `config.ts` exactly as-is.

---

## Layer 2: Organization (redesigned)

### Two halves of an org role

Each org role has two permission sections:

```
┌──────────────────────────────────────────────┐
│  Org Role: "team-frontend"                   │
│                                              │
│  1. orgPermissions (Better Auth ac format)   │
│     { member: ["read"], team: ["read"] }     │
│     → evaluated by Better Auth ac.check()    │
│                                              │
│  2. resourceRules (custom engine)            │
│     [                                        │
│       { resource: "project",                 │
│         actions: ["read", "update"],         │
│         filter: { id: { _in: ["p1","p2"] }}},│
│       { resource: "service",                 │
│         actions: ["read", "create"],         │
│         cascade: "project" },                │
│       { resource: "deployment",              │
│         actions: ["read", "create","cancel"],│
│         cascade: "project" },                │
│     ]                                        │
│     → evaluated by PermissionEngine          │
│                                              │
└──────────────────────────────────────────────┘
```

**Section 1 (`orgPermissions`)**: standard Better Auth `{ resource: action[] }` format. Handles org-level resources: `organization`, `member`, `team`, `invitation`, `ac`. Evaluated by `organizationAc.check()`.

**Section 2 (`resourceRules`)**: custom JSON stored alongside the role. Handles project-scoped resources: `project`, `service`, `deployment`, `environment`, `logs`, `template`, `webhook`, `apiKey`. Evaluated by a custom `PermissionEngine` in `@repo/auth`.

### Better Auth config

```ts
organization({
    ac: organizationAc,                    // org-level resources only
    dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 50,
    },
    // Additional column on organization_role table for our resource rules
    roleAdditionalFields: {
        resourceRules: {
            type: "string",              // JSON string
            required: false,
            defaultValue: "[]",
        },
    },
})
```

> If `roleAdditionalFields` is not supported by Better Auth, we add a `resource_rules` JSONB column to the `organization_role` table manually via Drizzle migration. Same effect.

### org-level resources (in organizationAc — what Better Auth evaluates)

| Resource | Actions | Purpose |
|---|---|---|
| `organization` | create, update, delete | Org settings |
| `member` | create, update, delete | Member management |
| `team` | create, update, delete | Team management |
| `invitation` | create, cancel | Invite management |
| `ac` | read, create, update, delete | Role management (who can create/edit dynamic roles) |

### Project-scoped resources (in resourceRules — what PermissionEngine evaluates)

| Resource | Actions | Cascades from |
|---|---|---|
| `project` | read, update, delete, manageCollaborators | *(root — no cascade)* |
| `service` | read, create, update, delete | `project` via `services.projectId` |
| `deployment` | read, create, cancel, delete, rollback | `project` via `services.projectId → deployments.serviceId` |
| `environment` | **read**, **readSecrets**, create, update, delete | `project` (env vars are project-scoped in deployment config) |
| `logs` | read, export | `project` via deployment chain |
| `template` | read, create, update, delete | `project` (variable templates) |
| `webhook` | read, create, update, delete | `project` via `webhooks.projectId` |
| `apiKey` | read, create, revoke | `project` via `apiKeys.projectId` |

> **`environment:read` vs `environment:readSecrets`** (Q&A #10): `read` allows seeing environment config names/structure only. `readSecrets` allows seeing the actual secret values. The engine checks the specific action, so a CI bot can be given `read` without exposing secrets.

---

## Resource Rule Format

### TypeScript types

```ts
/** Maximum filter nesting depth (Q&A #7 — prevents runaway evaluation) */
export const MAX_FILTER_DEPTH = 10;

export type ResourceEffect = "allow" | "deny";

export interface ResourceRule {
    /** Which resource type this rule applies to */
    resource: ProjectResource | "*";

    /** Which actions are allowed — array or "*" for all */
    actions: string[] | "*";

    /** How to determine WHICH specific resources are accessible */
    scope: ResourceScope;

    /**
     * Effect: allow (default) or deny.
     * Deny rules block access even if another rule allows it, when priority is equal or higher.
     * Q&A #5 — deny rules with priority system.
     */
    effect?: ResourceEffect;   // default: "allow"

    /**
     * Higher number = evaluated before lower-priority rules.
     * Deny with higher priority wins over Allow with lower priority.
     * Q&A #5.
     */
    priority?: number;         // default: 0
}

type ResourceScope =
    | { type: "all" }                          // All resources of this type in the org
    | { type: "cascade"; from: string }        // Inherit from parent resource access (unlimited depth — Q&A #3)
    | { type: "filter"; condition: DFilter }    // Directus-style JSON filter
    | { type: "ids"; values: string[] }         // Shorthand: specific resource IDs
    ;
```

### Directus-style filter format

```ts
interface DFilter {
    [field: string]: DFilterOperator | DFilter;
    _and?: DFilter[];
    _or?: DFilter[];
}

interface DFilterOperator {
    _eq?: string | number | boolean;
    _neq?: string | number | boolean;
    _in?: (string | number)[];
    _nin?: (string | number)[];
    _null?: boolean;
    _nnull?: boolean;
    _contains?: string;
    _icontains?: string;
    _starts_with?: string;
    _ends_with?: string;
    _gt?: number;
    _gte?: number;
    _lt?: number;
    _lte?: number;
    /**
     * Dynamic references resolved at evaluation time (Q&A #6).
     * $currentUser   → resolved to the calling user's ID
     * $currentOrg    → resolved to the current org's ID
     */
    _eq_var?: "$currentUser" | "$currentOrg";
    /**
     * $accessibleProjects  → resolved to the list of project IDs the user already has access to
     * $accessibleServices  → resolved to the list of service IDs the user already has access to
     * These are pre-computed by PermissionEngine before evaluating the rule, preventing circular resolution.
     * Q&A #6.
     */
    _in_var?: "$accessibleProjects" | "$accessibleServices";
}

/**
 * Relational dot-notation fields are supported (Q&A #4).
 * Example: { "services.project.name": { _icontains: "prod" } }
 * The engine resolves the path via RESOURCE_GRAPH FK chains before evaluation.
 */
// Note: key may be a dot-path; maximum nesting depth of the filter object = MAX_FILTER_DEPTH.
```

### Scope type breakdown

**`all`** — access every resource of this type in the org
```json
{ "resource": "project", "actions": "*", "scope": { "type": "all" } }
```
→ Can do anything on all projects in the org.

**`ids`** — access specific resources by ID
```json
{ "resource": "project", "actions": ["read", "update"], "scope": { "type": "ids", "values": ["proj-1", "proj-2"] } }
```
→ Can read and update project-1 and project-2 only.

**`cascade`** — inherit access from a parent resource
```json
{ "resource": "service", "actions": ["read", "create"], "scope": { "type": "cascade", "from": "project" } }
```
→ Can read/create services **in any project the user can access** (based on their project rules).

**`filter`** — Directus-style JSON condition
```json
{ "resource": "project", "actions": ["read"], "scope": { "type": "filter", "condition": { "name": { "_icontains": "frontend" } } } }
```
→ Can read any project whose name contains "frontend".

---

## Resource Graph (cascade resolution)

```
project (root)
  └─ service         (services.projectId → projects.id)
      ├─ deployment   (deployments.serviceId → services.id)
      └─ webhook      (webhooks.serviceId → services.id)
  └─ environment      (conceptually project-scoped via service)
  └─ logs             (via deployment chain)
  └─ template         (project-scoped)
  └─ apiKey           (apiKeys.projectId → projects.id)
  └─ webhook          (webhooks.projectId → projects.id, project-level hooks)
```

```ts
// Defined in packages/utils/auth/src/permissions/engine/resource-graph.ts
export const RESOURCE_GRAPH = {
    project: {
        parent: null,
        idField: "id",
    },
    service: {
        parent: { resource: "project", foreignKey: "projectId", table: "services" },
        idField: "id",
    },
    deployment: {
        parent: { resource: "service", foreignKey: "serviceId", table: "deployments" },
        grandparent: { resource: "project", path: "service.projectId" },
        idField: "id",
    },
    environment: {
        parent: { resource: "project", foreignKey: "projectId", table: "environments" },
        idField: "id",
    },
    logs: {
        parent: { resource: "deployment", foreignKey: "deploymentId", table: "deploymentLogs" },
        grandparent: { resource: "project", path: "deployment.service.projectId" },
        idField: "id",
    },
    template: {
        parent: { resource: "project", foreignKey: "projectId", table: "templates" },
        idField: "id",
    },
    webhook: {
        parent: { resource: "project", foreignKey: "projectId", table: "webhooks" },
        idField: "id",
    },
    apiKey: {
        parent: { resource: "project", foreignKey: "projectId", table: "apiKeys" },
        idField: "id",
    },
} as const;
```

### Cascade resolution algorithm

When evaluating `cascade:project` for a service:
1. Collect all `project` rules for this user/role
2. Resolve them to a set of accessible project IDs
3. Check if `service.projectId` is in that set

When evaluating `cascade:project` for a deployment (2-hop):
1. Same — resolve accessible project IDs
2. Join through: `deployment.serviceId → service.projectId`
3. Check if the deployment's service belongs to an accessible project

---

## Built-in Role Templates

Seeded when an org is created. Cannot be deleted. Org admins can create additional custom roles.

### `owner`
```json
{
    "orgPermissions": { "organization": ["create", "update", "delete"], "member": ["create", "update", "delete"], "team": ["create", "update", "delete"], "invitation": ["create", "cancel"], "ac": ["read", "create", "update", "delete"] },
    "resourceRules": [
        { "resource": "*", "actions": "*", "scope": { "type": "all" } }
    ]
}
```

### `admin`
```json
{
    "orgPermissions": { "organization": ["update"], "member": ["create", "update", "delete"], "team": ["create", "update", "delete"], "invitation": ["create", "cancel"], "ac": ["read"] },
    "resourceRules": [
        { "resource": "project", "actions": "*", "scope": { "type": "all" } },
        { "resource": "service", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "deployment", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "environment", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "logs", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "template", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "webhook", "actions": "*", "scope": { "type": "cascade", "from": "project" } },
        { "resource": "apiKey", "actions": "*", "scope": { "type": "cascade", "from": "project" } }
    ]
}
```

### `member`
```json
{
    "orgPermissions": {},
    "resourceRules": [
        { "resource": "project", "actions": ["read"], "scope": { "type": "all" } },
        { "resource": "service", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "deployment", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "logs", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } }
    ]
}
```

### Example custom role: `team-frontend`
```json
{
    "orgPermissions": { "member": ["read"] },
    "resourceRules": [
        { "resource": "project", "actions": ["read", "update"], "scope": { "type": "ids", "values": ["proj-frontend-1", "proj-frontend-2"] } },
        { "resource": "service", "actions": ["read", "create", "update"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "deployment", "actions": ["read", "create", "cancel", "rollback"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "environment", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "logs", "actions": ["read", "export"], "scope": { "type": "cascade", "from": "project" } }
    ]
}
```
→ This user can deploy to project-frontend-1 and project-frontend-2 only, read their services, cancel deploys, export logs — but cannot touch any other project.

### Example custom role: `ci-bot`
```json
{
    "orgPermissions": {},
    "resourceRules": [
        { "resource": "project", "actions": ["read"], "scope": { "type": "all" } },
        { "resource": "deployment", "actions": ["read", "create"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "logs", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } }
    ]
}
```
→ Automated CI user: can trigger deploys and read logs on any project, nothing else.

### Example: `contractor-readonly-prod`
```json
{
    "orgPermissions": {},
    "resourceRules": [
        { "resource": "project", "actions": ["read"], "scope": { "type": "filter", "condition": { "name": { "_icontains": "prod" } } } },
        { "resource": "service", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "deployment", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } },
        { "resource": "logs", "actions": ["read"], "scope": { "type": "cascade", "from": "project" } }
    ]
}
```
→ Read-only view of any project with "prod" in its name and all resources inside those projects.

---

## PermissionEngine — Evaluation

### Single-resource check

```
engine.check({ userId, orgId, resource, action, resourceId }) → boolean

  1. Platform bypass
     → if user.role === "superAdmin" → ALLOW immediately

  2. Get user's org memberships (Q&A #1 — user can have multiple roles)
     → memberships = findAllMemberships(userId, orgId)  // returns array
     → if memberships.length === 0 → DENY

  3. Load ALL org roles and merge their resourceRules (union merge)
     → allRules = flatMap(memberships, m => loadOrgRole(m.role, orgId).resourceRules)

  4. Find rules matching this resource + action
     → matchingRules = allRules.filter(r =>
         (r.resource === resource || r.resource === "*") &&
         (r.actions === "*" || r.actions.includes(action))
       )

  5. Sort by priority descending (Q&A #5 — deny rules with priority)
     → matchingRules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

  6. Evaluate each rule in priority order
     For each rule:
       a. Evaluate scope (see scope resolution below)
          ALLOW:  rule matches → effect === "deny" ? DENY : mark as ALLOWED
          DENY:   rule matches → immediately DENY (deny wins, no further evaluation)
     Rule does NOT match this resource instance → skip

  Scope resolution:
     if scope.type === "all"     → matches
     if scope.type === "ids"     → resourceId IN scope.values ? matches
     if scope.type === "cascade" → resolveParentAccess(userId, orgId, scope.from, resourceId)
     if scope.type === "filter"  → loadResource(resourceId), matchFilter(condition, record, ctx)

  7. Any ALLOW from step 6 and no DENY → ALLOW
     Otherwise → DENY
```

### Multi-role union merge (Q&A #1)

A user can belong to multiple org roles simultaneously (e.g., `team-frontend` and `ci-bot`). Rules from all roles are collected and evaluated together. **Any ALLOW from any role grants access** unless a DENY from any role (with equal or higher priority) blocks it.

```
  Role A rule: project:read scope:ids:[p1,p2] effect:allow priority:0
  Role B rule: project:read scope:filter:{name:"prod"} effect:allow priority:0
  → user can read any project with id p1 or p2 OR whose name contains "prod"

  Role A rule: deployment:create scope:cascade:project effect:allow priority:0
  Role C rule: deployment:create scope:filter:{env:{_eq:"production"}} effect:deny priority:10
  → user CAN create deployments in their projects, but CANNOT create a deployment to production env
    (priority 10 deny wins over priority 0 allow)
```

### Deny rule priority system (Q&A #5)

- Rules with `effect: "deny"` block access when the scope matches.
- Evaluation order: **highest `priority` first**.
- A deny rule with `priority: 10` beats an allow rule with `priority: 0`, even if the allow comes from a different role.
- Ties (same priority): **deny wins** (fail-safe default).
- If no rule matches at all: **DENY** (implicit default).

### List-resource query (converting rules to Drizzle WHERE)

For list operations (e.g., "give me all services I can read"), the engine converts rules to SQL conditions using **inline subqueries** (Q&A #9 — avoids fetching IDs into memory for large datasets):

```ts
engine.buildWhereClause(userId, orgId, resource, action) → Drizzle SQL condition

// Example: user has role "team-frontend" with:
//   project: read WHERE { type: "ids", values: ["proj-1", "proj-2"] }
//   service: read WHERE { type: "cascade", from: "project" }

// For listing services — generates inline subquery:
// WHERE services.projectId IN (
//   SELECT id FROM projects
//   WHERE id IN ('proj-1', 'proj-2')    ← ids scope, no extra join
// )

// For filter scope e.g. { name: { _icontains: 'prod' } }:
// WHERE services.projectId IN (
//   SELECT id FROM projects WHERE name ILIKE '%prod%'
// )
```

This means the list endpoint in the controller does:
```ts
const whereClause = await this.permissionEngine.buildWhereClause(userId, orgId, "service", "read");
const services = await db.select().from(servicesTable).where(whereClause);
```

All subqueries are generated by Drizzle — no raw SQL strings, no injection vectors.

### Filter-to-SQL compiler

The Directus filter is compiled to Drizzle conditions:

| Filter | Drizzle output |
|---|---|
| `{ name: { _eq: "x" } }` | `eq(t.name, "x")` |
| `{ name: { _in: ["a","b"] } }` | `inArray(t.name, ["a","b"])` |
| `{ name: { _icontains: "prod" } }` | `ilike(t.name, "%prod%")` |
| `{ id: { _in: ["uuid1"] } }` (from `ids` scope) | `inArray(t.id, ["uuid1"])` |
| `{ _or: [...] }` | `or(...)` |
| `{ _and: [...] }` | `and(...)` |

This compiler lives in `packages/utils/auth/src/permissions/engine/filter-compiler.ts`.

---

## Storage

### Where role data lives

```
organization_role table (Better Auth + custom column):
  ├─ id: text (PK)
  ├─ organization_id: text (FK → organization.id)
  ├─ name: text (role name, e.g. "team-frontend")
  ├─ permissions: jsonb  ← Better Auth format: { member: ["read"], team: ["read"] }
  │                        Used for org-level resources (organization, member, team, invitation, ac)
  │                        Evaluated by Better Auth's ac.check()
  ├─ resource_rules: jsonb  ← Our custom format: ResourceRule[]
  │                           Used for project-scoped resources (project, service, deployment, ...)
  │                           Evaluated by PermissionEngine
  ├─ is_default: boolean  ← true for seeded roles (owner, admin, member)
  ├─ created_at: timestamp
  └─ updated_at: timestamp
```

**Member assignment is unchanged**: `member.role` = the role name string from `organization_role.name`.

### What happens to `projectCollaborators`?

**Deleted.** No longer needed. Access is determined entirely by the user's org role and its resource rules.

If the org role says `project:read` with `ids: ["proj-1"]`, the user can see project-1. No need for a separate collaborator row.

### What happens to `projects.ownerId`?

**Removed** (Q&A #2). The `ownerId` column is dropped from the `projects` table. The creator of a project is assigned the build-in `owner` org role (if not already) or — if a more granular setup is desired — given an explicit resource rule granting `project:* scope:ids:[newProjectId]` under their org role.

This keeps access management fully in the role/rule system with no shortcuts that bypass the engine.

---

## Implementation: where code lives

### `packages/utils/auth/src/permissions/engine/`

New directory in the permissions package:

```
engine/
  permission-engine.ts      ← main PermissionEngine class
  resource-graph.ts          ← RESOURCE_GRAPH constant with FK chains
  filter-compiler.ts         ← Directus filter → Drizzle SQL compiler
  filter-matcher.ts          ← Directus filter → in-memory JS matcher (for single checks)
  rule-validator.ts          ← validate ResourceRule[] JSON schema
  types.ts                   ← ResourceRule, DFilter, ResourceScope types
  index.ts                   ← barrel export
```

### `packages/utils/auth/src/permissions/config.ts`

Changes:
- **Remove** `projectBuilder` entirely (and all project role exports)
- **Add** project-scoped resource declarations (just the resource+action list, no roles) as a standalone constant
- **Add** built-in role templates as `BUILTIN_ROLE_TEMPLATES`
- **Keep** `platformBuilder` and `organizationBuilder` exactly as-is (org builder still handles org-level resources)

### `packages/utils/auth/src/server/plugins/index.ts`

Change `useOrganization()`:
```ts
export function useOrganization(options = {}) {
    return organization({
        ac: organizationAc,      // org-level resources only
        dynamicAccessControl: {
            enabled: true,
            maximumRolesPerOrganization: 50,
        },
        teams: { enabled: true, allowRemovingAllTeams: true },
        ...options,
    });
}
```

### NestJS integration

```ts
// apps/api/src/core/modules/permissions/permission.module.ts
@Module({
    providers: [PermissionEngine],
    exports: [PermissionEngine],
})
export class PermissionModule {}

// Usage in service:
@Injectable()
export class ProjectService {
    constructor(private readonly permissionEngine: PermissionEngine) {}

    async getProject(projectId: string, userId: string, orgId: string) {
        await this.permissionEngine.assert(userId, orgId, "project", "read", projectId);
        return this.projectRepository.findById(projectId);
    }

    async listProjects(userId: string, orgId: string) {
        const where = await this.permissionEngine.buildWhereClause(userId, orgId, "project", "read");
        return this.projectRepository.findMany(where);
    }
}
```

---

## Phased implementation

### Phase A — Types + engine core (no DB changes)
1. Define types: `ResourceRule`, `DFilter`, `ResourceScope`
2. Define `RESOURCE_GRAPH` constant
3. Implement `FilterMatcher` (in-memory JS filter evaluation)
4. Implement `PermissionEngine.check()` with scope resolution
5. Unit tests for engine with mock roles
6. Implement `RuleValidator` (zod schema for validating resourceRules JSON)

### Phase B — Drizzle integration
7. Implement `FilterCompiler` (Directus filter → Drizzle WHERE)
8. Implement `PermissionEngine.buildWhereClause()`
9. Unit tests for SQL generation

### Phase C — Auth config changes
10. Enable `dynamicAccessControl` in `useOrganization()`
11. Run `auth-generate` → adds `organization_role` table to schema
12. Add `resource_rules` JSONB column if not from auth-generate
13. Seed default roles (owner, admin, member) with their resourceRules
14. Remove `projectBuilder` from config.ts
15. Remove `projectCollaborators` table from schema

### Phase D — NestJS integration
16. Create `PermissionModule` wrapping `PermissionEngine`
17. Refactor `project.service.ts` — replace `assertProjectAccess()` with `permissionEngine.assert()`
18. Refactor `service.service.ts` — add permission checks
19. Refactor `deployment.service.ts` — replace role checks with `permissionEngine.assert()`
20. Update list endpoints to use `buildWhereClause()`

### Phase E — Web + API for role management
21. Create org role management CRUD (uses Better Auth built-in endpoints + our resourceRules extension)
22. Role editor UI: visual rule builder for resourceRules
23. Pre-built template picker in role creation flow

---

## Comparison: previous design vs this design

| Dimension | Previous (3-layer) | This (2-layer + engine) |
|---|---|---|
| Layers | Platform + Org + Project | Platform + Org |
| Project access stored in | `project_permission_grants` table (24 bool cols) | Org role `resource_rules` JSON |
| Adding new resource/action | Schema migration | Add key to JSON + update engine types |
| Fine-grained scoping | Per-user per-project booleans | JSON filters (by ID, by name pattern, by condition) |
| Cascading | Manual (check org grants, then project grants) | Built-in: `cascade:project` = automatic |
| Evaluation steps | owner → org-grant → project-grant (3 lookups) | owner → role.resourceRules (1 lookup) |
| Admin UX | Set per-project grants for each user | Set ONE role, user gets access to matched projects |
| Custom roles | Fixed org roles + custom project templates | Fully custom org roles with resource rules |
| List queries | Manual filter per-table | Engine generates Drizzle WHERE from rules |

---

## Key invariants

1. `superAdmin` bypasses everything — never pass through the engine
2. `projects.ownerId` does not exist — the owner built-in role grants `*` access via resource rules
3. No permission check ever uses a role name string — always goes through the engine
4. Resource rules are validated by a Zod schema before being stored
5. Cascade resolution depth is **unlimited** (Q&A #3) — follows the full RESOURCE_GRAPH
6. Filter depth cap: **10 levels maximum** (Q&A #7 — enforced by rule-validator.ts)
7. The filter compiler only supports safe operators — no arbitrary SQL, no injection vectors
8. `organization_role.is_default = true` roles (owner, admin, member) cannot be deleted
9. A user with no org membership is always denied
10. Deny rules with higher priority beats allow; ties default to deny

---

## Q&A Log (Design decisions confirmed)

All questions answered during design phase. Recorded here for traceability.

| # | Question | Answer | Implication |
|---|---|---|---|
| 1 | Can a user have multiple roles in one org? | **Yes — union merge** | Engine collects ALL roles' rules, any ALLOW wins unless a DENY matches with ≥ priority |
| 2 | Should `projects.ownerId` still exist, or just use the owner role? | **Remove ownerId** | `projects` table has no `ownerId` column; creator is assigned `owner` built-in role |
| 3 | How deep can cascade resolution go? | **Unlimited** | Engine follows full RESOURCE_GRAPH FK chain without depth limit |
| 4 | Should cross-resource filter joins with dot-notation be supported? | **Yes, full relational dot-notation** | Filter keys like `services.project.name` are resolved via RESOURCE_GRAPH |
| 5 | Should deny rules exist, and how is conflict resolved? | **Yes, priority system** | Higher `priority` number wins; ties → deny wins |
| 6 | Should dynamic variable references be supported? | **Yes** + `$accessibleProjects` | `_eq_var`, `_in_var` resolved at eval time; `$accessibleProjects` pre-computed before cyclic rules |
| 7 | Maximum filter nesting depth? | **10 levels** | Enforced in `rule-validator.ts` at rule storage time; also in `filter-matcher.ts` at eval |
| 8 | Should role changes be audited? | **Yes, full audit log table** | New `role_change_audit` table (see Audit Log section below) |
| 9 | How should list queries be optimized? | **Inline subquery** | `buildWhereClause()` generates `WHERE id IN (SELECT ... FROM ...)` via Drizzle |
| 10 | Should `environment:read` and `environment:readSecrets` be separate actions? | **Yes** | `read` = see var names only; `readSecrets` = see actual values |

---

## Audit Log (Q&A #8)

Full audit trail for role changes. Stored in a dedicated table.

```ts
// apps/api/src/config/drizzle/schema/audit.ts
export const roleChangeAudit = pgTable("role_change_audit", {
    id: text().primaryKey().$defaultFn(() => createId()),
    organizationId: text().notNull().references(() => organization.id, { onDelete: "cascade" }),
    targetRoleId: text().notNull(),               // organization_role.id
    targetRoleName: text().notNull(),             // snapshot at time of change
    changedBy: text().notNull().references(() => user.id),
    changeType: text().$type<"create" | "update" | "delete" | "seed">().notNull(),
    previousRules: jsonb(),                        // ResourceRule[] before change
    newRules: jsonb(),                             // ResourceRule[] after change
    previousPermissions: jsonb(),                  // ac permissions before
    newPermissions: jsonb(),                       // ac permissions after
    reason: text(),                                // optional free-text
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

**Who logs what:**
- Creating a new org role → `create` audit entry
- Editing `orgPermissions` or `resourceRules` → `update` entry with `previousRules` diff
- Deleting a custom role → `delete` entry
- Seeding default roles on org creation → `seed` entries

**Retention**: up to the org admin. Default: keep forever. Future: configurable retention policy.

---

## Related files

| Concern | Path |
|---|---|
| Permission config | `packages/utils/auth/src/permissions/config.ts` |
| Permission engine (NEW) | `packages/utils/auth/src/permissions/engine/` |
| Server plugin wrappers | `packages/utils/auth/src/server/plugins/index.ts` |
| Auth schema | `apps/api/src/config/drizzle/schema/auth.ts` |
| Project schema | `apps/api/src/config/drizzle/schema/deployment.ts` |
| NestJS permission module (NEW) | `apps/api/src/core/modules/permissions/` |
| project.service.ts | `apps/api/src/modules/project/services/project.service.ts` |
| service.service.ts | `apps/api/src/modules/service/services/service.service.ts` |
| deployment.service.ts | `apps/api/src/modules/deployment/services/deployment.service.ts` |
