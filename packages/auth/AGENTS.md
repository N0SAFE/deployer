# AGENTS.md — Auth Package Guide

Shared authentication and authorization for the whole monorepo. Start with `docs/README.md`: it maps every area to the
question it answers. This file is the rule list.

## Areas (and the one-line rule for each)

| Area | Path | Rule |
|---|---|---|
| `authz` | `src/authz/` | The permission VOCABULARY, the pure decision, and the declaration (`platform.ts`) + builder (`builder/`) that turn it into a statement and role maps. Dependency-free on purpose (no Better Auth, no Effect, no Nest, no React): the web app imports it. |
| `adapters/better-auth` | `src/adapters/better-auth/` | CONVERTS the authz model into what Better Auth needs (`createAccessControl`, `newRole`, role schemas) plus the role helpers (`checks.ts`) and the plugin layer. It never declares a permission or a role. |
| `rules` | `src/rules/` | Row-level `ResourceRule`s compiled to SQL filters. Pure; no database handle. |
| `server` | `src/server/` | The `betterAuth(...)` instance: providers, plugins, hooks, session policy, audit. Node only. |
| `client` | `src/client/` | Browser auth client + plugins. |
| `react` | `src/react/` | `<RequirePermission>`, `usePermissions`, session helpers. |
| `mesh` | `src/mesh/` | Tokens between nodes. |
| `audit` | `src/audit/` | Audit event schema, `AuthAuditSink`, request→event mapping. |

## Rules

- **One direction.** `authz` declares; `adapters/better-auth` converts. A role or permission that exists only in the
  adapter would be a second policy — do not add one there.
- **Two `Permission` types exist and must not be confused.** `authz/catalog` exports the capability UNION
  (`"service:deploy"`), which is what a check must use — a typo fails the build. `authz/builder/types` exports Better
  Auth's statement MAP (`{ project: ["read"] }`), which only the admin plugin and `userHasPermission` understand. The
  package root exports the union; import the map explicitly where Better Auth needs it.
- **The builder is not the catalog.** The catalog carries risk/description/bundles; the builder emits the transport
  view (statement, role maps, schemas). The catalog stays the declaration.
- **Never compare role names in a handler.** Checks ask for a permission; only the hierarchy (rank) and the audit/UI
  read a role name, and both read it from `SYSTEM_ROLES_TABLE` (`authz/roles`).
- **Roles are data.** `RoleDefinition`/`RoleTable` is the shape a `roles` table projects onto; `permissionsInRoles` and
  `rankInRoles` are the only readers, so replacing the seed with rows changes one argument.
- **Plugins are paired.** A server plugin without its client plugin (or the reverse) leaves either an endpoint nothing
  can call or a client method that does not exist. Register both in the same change: `src/server/auth.ts` for server,
  `src/client/auth-client.ts` for client.
- **`multiSession` is cookie-only.** It adds one signed `{prefix}.session_token_multi-<token>` cookie per retained
  account (max 5). No DB table, no migration — never add an auth-table write for it.
- **Never swap identity client-side.** `multiSession.setActive` rewrites the primary session cookie *and* the cookie
  cache server-side via `setSessionCookie`. Consumers must re-read identity (reload or refetch) rather than patch
  user-scoped state in place.
- **Sign-out is browser-wide.** The `multiSession` after-hook on `/sign-out` expires every `_multi-` cookie and deletes
  those sessions. Per-account removal is `multiSession.revoke`.
- **The user columns are a plugin, not `user.additionalFields`.** `deployerUserSchemaPlugin` declares `role`, `banned`,
  `banReason`, `banExpires` and `impersonatedBy`; the client's `deployerUserSchemaClient` points at it through
  `$InferServerPlugin`, which is what types them on the client's session. The tuple must stay concrete — an un-annotated
  `const x = []` widens to `any[]` and silently erases all plugin typing.
- **`fields` needs `as const`.** Without it `required: false` / `input: false` widen to `boolean`, and Better Auth's
  `InferFieldsInputClient` reads every nullable column as a REQUIRED field of `signUp.email`'s input type.
- **`Session` (the root type) comes from the CLIENT.** Better Auth's server `$Infer` merges `additionalFields` but not a
  plugin's `schema`, so `ReturnType<typeof createAuthClientFactory>['$Infer']['Session']` is the only derivation that
  carries the plugin columns.
- **Self-imports are relative.** Inside this package use `./x`/`../x`; `@deployer/auth/...` resolves through `dist`, so
  a source edit would not type-check until after a build (and a renamed folder would not resolve at all).
- **The audit hook never fails a request.** `AuthAuditSink.record` is fire-and-forget; the sink reports its own errors.

## Key exports

### Server (`@deployer/auth/server`)
- `betterAuthFactory(db, env, { audit? })` — the instance; the third argument is the only opt-in.
- Server plugins: `deployerUserSchemaPlugin`, `masterTokenPlugin`, `loginAsPlugin`, `pushNotificationsPlugin`,
  `useInvite`, plus Better Auth's built-ins `openAPI` and `multiSession`. (`useOrganization` is **not** implemented — see
  `apps/doc/content/docs/dev/better-auth-plugin-evaluation.mdx` §4.1. The Better Auth `admin` plugin is **removed**:
  user administration is the identity service's oRPC procedures.)

### Client (`@deployer/auth/client`)
- `createAuthClientFactory`, plugins `deployerUserSchemaClient`, `masterTokenClient`, `loginAsClientPlugin`,
  `useInviteClient`, guard `hasMasterTokenPlugin`.

### Root
- Types `Session`, `User`, `Auth`, `InferSessionFromAuth`, `IEnvService`; `authz`'s catalog and decision; the Better Auth
  AC surface; the row-rule engine (`ForbiddenError`, `PermissionEngine`, …).

## Related docs

- `docs/README.md` — the area map and how the pieces fit.
- [Multi-Session — Several Accounts Per Browser](/docs/dev/multi-session-accounts)
