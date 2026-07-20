# Phase 4: Architecture Cleanup 🏗️

> **Goal:** Fix structural gaps, consolidate duplicate patterns, and improve overall architecture.
> **Total items:** 6 major architectural improvements
> **Risk:** MEDIUM-HIGH
> **Est. time:** ~20 hours

---

## 4.1 Create GitHub ORPC Contract

**Current problem:** `apps/api/src/modules/github/` is the ONLY product module without an ORPC contract. It uses a raw NestJS `@Controller` + `@Post()` endpoint.

### GitHub Controller Analysis

Current controller at `apps/api/src/modules/github/controllers/github-webhook.controller.ts`:

```typescript
@Controller("webhooks/github")
export class GithubWebhookController {
    @Post()
    async receive(
        @Headers("x-github-event") eventType: string,
        @Headers("x-github-delivery") deliveryId: string,
        @Headers("x-hub-signature-256") signature: string | undefined,
        @Body() rawBody: unknown,
    ): Promise<{ received: true; deliveryId: string; action?: string; reason?: string }>
```

### Migration Steps

**Step 1: Create the contract**

File: `packages/contracts/api/modules/github/webhook.ts`
```typescript
import { standard } from "@repo/orpc-utils"
import { z } from "zod"

const githubWebhookResponseSchema = z.object({
  received: z.literal(true),
  deliveryId: z.string(),
  action: z.string().optional(),
  reason: z.string().optional(),
})

export const githubWebhookContract = standard
  .zod(githubWebhookResponseSchema, "githubWebhook")
  .create()  // POST
  .path("/webhook")
  .input((b) => b.body(z.unknown()))  // Raw body from GitHub
  .output((b) => b.body(githubWebhookResponseSchema))
  .build()
```

File: `packages/contracts/api/modules/github/index.ts`
```typescript
import { oc } from "@orpc/contract"
import { githubWebhookContract } from "./webhook"

export const githubContract = oc
  .tag("GitHub")
  .prefix("/github")
  .router({
    webhook: githubWebhookContract,
  })
```

**Step 2: Register in master contract**

File: `packages/contracts/api/index.ts`
```typescript
import { githubContract } from "./modules/github"

export const appContract = oc.router({
    // ... existing contracts ...
    github: githubContract,
})
```

**Step 3: Implement the ORPC handler**

File: `apps/api/src/modules/github/controllers/github-webhook.controller.ts`
```typescript
// Convert from:
@Controller("webhooks/github")
@Post()
// To:
@Implement(appContract.github.webhook)
handler() { ... }
```

**Step 4: Handle the header-based auth**

GitHub uses `x-hub-signature-256` header for HMAC verification. This needs ORPC middleware:
```typescript
// Create a middleware that reads the header
const githubWebhookAuth = oc.middleware((context, next) => {
  const signature = context.request.headers.get('x-hub-signature-256')
  // Verify HMAC...
  return next(context)
})
```

---

## 4.2 Replace Direct `fetch()` Calls with ORPC (4 files)

### 4.2.1 Mesh Connect Flow (2 calls)

**File:** `apps/web/src/domains/mesh/connect-flow.ts`

**Current:**
```typescript
const pingResponse = await fetch(`${serverUrl}/api/server/ping`, { ... })
const response = await fetch(`${serverUrl}/api/auth/get-session`, { ... })
```

**Replace with:**
```typescript
import { meshEndpoints } from '@/domains/mesh/endpoints'

// Use ORPC client for cross-server calls
const pingResult = await meshEndpoints.ping(meshClientOptions)
// For auth session:
const sessionResult = await meshEndpoints.getSession(meshClientOptions)
```

**Check if contracts exist:**
- `mesh.ping` — ✅ EXISTS in `packages/contracts/api/modules/mesh/`
- `mesh.getSession` — ❓ May need a direct ORPC call or use Better Auth's session

### 4.2.2 Setup Wizard Sign-In (2 calls)

**Files:**
- `apps/web/src/components/setup/steps/progress-step.tsx` (line ~176)
- `apps/web/src/components/setup/steps/complete-step.tsx` (line ~32)

**Current:**
```typescript
const res = await fetch("/api/auth/sign-in/email", { ... })
```

