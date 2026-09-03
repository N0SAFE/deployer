# Service Creation — Complete Feature Roadmap

## Current State (Just Built)

| Capability | Status |
|---|---|
| Multi-step wizard UI | ✅ Built |
| TanStack Form + Zod discriminated unions | ✅ Built |
| emblor tag input | ✅ Installed |
| Validates on submit, calls API | ✅ Working |
| Auth secret as `<Select>` with options | ✅ Static list |
| Runner-specific extra fields | ✅ 6 runner types |
| Health check type selector | ✅ HTTP/TCP/Command/None |

---

## What's Missing — Tier 1 (Foundations for Dynamic Forms)

### 1. Provider Account Linking (OAuth / Token Management)

**Problem**: When a user selects "GitHub" as provider, the form shows a URL input. But the real UX is: *select which GitHub account → browse repos → pick one*. There's no account linking system.

**What needs to be built**:

```
┌─────────────────────────────────────────────┐
│  Source provider:  [GitHub ▼]                │
│                                               │
│  Connected accounts:                          │
│  ┌─────────────────────────────────────────┐ │
│  │ [✓] @sebille (github.com)               │ │
│  │ [⚡] @org-account (github.com)           │ │
│  │ [ + Add GitHub account ]                │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  Selected account: @sebille                   │
│  Repository:  [my-service ▼]                 │
│  Branch:      [main ▼]                       │
└─────────────────────────────────────────────┘
```

**Required pieces**:

| Piece | Description | Depends on |
|---|---|---|
| Provider account schema | `providerAccountSchema` — id, provider, accountName, token (encrypted), avatar, expiresAt | Nothing |
| OAuth flow (GitHub first) | `GET /auth/github` → GitHub OAuth → callback → store token | Provider account schema |
| Provider accounts API | CRUD for linked accounts — `listProviderAccounts`, `deleteProviderAccount` | OAuth flow |
| Repository browser API | `GET /providers/:id/repos` — list repos accessible by linked account | Provider accounts |
| Repo → runtime detection | `POST /providers/:id/detect` — analyze repo content → suggest builder type | Repo browser |
| Branch browser API | `GET /providers/:id/repos/:repo/branches` | Repo browser |

### 2. Secret Management (Real `authSecretRef`/`secretRefs`)

**Problem**: `authSecretRef: "default"` is hardcoded. `secretRefs: ["db-password"]` is free text. Neither actually resolves to a real secret.

**Required pieces**:

| Piece | Description | Depends on |
|---|---|---|
| Secret schema | `projectSecretSchema` — id, projectId, name, type, encryptedValue, createdAt, rotatedAt | Nothing |
| Secrets CRUD API | `listSecrets`, `createSecret`, `updateSecret`, `deleteSecret` | Secret schema |
| Secret picker component | Form field that lists project secrets + "Create new" option | Secrets CRUD |
| Encryption layer | Server-side encryption before storing secret values | Nothing |
| Secret reference resolution | Service deployment resolves `authSecretRef` → actual secret value | Secrets CRUD |

### 3. Environment Management Integration

**Problem**: The wizard has no environment selector. Environments exist (production, preview, development) but aren't wired into the creation flow.

**Required pieces**:

| Piece | Description | Depends on |
|---|---|---|
| Environment selector step | New wizard step showing project environments | Existing environment contracts |
| Environment config override | Per-service overrides per environment | `service-overrides.schema.ts` exists |
| Environment-aware defaults | Auto-populate env-specific config (e.g., staging → fewer replicas) | Environment selector |

---

## What's Missing — Tier 2 (After Foundations)

### 4. Domain Selection Integration

**Problem**: `customDomains` is a free text field. Domains should be selectable from registered org/project domains.

**Required pieces**:

| Piece | Description | Depends on |
|---|---|---|
| Domain selector component | Lists project domains + availability check | Existing domain contracts (17+ endpoints ready) |
| Subdomain auto-generation | Auto-suggest `{service-name}.{project-domain}` on name entry | Domain selector |
| DNS status indicator | Shows verification status per domain | Domain `verifyOrganizationDomain` endpoint exists |

