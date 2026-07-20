# ❌ Not Working / Stub / Dead Features

> Features that exist in code but are not functional — either intentionally dead, superseded, or never completed.

---

## 1. 💀 Dead Core Modules (Superseded)

### 1.1 State Machine (💀 DEAD — 4 files)

**Location:** `apps/api/src/core/modules/state-machine/`
**Files:** `base-state-machine.service.ts`, `index.ts`, `state-machine.builder.ts`, `state-machine.module.ts`
**Knip Status:** Unused
**Why Dead:** Superseded by the deployment-specific state machine in `modules/deployment/`
**Action:** Safe to archive/delete

### 1.2 Sub-App Orchestrator (💀 DEAD — 2 files)

**Location:** `apps/api/src/core/modules/sub-app-orchestrator/`
**Files:** `sub-app-orchestrator.module.ts`, `sub-app-orchestrator.service.ts`
**Knip Status:** Unused
**Why Dead:** Superseded by the newer orchestrator pipeline in `core/orchestrator/`
**Action:** Safe to archive/delete

### 1.3 Sub-App Runner (💀 DEAD — 3 files)

**Location:** `apps/api/src/core/modules/sub-app-runner/`
**Files:** `sub-app-result.store.ts`, `sub-app-runner.module.ts`, `sub-app.constants.ts`
**Knip Status:** Unused
**Why Dead:** Superseded by newer architecture
**Action:** Safe to archive/delete

### 1.4 Loader (💀 DEAD — 3 files)

**Location:** `apps/api/src/core/modules/loader/`
**Files:** `database-ready.trigger.ts`, `loader.module.ts`, `nest-app-reference.service.ts`, `startup-module-loader.ts`
**Knip Status:** Unused
**Why Dead:** Superseded by bootstrap/lifecycle modules
**Action:** Safe to archive/delete

### 1.5 Gateway (💀 DEAD — 3 files)

**Location:** `apps/api/src/core/gateway/`
**Files:** `gateway.module.ts`, `gateway.ts`, `index.ts`
**Knip Status:** Unused — contains `as any` usage
**Why Dead:** Superseded by the main gateway in `main.ts` + orchestrator
**Action:** Safe to archive/delete

---

## 2. 💀 Dead System Modules

### 2.1 System Fleet (💀 DEAD — 4 files)

**Location:** `apps/api/src/system/modules/fleet/`
**Files:** `controllers/system-fleet.controller.ts`, `repositories/system-fleet.repository.ts`, `services/system-fleet.service.ts`, `system-fleet.module.ts`
**Knip Status:** Unused — ALL files
**Why Dead:** Superseded by `apps/api/src/modules/fleet/` (the product-facing fleet module)
**Action:** Safe to delete — the product fleet module has services + 5 spec files

### 2.2 System Mesh (⚠️ PARTIAL — partially dead)

**Location:** `apps/api/src/system/modules/mesh/`
**Status:**
- `system-mesh.module.ts` — 💀 DEAD (unused)
- `system-mesh.controller.ts` — ✅ Has spec file, may be used
- `system-mesh-sse.controller.ts` — 💀 DEAD (unused)
**Note:** Mesh functionality is primarily implemented via `apps/api/src/core/modules/mesh/` and `packages/contracts/api/modules/mesh/`

### 2.3 System Root Module (💀 DEAD)

**File:** `apps/api/src/system/system.module.ts`
**Knip Status:** Unused
**Action:** Safe to delete

---

## 3. 💀 Dead Sub-Apps

### 3.1 Setup Wizard Sub-App (💀 DEAD — 6 files)

**Location:** `apps/api/src/sub-apps/setup-wizard/`
**Files:**
- `setup-wizard.init.module.ts`
- `setup-wizard.api.module.ts`
- `setup-wizard.app.module.ts`
- `setup-wizard.controller.ts` (uses `as any` 2x)
- `setup-wizard.orpc.module.ts`
- `setup-wizard.service.ts` (accesses `process.env` directly 8 times)
- Plus `apps/api/src/sub-apps/setup-sub-app.module.ts`

**Knip Status:** Unused — ALL files
**Why Dead:** Superseded by `apps/api/src/modules/setup/` (the product-facing setup module)
**Action:** Safe to delete

### 3.2 Auth Sub-App (💀 DEAD — empty)

**Location:** `apps/api/src/sub-apps/auth/`
**Files:** Empty directory — no TypeScript files
**Why Dead:** Auth is handled by `core/modules/auth/` and Better Auth
**Action:** Remove empty directory

### 3.3 Mesh Initializer Sub-App (✅ WORKING — NOT dead)

**Location:** `apps/api/src/sub-apps/mesh-initializer/`
**Files:** `mesh-initializer.app.module.ts`, `mesh-initializer.bridge.ts`, `mesh-initializer.service.ts`
**Status:** ✅ Used and wired in the orchestrator pipeline

---

## 4. 💀 Dead Packages

### 4.1 packages/nest/auth/ (💀 DEAD — 20+ files)

**Location:** `packages/nest/auth/`
**Files:** Entire package marked unused by Knip

