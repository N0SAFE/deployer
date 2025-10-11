# Quickstart Guide: Domain Management System

**Feature**: 001-domain-management-system  
**Target Audience**: Developers implementing this feature  
**Prerequisites**: Familiarity with NestJS, Drizzle ORM, ORPC, Next.js

---

## Overview

This guide walks you through implementing the domain management system from scratch, following the implementation plan and architecture patterns.

---

## Phase 1: Database Setup

### Step 1: Update Drizzle Schema

**File**: `apps/api/src/config/drizzle/schema/domain.ts`

1. Add `OrganizationSettings` table (new)
2. Add columns to `organizationDomains` (retry tracking)
3. Add columns to `serviceDomainMappings` (routing config)

```bash
# Copy schema definitions from data-model.md
# Add to apps/api/src/config/drizzle/schema/domain.ts
```

### Step 2: Generate Migration

```bash
# Generate migration SQL (can run on host)
bun run api -- db:generate
```

### Step 3: Apply Migration

```bash
# Apply migration (MUST run in container)
bun run api -- db:push   # Development
bun run api -- db:migrate  # Production
```

### Step 4: Verify Schema

```bash
# Open Drizzle Studio to verify tables
bun run api -- db:studio
```

**Checklist**:
- ✅ `organization_settings` table created
- ✅ `organization_domains` has `retry_attempts`, `last_verification_attempt`, `next_retry_at` columns
- ✅ `service_domain_mappings` has `internal_path`, `internal_port`, `strip_path_enabled`, `protocol_config` columns
- ✅ All indexes created

---

## Phase 2: ORPC Contracts

### Step 1: Create Contract Files

**Location**: `packages/api-contracts/domain/`

```bash
mkdir -p packages/api-contracts/domain
touch packages/api-contracts/domain/organization-domain.contract.ts
touch packages/api-contracts/domain/project-domain.contract.ts
touch packages/api-contracts/domain/service-domain-mapping.contract.ts
touch packages/api-contracts/domain/organization-settings.contract.ts
touch packages/api-contracts/domain/index.ts
```

### Step 2: Implement Contracts

Copy contract definitions from `/contracts/` documentation:
1. `organization-domain.contract.ts` - Organization-level domain management
2. `project-domain.contract.ts` - Project-level domain assignment
3. `service-domain-mapping.contract.ts` - Service routing configuration
4. `organization-settings.contract.ts` - Quota and limit management

### Step 3: Export Contracts

**File**: `packages/api-contracts/domain/index.ts`

```typescript
export * from './organization-domain.contract';
export * from './project-domain.contract';
export * from './service-domain-mapping.contract';
export * from './organization-settings.contract';
```

### Step 4: Add to Main Contracts Index

**File**: `packages/api-contracts/index.ts`

```typescript
import { organizationDomainContract } from './domain/organization-domain.contract';
import { projectDomainContract } from './domain/project-domain.contract';
import { serviceDomainMappingContract } from './domain/service-domain-mapping.contract';
import { organizationSettingsContract } from './domain/organization-settings.contract';

export const contract = {
  // ... existing contracts
  domain: {
    organizationDomain: organizationDomainContract,
    projectDomain: projectDomainContract,
    serviceDomainMapping: serviceDomainMappingContract,
    organizationSettings: organizationSettingsContract,
  },
};
```

---

## Phase 3: Backend Implementation

### Step 1: Create Feature Module

```bash
mkdir -p apps/api/src/modules/domain/{adapters,controllers,guards,interfaces,processors,repositories,services}
touch apps/api/src/modules/domain/domain.module.ts
```

### Step 2: Implement in Order (CRITICAL)

**Order matters** - follow the architecture pattern:

1. **Interfaces** (types and interfaces) - `interfaces/*.types.ts`
2. **Repositories** (database access) - `repositories/*.repository.ts`
3. **Services** (business logic) - `services/*.service.ts`
4. **Adapters** (entity → contract transformation) - `adapters/*.adapter.service.ts`
5. **Guards** (RBAC enforcement) - `guards/domain-role.guard.ts`
6. **Processors** (background jobs) - `processors/dns-verification.processor.ts`
7. **Controllers** (HTTP endpoints) - `controllers/*.controller.ts`

### Step 3: Register Module

**File**: `apps/api/src/app.module.ts`

```typescript
import { DomainModule } from './modules/domain/domain.module';

@Module({
  imports: [
    // ... existing modules
    DomainModule,
  ],
})
export class AppModule {}
```

---

## Phase 4: Frontend Implementation

### Step 1: Generate ORPC Types

```bash
# Generate React Query hooks from contracts
bun run web -- generate
```

### Step 2: Create Routes

**Location**: `apps/web/src/app/(app)/organization/domains/`

