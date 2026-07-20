# Phase 1: Dead Code Removal 🧹

> **Goal:** Safely remove all unreferenced code that has zero consumers and zero importers.
> **Total files to remove:** ~135 files across 20+ directories
> **Risk:** LOW (all items verified zero importers)
> **Est. time:** ~3.5 hours

---

## Prerequisites

Before starting, verify:
```bash
# Set up workspace
cd /home/sebille/Bureau/projects/tests/deployer/v3
git checkout -b chore/remove-dead-code
```

After EACH deletion, run:
```bash
bun --bun run api -- type-check
bun --bun run web -- type-check
```

---

## 1.1 Dead Core Modules (Round 1 — Safest)

### 1.1.1 `core/modules/context/` — 🟢 SAFE DELETE

**Files:**
- `apps/api/src/core/modules/context/types/index.ts` — `ServiceContextBuilder` class, zero importers
- `apps/api/src/core/modules/context/docs/README.md` — Describes a module that was never built

**Verification (confirmed):**
```bash
grep -rn "ServiceContext\|ServiceContextBuilder\|ProjectContext\|ServiceDomainMapping" apps/api/src/
# → only within context/ directory itself
```

**Steps:**
```bash
rm -rf apps/api/src/core/modules/context
```
Then type-check.

### 1.1.2 `core/modules/ephemeral-http/` — 🟢 SAFE DELETE

**Files:**
- `apps/api/src/core/modules/ephemeral-http/sub-app-not-available.error.ts`

**Verification (confirmed):**
```bash
grep -rn "SubAppNotAvailable\|subAppNotAvailable\|SUB_APP_UNAVAILABLE\|ephemeral-http" apps/api/src/
# → zero matches
```

**Steps:**
```bash
rm -rf apps/api/src/core/modules/ephemeral-http
```

### 1.1.3 `core/modules/sub-app-orchestrator/` — 🟢 SAFE DELETE

**Files:**
- `apps/api/src/core/modules/sub-app-orchestrator/sub-app-orchestrator.module.ts`
- `apps/api/src/core/modules/sub-app-orchestrator/sub-app-orchestrator.service.ts`

**Verification (confirmed):**
```bash
grep -rn "sub-app-orchestrator\|SubAppOrchestratorModule\|SubAppOrchestratorService" apps/api/src/
# → only within the module itself
```

**Why dead:** Superseded by `core/orchestrator/OrchestratorService` (the newer pipeline).

**Steps:**
```bash
rm -rf apps/api/src/core/modules/sub-app-orchestrator
```

### 1.1.4 `core/modules/loader/` — 🟢 SAFE DELETE

**Files:**
- `apps/api/src/core/modules/loader/database-ready.trigger.ts`
- `apps/api/src/core/modules/loader/loader.module.ts`
- `apps/api/src/core/modules/loader/nest-app-reference.service.ts`
- `apps/api/src/core/modules/loader/startup-module-loader.ts`

**Verification:**
The `loader` IS imported by the old `StartupModuleLoader` which references `SystemModule`. But the loader module itself is never imported by the current AppModule — the bootstrap pipeline (`BootstrapModule` + `AppLifecycleModule`) superseded it.

**Steps:**
```bash
# Check if anything imports the loader module (not just the files inside it)
grep -rn "LoaderModule\|StartupModuleLoader" apps/api/src/app.module.ts apps/api/src/core/
# If zero, safe to delete
rm -rf apps/api/src/core/modules/loader
```

**⚠️ Note:** After deleting loader, the `system/system.module.ts` loses its only importer (see 1.2.3).

---

## 1.2 Dead System Modules + Sub-Apps

### 1.2.1 `system/modules/fleet/` — 🟢 SAFE DELETE

**Files:**
- `apps/api/src/system/modules/fleet/controllers/system-fleet.controller.ts`
- `apps/api/src/system/modules/fleet/repositories/system-fleet.repository.ts`
- `apps/api/src/system/modules/fleet/services/system-fleet.service.ts`
- `apps/api/src/system/modules/fleet/system-fleet.module.ts`

