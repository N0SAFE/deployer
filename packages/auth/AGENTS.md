# AGENTS.md — Auth Package Guide

This package provides shared authentication configuration for Better Auth across the monorepo.

## Structure

- `src/server/` - Server-side auth factory, plugins, and permissions
- `src/client/` - Client-side auth factory and plugins
- `src/types.ts` - Shared types and interfaces

## Key Exports

### Server (`@repo/auth/server`)
- `betterAuthFactory` - Factory function to create Better Auth instance
- Server plugins: `masterTokenPlugin`, `loginAsPlugin`, `pushNotificationsPlugin`, `useInvite`, `useAdmin`, plus Better Auth's built-ins `openAPI` and `multiSession`
- Permissions: `useAdmin`, permission config (`useOrganization` is **not** implemented — see `apps/doc/content/docs/dev/better-auth-plugin-evaluation.mdx` §4.1)

### Client (`@repo/auth/client`)
- `createAuthClientFactory` - Factory to create Better Auth client with plugins
- Client plugins: `masterTokenClient`, `loginAsClientPlugin`, `useInviteClient`, `useAdminClient`, plus Better Auth's `multiSessionClient`
- Guards: `hasMasterTokenPlugin`

### Types
- `IEnvService` - Interface for environment service (to be implemented by API)

## Usage

See main README for usage examples in API and Web apps.

## Rules

- **Plugins are paired.** A server plugin without its client plugin (or the reverse) leaves either an endpoint nothing can call or a client method that does not exist. Register both in the same change: `src/server/auth.ts` for server, `src/client/auth-client.ts` for client.
- **`multiSession` is cookie-only.** It adds one signed `{prefix}.session_token_multi-<token>` cookie per retained account (max 5). No DB table, no migration — never add an auth-table write for it.
- **Never swap identity client-side.** `multiSession.setActive` rewrites the primary session cookie *and* the cookie cache server-side via `setSessionCookie`. Consumers must re-read identity (reload or refetch) rather than patch user-scoped state in place.
- **Sign-out is browser-wide.** The `multiSession` after-hook on `/sign-out` expires every `_multi-` cookie and deletes those sessions. Per-account removal is `multiSession.revoke`.
- **`inferAdditionalFields<AuthInstance>()` must stay last** in the client plugin tuple, and the tuple must stay concrete — an un-annotated `const x = []` widens to `any[]` and silently erases all plugin typing.

## Related docs

- [Multi-Session — Several Accounts Per Browser](/docs/dev/multi-session-accounts)
- [Auth Access Control with Better Auth](/docs/dev/auth-access-control)
