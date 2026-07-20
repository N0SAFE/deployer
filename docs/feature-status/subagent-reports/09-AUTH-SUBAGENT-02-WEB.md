# Auth — Subagent 2/3: Web/Frontend Layer

## Auth Components
### ACTIVE (has external importers):
- `RequirePlatformRole.tsx` — 1 external importer (admin/organizations/new/page.tsx)
- `index.ts` — re-exports both components
### DEAD (no external importers):
- `RequireOrganizationRole.tsx` — only referenced in ARCHITECTURE.md, contains `as any` cast

## Permissions Components (DEAD)
- `RequireRole.tsx` — 0 external importers
- `RequirePlatformRole.tsx` — 0 external importers (duplicate of auth/RequirePlatformRole.tsx)
- Both should be deleted in Phase 1

## Auth Lib
### ACTIVE:
- `lib/auth/index.ts` — 10 external importers
- `lib/auth/options.ts` — imported by index.ts
- `lib/auth/cookie-session.ts` — 2 importers
### DEAD:
- `lib/auth/actions.ts` — 0 external importers
- `lib/auth/Components.tsx` — 0 external importers
- `lib/auth/with-client-session.tsx` — 0 external importers

## Auth Pages
- Sign-in: uses real Better Auth flow ✅
- Sign-up: uses real Better Auth flow ✅
- Auth error: working
- My profile: working, uses push-notifications hooks

## Session Management
- Better Auth with httpOnly cookies
- SessionHydrationProvider wraps session data
- Master token plugin for service-to-service

## Issues
- `RequireOrganizationRole.tsx` — only referenced in ARCHITECTURE.md docs, not in any real page
- 3 dead lib files (actions.ts, Components.tsx, with-client-session.tsx)
- 2 duplicate permission components in permissions/ directory
- `RequireOrganizationRole.tsx` contains `as any` cast

## Todo List (Web Layer Only)
1. [S] Delete dead `lib/auth/actions.ts` (0 importers)
2. [S] Delete dead `lib/auth/Components.tsx` (0 importers)
3. [S] Delete dead `lib/auth/with-client-session.tsx` (0 importers)
4. [S] Delete duplicate `components/permissions/RequireRole.tsx`
5. [S] Delete duplicate `components/permissions/RequirePlatformRole.tsx`
6. [M] Investigate `RequireOrganizationRole.tsx` — if truly unused, delete it + fix `as any`
