# Auth — Complete Analysis (Subagents 1-3 combined)

## API Internal Auth (ACTIVE)
- Location: `apps/api/src/core/modules/auth/`
- 38 source files, 8 spec files
- Key: AuthModule, AuthCoreService, AuthService, AuthGuard, RoleGuard
- ORPC middleware integration
- 8 spec files

## packages/nest/auth (DEAD — 39 files)
- **Zero external importers** ✅ verified
- Superseded by internal `api/src/core/modules/auth/`
- 39 files including 8 spec → DELETE

## packages/utils/auth (ACTIVE)
- 75 files, 15 spec files
- Permissions Engine (ACTIVE): 12 files, 6 specs → KEEP
- Permissions Builder (DEAD): 16 files, 5 specs → DELETE
- Builder only used internally by config.ts, not by any external code

## Web Auth Components
- ACTIVE (3): RequirePlatformRole, RequireOrganizationRole, index.ts → KEEP
- DEAD (2): permissions/RequireRole.tsx, permissions/RequirePlatformRole.tsx → DELETE

## Web Auth Lib
- ACTIVE (3): index.ts, options.ts, cookie-session.ts → KEEP
- DEAD (3): actions.ts, Components.tsx, with-client-session.tsx → DELETE

## Auth Consolidation Summary
| Area | Status | Action |
|------|--------|--------|
| api/src/core/modules/auth/ (38 files) | ✅ ACTIVE | KEEP |
| packages/nest/auth/ (39 files) | 💀 DEAD | DELETE |
| packages/utils/auth/engine/ (12 files) | ✅ ACTIVE | KEEP |
| packages/utils/auth/builder/ (16 files) | 💀 DEAD | DELETE |
| web/components/auth/ (3 files) | ✅ ACTIVE | KEEP |
| web/components/permissions/ (2 files) | 💀 DEAD | DELETE |
| web/lib/auth/ (3 files) | 💀 DEAD | DELETE |

## Action Items
1. [M] Delete packages/nest/auth/ (39 files — verify zero importers)
2. [M] Delete permissions builder (16 files — packages/utils/auth/.../builder)
3. [S] Delete 3 dead web lib files (actions.ts, Components.tsx, with-client-session.tsx)
4. [S] Delete 2 duplicate permissions components (RequireRole.tsx, RequirePlatformRole.tsx)
5. [M] Check load-balancer auth module — does it use packages/nest/auth or its own?
