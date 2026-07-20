# Phase 5: Final Quality Gates ✅

> **Goal:** Address remaining technical debt, improve test coverage, and set up CI guardrails.
> **Total items:** 5 major quality improvements
> **Est. time:** ~15 hours

---

## 5.1 Address 14 TODO/FIXME Items

### Priority Matrix

| Priority | Item | File | Effort |
|:--------:|------|------|:------:|
| 🔴 HIGH | TODO(T032): resolve actual serviceId from repository identifier | `github-webhook.controller.ts:84` | 2h |
| 🟡 MED | TODO: integrate with variable-resolver module (x2) | `project.service.ts:739,752` | 3h |
| 🟡 MED | TODO(ph2): replace with proper DI in ORPC middleware | `auth/orpc/middlewares.ts:33` | 2h |
| 🟡 MED | TODO Phase B.2: FK-chain subquery for permissions (x2) | `permission-engine.ts:226,368` | 4h |
| 🟢 LOW | TODO: consider adding projectId to variableTemplates | `project.repository.ts:573` | 30min |
| 🟢 LOW | TODO: join with services (x2) | `project.controller.ts:337,354` | 1h |
| 🟢 LOW | TODO: trigger actual health check | `project.controller.ts:367` | 30min |
| 🟢 LOW | TODO: Install @nestjs/schedule + uncomment @Cron (x2) | `domain-verification.service.ts:2,241` | 1h |
| 📋 PLAN | TODO: Queue retry job via orchestration module | `deployment.service.ts:822` | 2h |

### 5.1.1 Install `@nestjs/schedule` for Domain Auto-Verification

**Files:**
- `apps/api/src/core/modules/domain/services/domain-verification.service.ts`
- `apps/api/package.json`

```bash
bun --bun add @nestjs/schedule
```

Then uncomment the `@Cron` decorator and implement the cron job.

### 5.1.2 Create Variable Resolver Integration

**Files:** `apps/api/src/modules/project/services/project.service.ts`

The two TODOs reference integrating with a "variable-resolver module". Either:
- Create the module if planned
- Close the TODOs if the integration is no longer needed

### 5.1.3 Address GitHub Webhook TODO

**File:** `apps/api/src/modules/github/controllers/github-webhook.controller.ts:84`

```typescript
// TODO(T032): resolve actual serviceId from repository identifier once
```
Implement service resolution from GitHub repository metadata (org/repo → service).

### 5.1.4 Fix ORPC Middleware DI

**File:** `apps/api/src/core/modules/auth/orpc/middlewares.ts:33`

Replace the hardcoded auth context extraction with proper DI-injected service.

### 5.1.5 Implement FK-Chain Subquery

**File:** `packages/utils/auth/src/permissions/engine/permission-engine.ts`

Phase B.2: replace the conservative "allow all rows" fallback with actual FK-chain subqueries.

---

## 5.2 Add Frontend Tests

### Current Coverage

| Area | Test Files |
|------|:----------:|
| Web frontend | **10** files (setup + auth only) |
| API backend | 108 files |
| Packages/utils | 41 files |

### Test Migration Targets

After migrating pages from mock to real data in Phase 2, add tests:

**Priority 1 — Core pages (now real data):**
```bash
# Add tests for:
apps/web/src/app/dashboard/docker/containers/page.tsx  # Most complex page
apps/web/src/app/dashboard/docker/images/page.tsx
apps/web/src/app/dashboard/projects/page.tsx            # After migration
```

**Priority 2 — Recently migrated pages:**
```bash
# Add tests for each page migrated from mock to real
apps/web/src/app/dashboard/projects/[projectId]/page.tsx
apps/web/src/app/dashboard/deployments/page.tsx
apps/web/src/app/dashboard/services/page.tsx
```

**Test pattern for each:**
```typescript
// apps/web/src/app/dashboard/docker/containers/__tests__/page.spec.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock the domain hook
vi.mock('@/domains/docker/hooks', () => ({
  useDockerContainerList: vi.fn().mockReturnValue({
    data: mockContainers,
    isLoading: false,
    error: null,
  }),
}))

describe('Containers Page', () => {
  it('renders container list', () => {
    render(<ContainersPage />)
    expect(screen.getByText('Containers')).toBeDefined()
  })

  it('shows loading state', () => {
    // Override mock to return loading
    render(<ContainersPage />)
    expect(screen.getByTestId('loading-state')).toBeDefined()
  })

  it('shows error state', () => {
    // Override mock to return error
    render(<ContainersPage />)
    expect(screen.getByText(/error/i)).toBeDefined()
  })
})
```

---

## 5.3 Add Knip to CI Pipeline

### Current: Knip must be run manually

### Target: Knip runs on every PR