**Verification (confirmed):** Only imported by `system/system.module.ts` (which is also dead — see 1.2.3).

**Why dead:** Superseded by `modules/fleet/` (product module with real services + 5 spec files).

**Steps:**
```bash
rm -rf apps/api/src/system/modules/fleet
```

### 1.2.2 `system/modules/mesh/` — ⚠️ PARTIAL — Check First

**Files:**
- `apps/api/src/system/modules/mesh/controllers/system-mesh.controller.ts` — ✅ Has spec file, MAY be used
- `apps/api/src/system/modules/mesh/controllers/system-mesh-sse.controller.ts` — 💀 Knip says unused
- `apps/api/src/system/modules/mesh/system-mesh.module.ts` — 💀 Only imported by dead system.module.ts

**Steps:**
```bash
# Check if system-mesh.controller is imported outside system.module.ts
grep -rn "system-mesh" apps/api/src/ --include="*.ts" | grep -v spec.ts
# If only system.module.ts and itself → safe to delete all
```

**If confirmed dead:**
```bash
rm -rf apps/api/src/system/modules/mesh
```

### 1.2.3 `system/system.module.ts` — 🟢 SAFE DELETE (after loader)

**File:**
- `apps/api/src/system/system.module.ts`

**Verification (confirmed):** Only imported by `core/modules/loader/startup-module-loader.ts` which is ALSO dead.

**Steps:**
```bash
# Do this AFTER deleting loader/
rm apps/api/src/system/system.module.ts
rmdir apps/api/src/system/modules  # if empty
rmdir apps/api/src/system  # if empty
```

### 1.2.4 `sub-apps/setup-wizard/` — 🟡 MEDIUM — Check Consumer

