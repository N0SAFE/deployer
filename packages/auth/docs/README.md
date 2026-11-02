# `@deployer/auth` — what is where

One package, one authorization model, and adapters that turn it into what each consumer needs.

| Area | Subpath | Answers | Runtime |
|---|---|---|---|
| **authz** | `@deployer/auth/authz` | "May this actor do X, in this scope?" — the permission catalog, the pure decision, role ranks, and the builder that turns the catalog into a statement + role maps | none (no Effect, no Nest, no React) |
| **adapters/better-auth** | `@deployer/auth/adapters/better-auth` | "How does Better Auth see it?" — `createAccessControl`, `Role` objects, role-name schemas, `hasPermission`/`PermissionChecker`, the plugin layer | pure |
| **rules** | `@deployer/auth/rules` | "Which ROWS may this actor see?" — `role_rules.resource_rules` compiled to SQL filters | pure |
| **server** | `@deployer/auth/server` | The `betterAuth(...)` instance: providers, plugins, hooks, session policy, the audit hook | Node |
| **client** | `@deployer/auth/client` | The browser auth client and its plugins | browser |
| **react** | `@deployer/auth/react` | `<RequirePermission>`, `usePermissions`, session helpers | React |
| **mesh** | `@deployer/auth/mesh` | Tokens between nodes | Node |
| **audit** | `@deployer/auth/audit` | The audit event schema, sink port and request→event mapping | pure |

## The direction is one-way

```
authz/catalog            the vocabulary (permission -> risk/description)
authz/platform           roles + resources, built with the builder into a statement and role maps
        │
        ▼
adapters/better-auth     createAccessControl(statement) + newRole(role) + schemas
        │
        ▼
better-auth admin plugin / server / middleware
```

Nothing in `adapters/` declares a permission or a role. If a role existed only there, it would be a second policy — the
thing this package used to have.

## The catalog and the builder: related, not the same thing

The **catalog** (`authz/catalog.ts`) is a typed `<permission, { risk, description }>` map plus bundles and system roles.
It carries meaning a Better Auth statement cannot hold: risk drives guardrail defaults, audit level and the role
editor's warning, and a permission that belongs to no bundle fails the tests. It is the source of truth for *what may
be done*.

The **builder** (`authz/builder/`) is a small DSL that turns a declaration into the three artifacts a transport needs:
a statement (`{ resource: actions[] }`), role → permissions maps, and role metadata/schemas. It used to call
`createAccessControl` itself; it no longer does, so it can live in `authz` without dragging Better Auth into the web
bundle. The Better Auth conversion is `adapters/better-auth/config.ts` — `createAccessControl(statement)` and one
`newRole(...)` per role.

Could the catalog be written *with* the builder? Only partly, and it would lose information: the builder models actions
and role grants, not per-permission risk/description, bundles, rank or scope. So the catalog stays the declaration, and
the builder derives the transport view from it. The remaining reconciliation is the one old overlap: the Better Auth
admin plugin needs its own `user`/`session` actions (`list`, `ban`, `set-role`, …) while the catalog names product
capabilities (`user:read`, `user:set-role`, …). They are declared in `authz/platform.ts` and asserted against
`adminDefaultStatements` in a test; moving them onto catalog capabilities is the next step (it changes which roles hold
`user:ban`, so it is a policy change, not a rename).

## The names that look similar (and are not)

| Name | Where | Means |
|---|---|---|
| `Permission` | `authz/catalog` | The **union of capability strings** (`"service:deploy"`). A typo is a compile error. |
| `Permission` | `authz/builder/types` | Better Auth's **statement map** (`{ project: ["read"] }`). Used by the admin plugin and `userHasPermission`. |
| `PlatformRole` | `authz/platform` | `"superAdmin" \| "admin" \| "operator" \| "viewer" \| "user"` — the stored platform role. |
| `RoleDefinition` | `authz/roles` | A role as DATA (name, scope, rank, permissions), so roles can move to a table without touching call sites. |
| `ResourceRule` | `rules/types` | One row-level rule inside `role_rules` (resource + condition). |

## Adding a permission

1. Add it to `authz/catalog.ts` (`PERMISSIONS`) with its risk.
2. Put it in the bundle(s) that should grant it, and in `SYSTEM_ROLES` if the built-in roles get it.
3. Declare it on the procedure: `.access({ permission: "thing:do", scope: { kind: "project" } })`.
4. If the row-level layer needs it, add the resource to `rules/resource-graph.ts`.

Nothing in a handler compares role names: only `authz` (rank/hierarchy) and the audit/viewer read roles for display.

## Adding a Better Auth plugin

Register server **and** client in the same change (`src/server/auth.ts`, `src/client/auth-client.ts`): a one-sided plugin
leaves an endpoint nothing can call, or a client method that does not exist.

## Layout

```
src/
  authz/                 catalog.ts  evaluate.ts  roles.ts  hierarchy.ts  types.ts
                         platform.ts (declaration)   builder/ (the DSL)
  adapters/better-auth/  config.ts (conversion)  checks.ts  plugins/
  rules/                 types.ts  filter-compiler.ts  filter-matcher.ts  permission-engine.ts
                         resource-graph.ts  rule-validator.ts
  server/                auth.ts  plugins/  provision-user.ts  origins.ts  secrets.ts
  client/                auth-client.ts  use-session.ts  plugins/
  react/                 RequirePermission.tsx  usePermissions.ts  session/
  mesh/  audit/
```