| File | Status |
|------|--------|
| `auth.module.ts` | 💀 DEAD — unused, the API has its own internal AuthModule |
| `decorators/decorators.ts` | 💀 DEAD — marked `@deprecated` internally |
| `guards/auth.guard.ts` | 💀 DEAD |
| `guards/role.guard.ts` | 💀 DEAD |
| `filters/api-error-exception-filter.ts` | 💀 DEAD |
| `orpc/interceptors.ts`, `middlewares.ts`, `plugins/*`, `types.ts` | 💀 DEAD |
| `services/auth-core.service.ts`, `auth.service.ts` | 💀 DEAD |
| `plugin-utils/*` (6 files) | 💀 DEAD |
| `utils/*` (2 files) | 💀 DEAD |

**Why Dead:** The API (`apps/api`) re-implemented auth internally in `core/modules/auth/`. The shared `@repo/auth` (at `packages/utils/auth/`) IS still used — but the NestJS-specific wrapper (`packages/nest/auth/`) is orphaned.

### 4.2 packages/utils/auth/src/permissions/ (💀 DEAD — 15+ files)

**Location:** `packages/utils/auth/src/permissions/system/builder/`
**Files:** Roles config, statements config, schemas, base-config — ALL unused
**Why Dead:** Superseded by the new permissions engine at `packages/utils/auth/src/permissions/engine/`
**Action:** Safe to remove the `system/builder/` subtree

### 4.3 packages/poc/core-sync-system/ (💀 DEAD)

**Location:** `packages/poc/core-sync-system/`
**Status:** No consumers, not imported anywhere
**Action:** Archive or delete

### 4.4 packages/configs/prettier/ (⚠️ PARTIAL)

**Files:** `packages/configs/prettier/src/base.ts`, `tailwind.ts`
**Knip Status:** Unused — root `prettier.config.ts` is used instead
**Action:** Either wire them or remove

---

## 5. 💀 Dead Web Frontend Files

### 5.1 Orphaned Domain Hooks (💀 DEAD — 6 files)

| Domain | File | Reason |
|--------|------|--------|
| health | `hooks.ts` + `endpoints.ts` | No page imports them |
| test | `hooks.ts` + `endpoints.ts` + `invalidations.ts` | No page imports them |
| docker | `invalidations.ts` | Unused |
| setup | `invalidations.ts` | Empty `export {}` |

### 5.2 Unused Auth Components (💀 DEAD — 2 files)

| File | Issue |
|------|-------|
| `components/auth/RequireOrganizationRole.tsx` | Contains `as any`, only referenced in ARCHITECTURE.md |
| `components/permissions/RequirePlatformRole.tsx` | Duplicates `components/auth/RequirePlatformRole.tsx` |

### 5.3 Mock Hooks (💀 DEAD — 9 files)

All files matching `apps/web/src/domains/*/mock-hooks.ts` are unused:
- docker, deployment, fleet, invitation, mesh, organization, project, setup, user

### 5.4 Unused Lib Files (💀 DEAD — 15+ files)

| File | Issue |
|------|-------|
| `lib/auth/actions.ts` | Unused |
| `lib/auth/Components.tsx` | Unused, uses `as any` |
| `lib/auth/with-client-session.tsx` | Unused |
| `lib/data-mode.ts` | Unused |
| `lib/debug/*` (2 files) | Unused |
| `lib/errors/*` (4 files: admin, base, index, organization, user) | Unused |
| `lib/hook-strategy.ts` | Unused |
| `lib/mock-data-service.ts` | Unused |
| `lib/mock-orpc-overlay.ts` | Unused |
| `lib/orpc/links/index.ts` | Unused barrel |
| `lib/orpc/plugins/progress-plugin.ts` | Unused |
| `lib/permissions.ts` | Unused (superseded by `lib/permissions.ts` in proper location?) |
| `lib/serwist-client.ts` | Unused Serwist service worker |
| `middlewares/utils/*` (2 files) | Unused |
| `middlewares/WithRedirect.ts` | Unused |
| `middlewares/WithTiming.ts` | Unused |

### 5.5 Unused Lib Errors (💀 DEAD — 6 files)

`apps/web/src/lib/errors/` — entire directory unused:
- `base.ts`, `user.ts`, `organization.ts`, `admin.ts`, `index.ts`

---

## 6. ❌ Not Working — Infrastructure Gaps

### 6.1 Context Module (❌ NOT WORKING)

**Location:** `apps/api/src/core/modules/context/`
**Status:** No module file found (`ls: no matches found: *.module.ts`). The directory exists with potential content but is not wired.

### 6.2 Ephemeral HTTP Module (❌ NOT WORKING)

**Location:** `apps/api/src/core/modules/ephemeral-http/`
**Status:** No module file. Contains `sub-app-not-available.error.ts` but is not wired.

### 6.3 Git Module (❌ NOT WORKING)

**Location:** `apps/api/src/core/modules/git/`
**Status:** No module file found. Contains `github/services/github.service.ts` but is not wired as a NestJS module.