**Replace with:**
```typescript
// Use the Better Auth client directly
import { authClient } from '@/lib/auth'
const { data } = await authClient.signIn.email({ email, password })
```

**Note:** Auth endpoints are handled by Better Auth (not ORPC), so this should use the auth client, not ORPC contracts.

---

## 4.3 Fix Hardcoded `href` → Declarative Routing (2 files)

### 4.3.1 Dashboard Sidebar

**File:** `apps/web/src/components/dashboard/DashboardSidebar.tsx` (line ~215)

**Current:**
```tsx
<Link href="/dashboard/projects">
```

**Replace with:**
```tsx
import { AuthDashboardProjects } from '@/routes'
<AuthDashboardProjects.Link>
```

**First verify the route exists:**
```bash
grep -rn "AuthDashboardProjects\|dashboard/projects" apps/web/src/routes/index.ts | head -5
```

### 4.3.2 RequirePlatformRole JSDoc

**File:** `apps/web/src/components/permissions/RequirePlatformRole.tsx` (line ~36)

This is a JSDoc example — already in the DELETE list from Phase 1. If deleted, no change needed.

---

## 4.4 Consolidate Auth Layers

**Current problem:** Three auth implementations exist:
1. `packages/nest/auth/` — Shared NestJS module (20+ DEAD files)
2. `apps/api/src/core/modules/auth/` — API's internal auth (ACTIVE)
3. `packages/utils/auth/` — Auth utilities (ACTIVE, different purpose)

### Migration Steps

**Step 1: `packages/nest/auth/` → DELETE** (Phase 1 already covers this)

**Step 2: Extract shared auth patterns**

If `apps/api/src/core/modules/auth/` contains patterns useful for other apps (like the load balancer):
```bash
# Check if load-balancer/auth uses any of the shared patterns:
diff -r apps/api/src/core/modules/auth/ apps/load-balancer/src/core/modules/auth/
```

If so, extract to `packages/utils/auth/`:
- Auth guards/middleware base classes → move to `packages/utils/auth/src/nest/`
- Permission engine (already in `packages/utils/auth/`) → verify it's complete

**Step 3: Clean up dual decorator definitions**

```bash
# Check if there's duplication:
grep -rn "AllowAnonymous\|OptionalAuth" apps/api/src/core/modules/auth/
grep -rn "AllowAnonymous\|OptionalAuth" packages/nest/auth/
# If both define the same decorators, remove the dead copy
```

---

## 4.5 Resolve 16 Duplicate Exports

Knip reported 16 duplicate export names. Find and fix:

```bash
# Get the full list:
bun --bun run knip --include duplicate-exports 2>&1 | grep duplicate
```

**Common patterns to fix:**
```typescript
// Duplicate: same name exported from multiple barrel files
// Fix: remove one export or rename to be unique

// Duplicate: schema re-exported from both entity and api contracts
// Fix: import from entities package only, don't re-export
```

**Target files:**
- `packages/contracts/entities/src/entities/` — project schemas, docker schemas
- `packages/contracts/api/modules/` — contract definitions

**Steps for each duplicate:**
1. Identify which export should be the canonical one
2. Remove the duplicate
3. Update all importers to use the canonical location
4. Run type-check

---

## 4.6 Load Balancer Alignment

**Current:** The load balancer is properly integrated (docker-compose, turbo pipeline, tests). But check:

```bash
# Does load-balancer use the shared auth from packages/nest/auth or its own?
grep -rn "AuthModule\|auth" apps/load-balancer/src/core/modules/auth/
```

If it uses `packages/nest/auth/` (which is being deleted), migrate it to use the API's internal auth or create a minimal auth module.

---

## Verification

```bash
# After ALL architecture changes:
bun --bun run api -- type-check
bun --bun run web -- type-check
bun --bun run load-balancer -- type-check

# Verify no direct fetch() calls remain (except auth):
grep -rn "fetch(.*\/api\|fetch(.*\/v1" apps/web/src/ | grep -v node_modules | grep -v spec.ts | grep -v auth
# → should be zero

# Verify no hardcoded href:
grep -rn 'href="/' apps/web/src/ | grep -v node_modules | grep -v layout.tsx | grep -v routes/index
# → should be zero (or only icons/manifest)
```