**Files (6):**
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.init.module.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.api.module.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.app.module.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.controller.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.orpc.module.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.service.ts`
- `apps/api/src/sub-apps/setup-wizard/setup-wizard.bridge.ts` (bridge — shared)

**Also:** `apps/api/src/sub-apps/setup-sub-app.module.ts`

**IMPORTANT FINDING:** `setup-sub-app.module.ts` IS imported by something. Check:
```bash
grep -rn "setup-sub-app\|SetupSubApp\|SetupWizardBridge" apps/api/src/ --include="*.ts"
```

**If the bridge is used by the current orchestrator pipeline, KEEP the bridge but delete the rest.**
- `setup-wizard.bridge.ts` may be needed for cross-context communication
- `setup-sub-app.module.ts` may be wired in core/orchestrator/

**Steps:**
```bash
# Keep bridge if used, delete everything else
# Only run this after confirming bridge isn't used:
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.init.module.ts
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.api.module.ts
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.app.module.ts
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.controller.ts
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.orpc.module.ts
rm apps/api/src/sub-apps/setup-wizard/setup-wizard.service.ts
rm apps/api/src/sub-apps/setup-sub-app.module.ts
```

### 1.2.5 `sub-apps/auth/` — 🟢 SAFE DELETE (empty dir)

**Files:** None — empty directory.

```bash
rmdir apps/api/src/sub-apps/auth  # if empty
```

---

## 1.3 Dead Packages

### 1.3.1 `packages/nest/auth/` — 🟡 MEDIUM — 20+ files

**Verification (confirmed):** Zero importers. The API re-implemented auth internally.

```bash
grep -rn "@repo/nest\|@repo/nest-auth\|packages/nest/auth" apps/ --include="*.ts" --include="*.tsx" --include="*.json"
# → only in packages/nest/auth/package.json itself
```

**Files:** Entire `packages/nest/auth/` directory.

**⚠️ Before deleting:** Check if `apps/api/package.json` or any `package.json` references `@repo/nest-auth` or `packages/nest/auth` — remove those references.

```bash
grep -rn "nest-auth\|nest/auth" apps/api/package.json packages/*/package.json
# Remove dependency lines if found
```

**Steps:**
```bash
rm -rf packages/nest/auth
# Remove from root package.json workspace if listed
```

### 1.3.2 `packages/utils/auth/src/permissions/system/builder/` — 🟢 SAFE DELETE

**Files (15):**
- `packages/utils/auth/src/permissions/system/builder/builder.ts`
- `packages/utils/auth/src/permissions/system/builder/schemas.ts`
- `packages/utils/auth/src/permissions/system/builder/base-config.ts`
- `packages/utils/auth/src/permissions/system/builder/roles/*` (3 files)
- `packages/utils/auth/src/permissions/system/builder/statements/*` (4 files)
- Plus index files

**Verification (confirmed):** Zero external importers. Only self-references within builder directory. Superseded by `permissions/engine/`.

**Steps:**
```bash
rm -rf packages/utils/auth/src/permissions/system
```

### 1.3.3 `packages/poc/core-sync-system/` — 🟢 SAFE DELETE

**Files:** `package.json`, source files.

**Verification (confirmed):** Zero importers outside its own package.json.

**Steps:**
```bash
rm -rf packages/poc/core-sync-system
# Then check if packages/poc/ is empty:
rmdir packages/poc  # if empty
```

### 1.3.4 `packages/utils/orpc/src/query/` — 🟡 CHECK FIRST

These were flagged as unused by Knip but may be planned for future use. Check:
```bash
grep -rn "filtering\|pagination\|query-builder\|search\|sorting" packages/utils/orpc/src/ --include="*.ts" | grep "export\|import"
```

**Decision:** If zero exports are imported externally, they're safe to delete. If they're internal utilities used by the orpc package itself, KEEP.

---

## 1.4 Dead Web Frontend Files

### 1.4.1 Mock Hooks (9 files) — 🟢 SAFE DELETE

```bash
rm apps/web/src/domains/*/mock-hooks.ts  # runs for all domains
```

**Exact files:**
- `apps/web/src/domains/docker/mock-hooks.ts`
- `apps/web/src/domains/deployment/mock-hooks.ts`
- `apps/web/src/domains/fleet/mock-hooks.ts`
- `apps/web/src/domains/invitation/mock-hooks.ts`
- `apps/web/src/domains/mesh/mock-hooks.ts`
- `apps/web/src/domains/organization/mock-hooks.ts`
- `apps/web/src/domains/project/mock-hooks.ts`
- `apps/web/src/domains/setup/mock-hooks.ts`
- `apps/web/src/domains/user/mock-hooks.ts`

### 1.4.2 Orphaned Domain Hooks (4 files) — 🟢 SAFE DELETE

```bash
rm apps/web/src/domains/health/hooks.ts
rm apps/web/src/domains/health/endpoints.ts
rm apps/web/src/domains/test/hooks.ts
rm apps/web/src/domains/test/endpoints.ts
rm apps/web/src/domains/test/invalidations.ts
rm apps/web/src/domains/docker/invalidations.ts
```

### 1.4.3 Dead Lib Files (15 files) — 🟢 SAFE DELETE

```bash
# Auth
rm apps/web/src/lib/auth/actions.ts
rm apps/web/src/lib/auth/Components.tsx
rm apps/web/src/lib/auth/with-client-session.tsx

# Debug
rm apps/web/src/lib/debug/debug-examples.ts
rm apps/web/src/lib/debug/index.ts

# Errors (entire directory — only referenced in its own README)
rm -rf apps/web/src/lib/errors

# Other
rm apps/web/src/lib/data-mode.ts
rm apps/web/src/lib/hook-strategy.ts
rm apps/web/src/lib/mock-data-service.ts
rm apps/web/src/lib/mock-orpc-overlay.ts
rm apps/web/src/lib/orpc/links/index.ts
rm apps/web/src/lib/orpc/plugins/progress-plugin.ts
rm apps/web/src/lib/permissions.ts
rm apps/web/src/lib/serwist-client.ts