```bash
mkdir -p apps/web/src/app/\(app\)/organization/domains/_components
touch apps/web/src/app/\(app\)/organization/domains/page.tsx
touch apps/web/src/app/\(app\)/organization/domains/page.info.ts
```

### Step 3: Build Routes

```bash
# Generate declarative routes
bun run web -- dr:build
```

### Step 4: Create Components

**Location**: `apps/web/src/components/domain/`

```bash
mkdir -p apps/web/src/components/domain
# Create domain-specific components
```

### Step 5: Create Custom Hooks

**Location**: `apps/web/src/hooks/`

```bash
# Create hooks for ORPC integration
touch apps/web/src/hooks/useDomains.ts
touch apps/web/src/hooks/useProjectDomains.ts
touch apps/web/src/hooks/useServiceMappings.ts
```

---

## Phase 5: Testing

### Step 1: Unit Tests (Backend)

**Test adapters first** (no dependencies):
```bash
apps/api/src/modules/domain/adapters/__tests__/domain-adapter.service.spec.ts
```

**Then services**:
```bash
apps/api/src/modules/domain/services/__tests__/domain-verification.service.spec.ts
```

**Then controllers**:
```bash
apps/api/src/modules/domain/controllers/__tests__/organization-domain.controller.spec.ts
```

### Step 2: Integration Tests

```bash
apps/api/src/modules/domain/__tests__/integration/domain-verification.integration.spec.ts
```

### Step 3: E2E Tests

```bash
apps/api/src/modules/domain/__tests__/e2e/domain-assignment-flow.e2e.spec.ts
```

### Step 4: Run Tests

```bash
# Run tests with Vitest (NOT bun test)
bun run test

# Run with coverage
bun run test:coverage
```

---

## Development Workflow

### Daily Development Loop

1. **Start Development Environment**
   ```bash
   bun run dev  # Starts API + Web + DB + Redis in Docker
   ```

2. **Make Changes**
   - Edit backend: `apps/api/src/modules/domain/`
   - Edit frontend: `apps/web/src/`
   - Edit contracts: `packages/api-contracts/domain/`

3. **Test Changes**
   ```bash
   # Run affected tests
   bun run test -- domain
   
   # Watch mode for TDD
   bun run test -- --watch
   ```

4. **Database Changes**
   ```bash
   # Generate migration (after schema changes)
   bun run api -- db:generate
   
   # Apply migration (in container)
   bun run api -- db:push
   ```

5. **Contract Changes**
   ```bash
   # Regenerate frontend types
   bun run web -- generate
   
   # Rebuild routes (if page structure changes)
   bun run web -- dr:build
   ```

---

## Common Tasks

### Task 1: Add New Domain Endpoint

1. Add procedure to contract (`packages/api-contracts/domain/*.contract.ts`)
2. Implement in service (`apps/api/src/modules/domain/services/*.service.ts`)
3. Implement in controller (`apps/api/src/modules/domain/controllers/*.controller.ts`)
4. Regenerate frontend types (`bun run web -- generate`)
5. Use in frontend (`useQuery(orpc.domain.*.*.queryOptions(...))`)
6. Write tests

### Task 2: Add Database Column

1. Update schema (`apps/api/src/config/drizzle/schema/domain.ts`)
2. Generate migration (`bun run api -- db:generate`)
3. Apply migration (`bun run api -- db:push`)
4. Update entity types (`apps/api/src/modules/domain/interfaces/*.types.ts`)
5. Update adapters to handle new field
6. Update contract schemas (Zod)
7. Regenerate frontend types (`bun run web -- generate`)

### Task 3: Add RBAC Rule

1. Update guard logic (`apps/api/src/modules/domain/guards/domain-role.guard.ts`)
2. Add `@Roles()` decorator to controller method
3. Update frontend to hide/disable UI for unauthorized users
4. Write guard tests

---

## Troubleshooting

### Issue: Migration Fails

**Solution**: 
```bash
# Check current schema
bun run api -- db:studio

# Drop and recreate (DEVELOPMENT ONLY)
# NOT RECOMMENDED - will lose data
bun run api -- db:push --force
```

### Issue: ORPC Types Not Generated

**Solution**:
```bash
# Ensure contracts are exported
cat packages/api-contracts/index.ts

# Regenerate
bun run web -- generate

# Check generated types
ls apps/web/src/lib/api.ts
```

### Issue: Tests Fail with "Cannot find module"

**Solution**:
```bash
# Use correct test command
bun run test  # ✅ Uses Vitest
bun test      # ❌ Uses Bun test runner (WRONG)
```

### Issue: Background Job Not Running

**Solution**:
```bash
# Check BullMQ queue registration
# apps/api/src/modules/domain/domain.module.ts

# Check Redis connection
docker ps | grep redis
```

---

## Next Steps

1. ✅ Quickstart guide complete
2. Create `/tests/` directory with test specifications (user requirement: "you should write tests")
3. Complete implementation plan
