# Auth — Subagent 3/3: Packages/Contracts Layer

## packages/nest/auth (DEAD — 39 source files, 8 spec files)
- External importers: 0 (zero across entire monorepo)
- Same directory structure as internal `api/src/core/modules/auth/`
- Superseded by internal auth module
- **Verdict: DELETE** (entire packages/nest/auth/ directory)

## packages/utils/auth (ACTIVE — 74+ source files)
### Structure:
- `client/` — Auth client (master token plugin, invite client, use-session)
- `permissions/` — Full permission system
- `react/` — React session hooks (client + server)
- `server/` — Better Auth server factory
- `mesh/` — Mesh token verification
- `types.ts` — Core types

### External importers: 80+ matches across 62 files

### Permissions Builder (system/builder/)
- 7 source files + 7 spec files = 14 total
- External importers: 0 direct
- BUT: used internally by `permissions/config.ts` to build platform/organization permission configs
- **Verdict: KEEP** — active internal infrastructure despite 0 direct external imports

### Permissions Engine (engine/)
- 7 source files + 5 spec files = 12 total
- Provides: `PermissionEngine`, `ForbiddenError`, `ResourceRule`, filter compilation
- Exported via `@repo/auth/permissions`
- **Verdict: KEEP** — actively consumed by API permission services

## Auth Contracts (User module — 7 operations)
- list, findById, create, update, delete, checkEmail, count
- Tag: "User" Prefix: "/user"
- All implemented in apps/api/src/modules/user/

## Comparison: Internal vs Nest Auth
| Aspect | Internal (api/.../auth/) | Shared (packages/nest/auth/) |
|--------|------------------------|----------------------------|
| Structure | Identical subdirs | Identical subdirs |
| Importers | 69+ (all API controllers) | 0 |
| Status | ACTIVE | DEAD |
| Relationship | Replacement/evolution | Orphaned original |

## Todo List (Packages Layer Only)
1. [S] Delete packages/nest/auth/ (39 source + 8 spec files) — verify no package.json references
2. [S] Audit packages/utils/auth/package.json deps — verify @simplewebauthn, cookie, sonner are actually used
3. [S] Verify permissions engine exports reach consumers via @repo/auth/permissions
4. [S] Verify user contracts match user module implementation
5. [S] Update docs to mark nest/auth as deleted, internal auth as canonical