### 6.4 Triggers Module (❌ NOT WORKING)

**Location:** `apps/api/src/core/modules/triggers/`
**Status:** No module file found. Contains `base-bridge.service.ts` (uses `as any`) but is not wired.

---

## 7. ❌ Not Working — Architectural Gaps

### 7.1 GitHub Module — No ORPC Contract

**Location:** `apps/api/src/modules/github/`
**What exists:** `GithubWebhookController` (raw `@Controller`, not ORPC), `GithubWebhookDispatchService`, `WebhookIdempotencyService`
**What's missing:** **No ORPC contract** — this is the ONLY product module without one. It uses a raw NestJS `@Post()` controller.
**TODO:** `github-webhook.controller.ts:84` — resolve actual serviceId from repository identifier
**Risk:** Webhook handling works for receiving but there's no typed client contract

### 7.2 Permission Module — No HTTP Exposure

**Location:** `apps/api/src/modules/permission/`
**Status:** Has `PermissionService` + `PermissionRepository` but no controller. This is intentional — it's an internal module used by other services, not exposed via HTTP.

### 7.3 Web: Direct `fetch()` Calls Bypassing ORPC (4 files)

| File | URL | Fix Needed |
|------|-----|------------|
| `domains/mesh/connect-flow.ts:28` | `fetch(\`${serverUrl}/api/server/ping\`)` | Use ORPC contract |
| `domains/mesh/connect-flow.ts:119` | `fetch(\`${serverUrl}/api/auth/get-session\`)` | Use ORPC contract |
| `components/setup/steps/progress-step.tsx:176` | `fetch("/api/auth/sign-in/email")` | Use ORPC contract |
| `components/setup/steps/complete-step.tsx:32` | `fetch("/api/auth/sign-in/email")` | Use ORPC contract |

### 7.4 Web: Hardcoded `href` Bypassing Declarative Routing (2 files)

| File | Code |
|------|------|
| `components/dashboard/DashboardSidebar.tsx:215` | `<Link href="/dashboard/projects">` |
| `components/permissions/RequirePlatformRole.tsx:36` | `href="/dashboard/admin"` (in JSDoc example) |

---

## 8. 📋 Planned / Blocked Features

### 8.1 Domain Verification via Cron (TODO)

**File:** `apps/api/src/core/modules/domain/services/domain-verification.service.ts`
**Blocked by:** `@nestjs/schedule` not installed
**Code status:**
```typescript
// TODO: Install @nestjs/schedule to enable cron-based auto-verification
// TODO: Uncomment @Cron decorator when @nestjs/schedule is installed
```

### 8.2 Variable Resolver Module (TODO)

**File:** `apps/api/src/modules/project/services/project.service.ts:739,752`
**Status:** Two TODOs to integrate with variable-resolver module

### 8.3 FK-Chain Subquery for Permissions (TODO)

**File:** `packages/utils/auth/src/permissions/engine/permission-engine.ts:226,368`
**Status:** Phase B.2 — currently conservatively allows all rows for cross-FK scenarios

### 8.4 ORPC Middleware DI (TODO)

**File:** `apps/api/src/core/modules/auth/orpc/middlewares.ts:33`
**Status:** TODO(ph2): replace with proper DI once the middleware pattern supports it

---

## 9. 🚩 Type Safety Violations (Technical Debt)

**Banned patterns found in production code** (per `.github/copilot-instructions.md`):

| Pattern | Count | Heaviest Files |
|---------|:-----:|----------------|
| `as unknown as` | 80+ | `helpers.ts` (10), `use-docker-live.ts` (6), `docker.repository.ts` (5), `docker-entity-domain.service.ts` (4) |
| `as any` | 35+ | `data-table.tsx` (6), `DashboardSidebar.tsx` (2), `setup-wizard.controller.ts` (2) |
| `@ts-ignore` / `@ts-expect-error` | 1 mention | `encrypted-text.ts` (comment only) |
| `console.log()` (bypasses logger) | 40+ | `test-deployment-mesh.example.ts` (25+), `debug-cli.ts` (12) |
| `process.env` scattered (not in EnvService) | 30+ | `setup-wizard.service.ts` (8), `main.ts` (3), various modules |

---

## 10. 🗺️ Orphaned Apps

### 10.1 apps/test/ (💀 DEAD)

**Framework:** NestJS with **Jest** (not Vitest like the rest of monorepo)
**Commands:** Uses bare `nest build` without `bun --bun`
**Integration:** Not in any docker-compose file, not in turbo.json pipeline
**Status:** 5 source files, minimal functionality

### 10.2 apps/observable-poc/ (💀 DEAD)

**Framework:** Next.js standalone
**Integration:** Not in docker-compose, not in turbo.json pipeline
**Code:** Has its own ORPC client/contract/server (`src/lib/orpc/`) duplicating what's in `packages/contracts/`
**Status:** Standalone POC not connected to anything

### 10.3 reference/ directory (💀 DEAD)

**Files:** 20+ files of standalone reference/setup-form components
**Integration:** Not imported or referenced by any code
**Status:** Historic reference only