### 5. Runner Auto-Detection

**Problem**: User must manually select the runner type. The system should auto-detect based on the repository content.

**Required pieces**:

| Piece | Description | Depends on |
|---|---|---|
| Repo analysis service | Clone/fetch repo → check for Dockerfile, package.json, Dockerfile, nixpacks config, static files | Provider account linking |
| Runner suggestion UI | Show detected type + allow override | Repo analysis |
| Config pre-fill | Auto-fill runner config defaults based on detected type | Repo analysis |

### 6. Resource Templates

**Problem**: Resource limits (memory/cpu) are manual selects. Common patterns should be templated.

| Piece | Description | Depends on |
|---|---|---|
| Resource template schema | `resourceTemplateSchema` — preset name, memory, cpu, storage | Nothing |
| Resource template picker | Select "Small (256m/0.5)" / "Medium (1g/1)" / "Large (4g/4)" / Custom | Resource template schema |

---

## Wizard Step Map (Future)

```
Step 1: Basic Info           ✓ (name, type, description, tags)
Step 2: Source Provider      ─→ becomes: account selection → repo browser → branch picker
Step 3: Runner               ─→ becomes: auto-detected + pre-filled runner config
Step 4: Environment          ✗ NEW: environment selector + environment-scoped overrides
Step 5: Net & Health         ✓ (port, health check, domains → from registered list)
Step 6: Secrets              ✗ NEW: secret picker for authSecretRef + secretRefs
Step 7: Resources            ✗ NEW: resource template picker + custom override
Step 8: Review               ✓
```

---

## Implementation Order

```
Phase 1 (Next) ─── Provider Account Linking
  M1: Provider account schema + CRUD API
  M2: GitHub OAuth flow (login with GitHub)
  M3: Repository browser API
  M4: Branch browser API
  M5: Repo → runner detection API
  M6: Wire into wizard Step 2 (repo picker instead of URL input)

Phase 2 ─── Secret Management
  M7: Secret schema + CRUD API
  M8: Encryption layer
  M9: Secret picker UI component
  M10: Wire into wizard Step 6 (auth secret + secret refs pickers)

Phase 3 ─── Environment + Domain
  M11: Environment selector step in wizard
  M12: Domain selector component (wraps existing domain API)
  M13: Wire customDomains to domain picker instead of text input

Phase 4 ─── Templates + Polish
  M14: Resource templates schema + picker
  M15: Runner auto-detection wired into wizard Step 3
  M16: Wizard UX polish (stepper animations, mobile, keyboard nav)
```

---

## Key Files to Create/Modify

| File | Purpose | Phase |
|---|---|---|
| `packages/contracts/entities/src/entities/provider/account.schema.ts` | Provider account entity | P1 |
| `packages/contracts/api/modules/provider/accounts/` | Provider account CRUD contracts | P1 |
| `apps/api/src/modules/provider/oauth/` | GitHub OAuth controller + service | P1 |
| `apps/api/src/modules/provider/repos/` | Repository + branch browser API | P1 |
| `apps/api/src/modules/provider/detect/` | Repo → runner detection | P1 |
| `packages/contracts/entities/src/entities/project/secret.schema.ts` | Secret entity | P2 |
| `packages/contracts/api/modules/secret/` | Secret CRUD contracts | P2 |
| `apps/api/src/modules/secret/` | Secret service with encryption | P2 |
| `packages/ui/base/src/components/shadcn/secret-picker.tsx` | Secret selector UI | P2 |
| `packages/ui/base/src/components/shadcn/domain-picker.tsx` | Domain selector UI | P3 |
| `apps/web/src/domains/provider/hooks.ts` | Provider account hooks | P1 |
| `apps/web/src/domains/secret/hooks.ts` | Secret hooks | P2 |