**File:** `.github/workflows/ci.yml` (create if doesn't exist)
```yaml
name: CI
on: [pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      
      - name: Install
        run: bun install
        
      - name: Knip dead code check
        run: bun --bun run knip
        
      - name: Type check
        run: |
          bun --bun run api -- type-check
          bun --bun run web -- type-check
          
      - name: Lint
        run: bun --bun run lint
        
      - name: Test
        run: bun --bun run test
```

### Local Pre-commit Hook

Install husky or a simple git hook:

```bash
# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
echo "🔍 Running knip dead code check..."
bun --bun run knip --no-exit-code

echo "🏗️ Type checking..."
bun --bun run api -- type-check && bun --bun run web -- type-check

echo "✅ Pre-commit checks passed!"
EOF
chmod +x .git/hooks/pre-commit
```

---

## 5.4 Dependency Cleanup

### Remove Production-Dead Dependencies

Knip `--production` flagged ~150 dependencies. After removing dead code, some will resolve automatically. The remaining false positives:

**Known false positives (KEEP):**
- `dockerode` — Used dynamically for Docker SDK
- `@nestjs/*` — NestJS framework deps (static analysis may miss them)
- `drizzle-orm`, `drizzle-kit` — ORM deps
- `@octokit/*` — GitHub integration
- `pg`, `better-sqlite3` — DB drivers
- `reflect-metadata`, `rxjs` — NestJS peer deps

**Likely real dead dependencies (REMOVE):**
- `@million/lint` from `apps/web` — Million.js compiler? Verify if used
- `@serwist/turbopack` — Service worker library? Verify if used
- `esbuild-wasm` — WASM bundler? Verify
- `exceljs` — Excel export? If not used on any page, remove
- `react-leaflet`, `react-leaflet-markercluster` — Maps library? If not used on any page, remove
- `web-push` from `apps/api` — If push module was implemented without it? Check
- `simple-git`, `tar-stream` from `apps/api` — Only used by dead `core/git/`
- `@scalar/nestjs-api-reference` — API reference UI? Check if used

```bash
# Verify each candidate
for dep in "@million/lint" "@serwist/turbopack" "esbuild-wasm" "exceljs" "react-leaflet" "react-leaflet-markercluster"; do
  echo "=== $dep ==="
  grep -rn "$dep" apps/web/src/ --include="*.ts" --include="*.tsx" | head -5
done
```

### Clean Up `@repo/type-guards` Over-Distribution

`@repo/type-guards` is in 13 package.json files but many packages don't use it. Verify and remove where unused:

```bash
for pkg in packages/configs/vitest packages/contracts/api packages/contracts/common packages/contracts/entities packages/types packages/utils/config-schema packages/utils/env packages/utils/logger packages/utils/provider-schema; do
  echo "=== $pkg ==="
  # Check if any source file imports it
  grep -rn "@repo/type-guards" "$pkg/src/" 2>/dev/null | head -3
done
```

If no imports found, remove the dependency line from that package's `package.json`.

---

## 5.5 Final Type-Check + Lint Pass

### Final Verification Script

```bash
#!/bin/bash
set -e

echo "=== PHASE 5: FINAL QUALITY GATES ==="
echo ""

# 1. Run Knip
echo "📊 Knip dead code analysis..."
bun --bun run knip 2>&1 | tail -20
echo ""

# 2. Type checks
echo "🏗️ API type check..."
bun --bun run api -- type-check
echo "✅ API type check passed"

echo "🏗️ Web type check..."
bun --bun run web -- type-check
echo "✅ Web type check passed"

echo "🏗️ Load balancer type check..."
bun --bun run load-balancer -- type-check
echo "✅ Load balancer type check passed"

# 3. Lint
echo "🧹 Linting..."
bun --bun run lint 2>&1 | tail -10
echo "✅ Lint passed"

# 4. Tests
echo "🧪 Running tests..."
bun --bun run test 2>&1 | tail -20
echo "✅ Tests passed"

# 5. Check banned patterns
echo "🔍 Auditing banned patterns..."
violations=0
for pattern in "as unknown as" "as any" "@ts-ignore" "@ts-expect-error"; do
  count=$(grep -rn "$pattern" apps/api/src/ apps/web/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v spec.ts | grep -v '.test.ts' | grep -v node_modules | wc -l)
  if [ "$count" -gt "0" ]; then
    echo "⚠️  Found $count '$pattern' violations"
    violations=$((violations + 1))
  else
    echo "✅ No '$pattern' violations"
  fi
done

# 6. Check mock data
mock_count=$(grep -rn "from '@/mocks" apps/web/src/ 2>/dev/null | grep -v node_modules | wc -l)
echo "📦 Mock data imports: $mock_count"
echo ""

if [ "$violations" -eq "0" ] && [ "$mock_count" -eq "0" ]; then
  echo "🎉 ALL QUALITY GATES PASSED!"
else
  echo "⚠️  Some issues remain — review above."
fi
```

### Pre-Commit Audit Command

```bash
# Quick check for the most common issues
echo "as unknown as:" && grep -rn "as unknown as" apps/api/src/ apps/web/src/ packages/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v spec.ts | grep -v '.test.ts' | wc -l
echo "as any:" && grep -rn "as any" apps/api/src/ apps/web/src/ packages/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v spec.ts | grep -v '.test.ts' | wc -l
echo "console.log:" && grep -rn "console\.\(log\|debug\)" apps/api/src/ apps/web/src/ --include="*.ts" 2>/dev/null | grep -v node_modules | grep -v spec.ts | grep -v debug-cli.ts | grep -v examples/ | wc -l
echo "process.env (non-config):" && grep -rn "process\.env\." apps/api/src/ --include="*.ts" 2>/dev/null | grep -v node_modules | grep -v config/ | grep -v spec.ts | grep -v e2e/ | wc -l
echo "mock imports:" && grep -rn "from '@/mocks" apps/web/src/ --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v node_modules | wc -l
```

---

## Rollback Plan

Each phase can be rolled back independently:

```bash
# Rollback specific phase
git revert <phase-commit-hash> --no-edit

# Rollback everything (if in single branch)
git checkout main
git branch -D chore/migration-plan
```