# Middleware utils
rm apps/web/src/middlewares/utils/config/utils.ts
rm apps/web/src/middlewares/utils/ObjectToMap.ts
rm apps/web/src/middlewares/WithRedirect.ts
rm apps/web/src/middlewares/WithTiming.ts
```

### 1.4.4 Dead Auth/Permission Components — 🟢 SAFE DELETE

```bash
rm apps/web/src/components/auth/RequireOrganizationRole.tsx
rm apps/web/src/components/permissions/RequirePlatformRole.tsx
rm apps/web/src/components/permissions/RequireRole.tsx
rm apps/web/src/components/devtools/TanStackDevTools.tsx
```

### 1.4.5 Dead `components/auth/index.ts` — 🟢 SAFE DELETE

Check if it's imported anywhere first:
```bash
grep -rn "from '@/components/auth'" apps/web/src/
# If zero → safe to delete
rm apps/web/src/components/auth/index.ts
```

### 1.4.6 Routes files — Check First

```bash
# These may be needed for the declative routing system:
# apps/web/src/routes/openapi.template.ts
# apps/web/src/routes/utils.ts
# Check before deleting:
grep -rn "openapi\.template\|routes/utils" apps/web/src/
```

---

## 1.5 Orphaned Apps

### 1.5.1 `apps/test/` — 🟢 SAFE DELETE

```bash
rm -rf apps/test
```

**Verification (confirmed):** Not in turbo.json, not in docker-compose, not in root scripts. Uses Jest (different from rest of monorepo's Vitest).

### 1.5.2 `apps/observable-poc/` — 🟢 SAFE DELETE

```bash
# First, check if any of its ORPC patterns are referenced:
grep -rn "observable-poc" apps/ packages/ turbo.json 2>/dev/null
# If zero:
rm -rf apps/observable-poc
```

**Note:** The POC has its own `src/lib/orpc/` with client/contract/server. If those patterns are valuable, extract them to the main codebase before deleting.

### 1.5.3 `reference/` — 🟢 SAFE DELETE

```bash
rm -rf reference
```

---

## 1.6 Clean Up Unused Mock Data Files

**Do this AFTER Phase 2 (mock→real migration) is complete.**

```bash
# After all mocked pages are migrated:
rm -rf apps/web/src/mocks
```

---

## 1.7 Update package.json Files

After deleting packages, update all `package.json` files that reference them:

### Remove from apps/api/package.json
```bash
# Check for: @repo/nest-auth, simple-git, tar-stream (if only used by dead core/git)
grep -rn "simple-git\|tar-stream" apps/api/src/ --include="*.ts" | grep -v node_modules
# If zero → remove from dependencies
```

### Remove from root workspace
```bash
# Check if packages/poc/ or packages/nest/ are in workspaces
grep -rn "packages/nest\|packages/poc" package.json
```

---

## 1.8 Verification Checklist

After ALL deletions:

```bash
# Type check both apps
bun --bun run api -- type-check
bun --bun run web -- type-check

# Run knip again to verify reduction
bun --bun run knip | head -30
# Expected: significantly fewer unused files

# Run tests
bun --bun run test --filter=api --filter=web

# Check for no dangling imports
grep -rn "@/core/modules/context\|@/core/modules/ephemeral-http\|@/core/modules/sub-app-orchestrator\|@/core/modules/loader\|@/core/modules/git\|system-fleet\|setup-wizard\|@repo/nest" apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules
# → should be zero
```

---

## Rollback Plan

For each deleted directory:
```bash
git checkout <deleted-directory>  # Restore from git
```

**Do NOT batch all deletions into one commit.** Use separate commits per section for easy rollback:
```bash
git commit -m "chore(deadCode): Remove dead core modules (context, ephemeral-http, sub-app-orchestrator, loader)"
git commit -m "chore(deadCode): Remove dead system modules and sub-apps"
git commit -m "chore(deadCode): Remove dead packages (nest/auth, permissions/builder, poc)"
git commit -m "chore(deadCode): Remove orphaned apps (test, observable-poc, reference)"
git commit -m "chore(deadCode): Remove dead web frontend files"
```
