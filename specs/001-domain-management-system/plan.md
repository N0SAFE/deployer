# Implementation Plan: Domain Management System

**Branch**: `001-domain-management-system` | **Date**: 2025-01-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-domain-management-system/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a comprehensive domain management system enabling organization-level domain ownership with DNS verification, project-level domain assignment, and service-level routing configuration. The system provides:

1. **Organization Domain Management**: DNS-verified domain registry with TXT/CNAME verification using native DNS resolution (Node.js dns module)
2. **Project Domain Assignment**: Multi-select domain assignment with automatic organization domain creation for new domains
3. **Service Domain Mapping**: Complete routing configuration with subdomain, base path, internal path/port, and path stripping
4. **Protocol Configuration**: HTTPS/HTTP support with automatic SSL certificate provisioning and HTTP→HTTPS auto-redirect
5. **Conflict Detection**: Real-time validation preventing duplicate subdomain+basePath combinations with actionable suggestions
6. **Role-Based Access Control**: 4-tier RBAC (Owner, Admin, Project Admin, Member) with permission-specific UI/API enforcement
7. **Rate Limiting & Quotas**: Configurable organization-specific limits stored in OrganizationSettings table
8. **In-App Notifications**: Toast notifications and notification panel with real-time polling (30s intervals) for status updates

**Technical Approach**: 
- Backend: NestJS with ORPC contracts, Drizzle ORM, Node.js `dns` module for verification
- Frontend: Next.js with Better Auth, ORPC client, Declarative Routing, React Query
- Database: PostgreSQL with 4 tables (OrganizationSettings, OrganizationDomain, ProjectDomain, ServiceDomainMapping)
- Testing: Vitest for unit/integration tests, API contract validation, DNS verification mocking

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js 20+  
**Primary Dependencies**: 
- Backend: NestJS 10+, ORPC ^0.1.0, Drizzle ORM ^0.39.3, Node.js `dns` module (native), BullMQ (background jobs)
- Frontend: Next.js 15.4, React 19, React Query, Zod ^4.0.0, Better Auth (session management)
- Shared: @repo/api-contracts (ORPC contracts), @repo/ui (Shadcn components)

**Storage**: PostgreSQL 16 with Drizzle ORM
- Tables: `organization_settings`, `organization_domains`, `project_domains`, `service_domain_mappings`
- Existing schema file: `apps/api/src/config/drizzle/schema/domain.ts` (requires extension for new requirements)

**Testing**: Vitest (NOT `bun test`)
- Unit tests: Services, adapters, validation logic
- Integration tests: API endpoints, database operations
- E2E tests: DNS verification workflow, domain assignment flow
- Mock strategies: DNS resolution mocking, database transactions

**Target Platform**: 
- Backend: Linux server (Docker containerized)
- Frontend: Next.js App Router (SSR + client components)
- Database: PostgreSQL in Docker with named volumes

**Project Type**: Turborepo monorepo (web + API + shared packages)

**Performance Goals**: 
- Domain list page load: <3 seconds (500+ domains)
- DNS verification check: <5 seconds
- Real-time conflict validation: <500ms (debounced)
- Search/filter response: <300ms
- Individual operations (add/verify/delete): <3 seconds
- Polling server impact: <5% load increase

**Constraints**: 
- Must use native DNS resolution (no external APIs like Cloudflare/Route53)
- Docker-first development (all db commands run in containers)
- Service-adapter pattern required (services return entities, adapters return contract types)
- Type safety everywhere (no `any` types except justified)
- Documentation-first (read docs before implementing)

**Scale/Scope**: 
- 10-1000 organizations
- 10-500 domains per organization (default quota: 50)
- 100+ service domain mappings per project
- Real-time polling every 30 seconds (controlled server load)
- Automatic DNS verification retry background job (every 6 hours)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ Principle I: Documentation-First Development

**Status**: PASS

**Evidence**:
- ✅ Read constitution.md, SERVICE-ADAPTER-PATTERN.md, FRONTEND-DEVELOPMENT-PATTERNS.md
- ✅ Read CORE-VS-FEATURE-ARCHITECTURE.md, ENVIRONMENT-SPECIFICATION.md
- ✅ Reviewed existing domain schema at `apps/api/src/config/drizzle/schema/domain.ts`
- ✅ Identified need for OrganizationSettings table (new requirement)
- ✅ Will create documentation for DNS verification implementation

**Action Required**: Document new DNS verification patterns and notification system in feature documentation

---

### ✅ Principle II: Type Safety Everywhere

**Status**: PASS

**Evidence**:
- ✅ All API contracts will be defined in `packages/api-contracts/` using ORPC with Zod schemas
- ✅ Services will return pure entities (OrganizationDomain, ProjectDomain, ServiceDomainMapping, OrganizationSettings)
- ✅ Adapters will return exact contract types extracted from ORPC contracts
- ✅ Frontend uses `orpc.contract.method.queryOptions()` pattern for type-safe API calls
- ✅ Declarative Routing for type-safe navigation
- ✅ Drizzle ORM provides compile-time type inference for database operations
- ✅ No `any` types planned (DNS module types will be properly typed)

**Action Required**: Extract contract output types to `interfaces/domain.types.ts` following folder structure rules

---

### ✅ Principle III: Docker-First Development

**Status**: PASS

**Evidence**:
- ✅ Development uses `bun run dev` (full stack with Docker)
- ✅ Database operations via `bun run api -- db:generate/push/migrate` (container-based)
- ✅ DNS verification service will run inside API container (Node.js `dns` module)
- ✅ Background jobs (DNS auto-retry) use BullMQ in containerized environment
- ✅ No direct host database access during development

**Action Required**: None - standard Docker workflow applies

---

### ✅ Principle IV: Service-Adapter Architectural Pattern

**Status**: PASS

**Evidence**:
- **Core Services** (return entities):
  * `DomainService.findById()` → `OrganizationDomain`
  * `DomainService.verifyDomain()` → `OrganizationDomain`
  * `ProjectDomainService.findByProject()` → `ProjectDomain[]`
  * `ServiceDomainMappingService.createMapping()` → `ServiceDomainMapping`
  
- **Adapters** (return exact contract types in `adapters/` folder):
  * `DomainAdapterService.adaptToContract()` → `OrganizationDomainContract`
  * `ProjectDomainAdapterService.adaptToContract()` → `ProjectDomainContract`
  * Adapters receive all data as parameters (no service calls)
  
- **Controllers** (orchestrate multiple service methods):
  * `DomainController.getById()`: calls `DomainService.findById()` + `DomainService.getUsageStats()` → adapter
  * `ServiceDomainMappingController.create()`: calls multiple services → aggregates → adapter

- **Types** (centralized in `interfaces/` folder):
  * `interfaces/domain.types.ts` with contract type extractions
  * `interfaces/organization-settings.types.ts` with configuration types

**Action Required**: Follow exact folder structure: `adapters/`, `interfaces/`, `services/`, `controllers/`

---

### ✅ Principle V: Core vs Feature Module Separation

**Status**: PASS - Feature Module

**Decision**: Domain management is a **feature module** (`apps/api/src/modules/domain/`)

**Rationale**:
- ✅ Provides HTTP endpoints for domain CRUD operations (feature characteristic)
- ✅ Domain-specific business logic, not shared infrastructure
- ✅ Used exclusively by domain management feature, not core infrastructure
- ✅ Depends on core modules (DatabaseModule, OrchestrationModule) but not vice versa

**Module Structure**:
```
apps/api/src/modules/domain/
├── adapters/              # Contract transformations
│   ├── domain-adapter.service.ts
│   ├── project-domain-adapter.service.ts
│   └── service-domain-mapping-adapter.service.ts
├── controllers/           # HTTP endpoints
│   ├── domain.controller.ts
│   ├── project-domain.controller.ts
│   └── service-domain-mapping.controller.ts
├── interfaces/            # Type definitions
│   ├── domain.types.ts
│   ├── project-domain.types.ts
│   └── organization-settings.types.ts
├── services/              # Business logic
│   ├── domain.service.ts
│   ├── domain-verification.service.ts
│   ├── project-domain.service.ts
│   ├── service-domain-mapping.service.ts
│   └── organization-settings.service.ts
├── repositories/          # Database access
│   ├── domain.repository.ts
│   ├── project-domain.repository.ts
│   ├── service-domain-mapping.repository.ts
│   └── organization-settings.repository.ts
├── processors/            # Background jobs
│   └── dns-verification.processor.ts
├── domain.module.ts       # Module definition
└── index.ts               # Barrel exports
```

**Dependencies**:
- ✅ Imports `CoreModule` (allowed: feature → core)
- ✅ Imports `DatabaseModule` (allowed: feature → core)
- ✅ May import `TraefikModule` if routing config generation needed (acceptable: feature → feature for configuration management)
- ❌ Does NOT import into core modules (correct: core cannot import features)

**Action Required**: Verify no circular dependencies with Traefik module

---

### ✅ Principle VI: Multi-Tenant Isolation & Resource Management

**Status**: PASS

**Evidence**:
- ✅ Organization-level domain ownership (organizationId foreign key)
- ✅ Project-level domain assignment (projectId foreign key)
- ✅ Service-level routing configuration (serviceId foreign key)
- ✅ Resource quotas stored in OrganizationSettings (maxDomains, maxConcurrentVerifications, etc.)
- ✅ Rate limiting per organization (verificationRateLimit setting)
- ✅ Cascade deletion maintains data integrity across organization boundaries

**Action Required**: Ensure all queries filter by organizationId for tenant isolation

---

### ✅ Principle VII: Reconciliation & Self-Healing Systems

**Status**: PASS

**Evidence**:
- ✅ **Desired State**: OrganizationSettings table defines limits; OrganizationDomain defines verification status
- ✅ **Actual State**: DNS records (queried via native DNS resolution)
- ✅ **Reconciliation Loop**: 
  * Background job (BullMQ processor) runs every 6 hours
  * Checks pending domains against DNS records
  * Updates verification status automatically
  * Retries up to maxAutoRetryAttempts times
- ✅ **Crash Recovery**: 
  * DNS verification resumable (status "pending" allows retry)
  * Rate limiting prevents verification spam after restart
  * Database maintains verification attempt history
- ✅ **Health Monitoring**: 
  * lastVerificationAttempt timestamp tracks stale verifications
  * System can detect domains requiring manual intervention

**Action Required**: Implement DNS verification processor with exponential backoff consideration

---

### ✅ Principle VIII: NestJS Service Architecture & File Organization

**Status**: PASS

**Evidence**:
- ✅ **Services**: Business logic returning entities
- ✅ **Repositories**: Drizzle ORM database access
- ✅ **Controllers**: HTTP endpoint orchestration
- ✅ **Adapters**: Contract transformations (in `adapters/` folder)
- ✅ **Processors**: Background DNS verification job (in `processors/` folder)
- ✅ **Interfaces**: Type definitions (in `interfaces/` folder)
- ✅ **Guards**: RBAC permission checks (need to create in `guards/` folder)
- ✅ No middlewares, hooks, or bootstrap needed for this feature

**Folder Compliance**:
- ✅ `services/` - DomainService, ProjectDomainService, etc.
- ✅ `repositories/` - Database access layer
- ✅ `controllers/` - Feature controllers (domain CRUD, verification)
- ✅ `adapters/` - Contract transformations
- ✅ `processors/` - DNS verification background job
- ✅ `interfaces/` - Type definitions
- ✅ `guards/` - RoleGuard for RBAC enforcement

**Action Required**: Create RoleGuard for 4-tier RBAC (Owner, Admin, Project Admin, Member)

---

### 📋 Constitution Compliance Summary

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Documentation-First | ✅ PASS | Read all relevant docs, will create feature docs |
| II. Type Safety | ✅ PASS | ORPC contracts, Zod schemas, typed entities |
| III. Docker-First | ✅ PASS | Container-based development, no host DB access |
| IV. Service-Adapter Pattern | ✅ PASS | Correct folder structure, separation of concerns |
| V. Core vs Feature | ✅ PASS | Feature module with correct dependencies |
| VI. Multi-Tenant Isolation | ✅ PASS | Organization-scoped data, resource quotas |
| VII. Reconciliation | ✅ PASS | DNS auto-retry, resumable verification |
| VIII. NestJS Architecture | ✅ PASS | All required file types, proper folder structure |

**Overall Result**: ✅ **CONSTITUTION COMPLIANT** - Proceed to Phase 0 Research

---

### Additional Compliance Notes

**Testing Requirements** (User explicitly requested: "you should write tests"):
- ✅ Unit tests for all services (DNS verification, domain CRUD, mapping logic)
- ✅ Integration tests for API endpoints (with mock DNS)
- ✅ Adapter tests (pure transformation testing, no service mocking)
- ✅ Controller tests (service orchestration testing)
- ✅ E2E tests for critical flows (domain verification workflow)
- ✅ Database transaction tests (cascade deletion, referential integrity)
- ✅ RBAC tests (permission enforcement at API level)

**Type Safety Checklist**:
- ✅ Contract types extracted to `interfaces/domain.types.ts`
- ✅ Drizzle schema types exported from schema files
- ✅ DNS module types properly typed (Node.js `dns.Resolver` class)
- ✅ Background job data types defined in processor

**Folder Structure Enforcement**:
- ✅ NO adapters in `services/` folder
- ✅ NO types inline (all in `interfaces/`)
- ✅ NO service calls inside adapters
- ✅ ALL RB AC guards in `guards/` folder

## Project Structure

### Documentation (this feature)

```
specs/001-domain-management-system/
├── plan.md                      # This file (/speckit.plan command output)
├── spec.md                      # Feature specification (COMPLETE - 814 lines, 70 FRs, 30 SCs)
├── clarification-report.md      # Clarification decisions (5 questions resolved)
├── research.md                  # Phase 0 output (/speckit.plan command - PENDING)
├── data-model.md                # Phase 1 output (/speckit.plan command - PENDING)
├── quickstart.md                # Phase 1 output (/speckit.plan command - PENDING)
├── contracts/                   # Phase 1 output (/speckit.plan command - PENDING)
│   ├── domain.contract.ts       # Organization domain ORPC contract
│   ├── project-domain.contract.ts # Project domain ORPC contract
│   ├── service-domain-mapping.contract.ts # Service mapping ORPC contract
│   └── organization-settings.contract.ts # Settings ORPC contract
└── tests/                       # Test specifications (PENDING)
    ├── unit-test-plan.md        # Unit test structure
    ├── integration-test-plan.md # Integration test patterns
    └── e2e-test-plan.md         # E2E scenarios
```

### Source Code (repository root)

**Selected Structure**: Web application (frontend + backend in Turborepo monorepo)

```
# Backend API (NestJS)
apps/api/src/
├── config/drizzle/schema/
│   ├── domain.ts                       # EXISTING - Requires extension for OrganizationSettings
│   ├── organization-settings.ts         # NEW - Organization limit configuration
│   └── index.ts                        # Update with new table exports
├── modules/domain/                      # NEW - Feature module
│   ├── adapters/
│   │   ├── domain-adapter.service.ts
│   │   ├── project-domain-adapter.service.ts
│   │   ├── service-domain-mapping-adapter.service.ts
│   │   └── organization-settings-adapter.service.ts
│   ├── controllers/
│   │   ├── domain.controller.ts         # Organization domain CRUD, verification
│   │   ├── project-domain.controller.ts # Project domain assignment
│   │   ├── service-domain-mapping.controller.ts # Service routing config
│   │   └── organization-settings.controller.ts  # Settings management
│   ├── guards/
│   │   └── domain-role.guard.ts         # RBAC enforcement (Owner, Admin, Project Admin, Member)
│   ├── interfaces/
│   │   ├── domain.types.ts              # OrganizationDomain contract types
│   │   ├── project-domain.types.ts      # ProjectDomain contract types
│   │   ├── service-domain-mapping.types.ts # ServiceDomainMapping contract types
│   │   └── organization-settings.types.ts  # OrganizationSettings contract types
│   ├── processors/
│   │   └── dns-verification.processor.ts # Background DNS auto-retry job
│   ├── repositories/
│   │   ├── domain.repository.ts         # OrganizationDomain database access
│   │   ├── project-domain.repository.ts # ProjectDomain database access
│   │   ├── service-domain-mapping.repository.ts # ServiceDomainMapping database access
│   │   └── organization-settings.repository.ts  # OrganizationSettings database access
│   ├── services/
│   │   ├── domain.service.ts            # Organization domain business logic
│   │   ├── domain-verification.service.ts # DNS verification logic (Node.js dns module)
│   │   ├── project-domain.service.ts    # Project domain assignment logic
│   │   ├── service-domain-mapping.service.ts # Service routing logic
│   │   ├── conflict-detection.service.ts # Subdomain+basePath conflict validation
│   │   └── organization-settings.service.ts  # Settings management
│   ├── domain.module.ts                 # Module definition
│   └── index.ts                         # Barrel exports
└── tests/
    └── domain/
        ├── adapters/                    # Adapter tests (pure transformation)
        ├── controllers/                 # Controller tests (orchestration)
        ├── guards/                      # RBAC enforcement tests
        ├── services/                    # Service tests (business logic)
        └── integration/                 # API endpoint integration tests

# Frontend Web (Next.js)
apps/web/src/
├── app/
│   └── (app)/
│       └── organization/
│           └── domains/
│               ├── page.tsx                     # NEW - Organization domains dashboard
│               ├── page.info.ts                 # NEW - Route definition
│               ├── _components/
│               │   ├── DomainList.tsx           # NEW - Domain table/list
│               │   ├── AddDomainDialog.tsx      # NEW - Add domain modal
│               │   ├── VerificationInstructions.tsx # NEW - DNS instructions
│               │   ├── DomainUsagePanel.tsx     # NEW - Domain usage view
│               │   └── DomainStatusChip.tsx     # NEW - Status badge component
│               └── [domainId]/
│                   ├── page.tsx                 # NEW - Domain detail page
│                   └── page.info.ts             # NEW - Route definition
├── components/
│   ├── domain/                          # NEW - Domain management components
│   │   ├── DomainMultiSelect.tsx        # Project domain assignment interface
│   │   ├── ServiceDomainMappingForm.tsx # Service routing config form
│   │   ├── ProtocolConfigSelect.tsx     # HTTP/HTTPS protocol selector
│   │   ├── ConflictWarning.tsx          # Conflict notification component
│   │   └── PathStrippingToggle.tsx      # Path stripping configuration
│   └── notifications/                   # NEW - Notification system
│       ├── ToastNotification.tsx        # Toast notification component
│       ├── NotificationBell.tsx         # Notification bell with badge
│       └── NotificationPanel.tsx        # Event history panel
├── hooks/
│   ├── useDomains.ts                    # NEW - Domain management hooks
│   ├── useProjectDomains.ts             # NEW - Project domain hooks
│   ├── useServiceDomainMappings.ts      # NEW - Service mapping hooks
│   ├── useOrganizationSettings.ts       # NEW - Settings hooks
│   └── useNotifications.ts              # NEW - Notification management hooks
├── routes/                              # UPDATE - Add new routes
│   ├── index.ts                         # Update with domain routes
│   └── types.ts                         # Update with domain route types
└── tests/
    └── domain/
        ├── hooks/                       # Hook tests
        └── components/                  # Component tests

# Shared API Contracts (ORPC)
packages/api-contracts/
├── domain/                              # NEW - Domain management contracts
│   ├── index.ts                         # Contract exports
│   ├── organization-domain.contract.ts  # Organization domain ORPC contract
│   ├── project-domain.contract.ts       # Project domain ORPC contract
│   ├── service-domain-mapping.contract.ts # Service mapping ORPC contract
│   └── organization-settings.contract.ts  # Settings ORPC contract
└── index.ts                             # Update with domain exports

# Database Migrations
apps/api/src/config/drizzle/migrations/
└── XXXX_add_domain_management_system.sql # NEW - Migration for OrganizationSettings and schema updates
```

**Structure Decision**: 

This is a **Web Application** structure with clear separation between frontend (Next.js App Router) and backend (NestJS feature module). The domain management feature follows the established monorepo pattern:

1. **Backend Feature Module** (`apps/api/src/modules/domain/`):
   - Complete NestJS module with all file types (adapters, controllers, guards, interfaces, processors, repositories, services)
   - Follows Principle VIII NestJS Service Architecture exactly
   - RBAC enforcement via custom guard in `guards/` folder
   - Background DNS verification job in `processors/` folder
   - All type definitions in `interfaces/` folder (no inline types)

2. **Frontend Pages & Components** (`apps/web/src/app/(app)/organization/domains/`):
   - Organization domains dashboard as main entry point
   - Co-located `_components/` for page-specific UI
   - Shared domain components in `components/domain/`
   - Custom hooks in `hooks/` for ORPC integration
   - Declarative routing with `page.info.ts` files

3. **Shared Contracts** (`packages/api-contracts/domain/`):
   - ORPC contracts define end-to-end type-safe API
   - Zod schemas for input validation
   - Contract output types extracted to backend `interfaces/` folder

4. **Database Schema** (`apps/api/src/config/drizzle/schema/`):
   - Existing `domain.ts` schema requires extension for new fields (internalPath, internalPort, stripPathEnabled, protocolConfig)
   - New `organization-settings.ts` schema for configurable limits
   - Migration to add missing fields and new table

**Key Architectural Decisions**:
- ✅ Domain management is a **feature module**, not core (provides HTTP endpoints, domain-specific logic)
- ✅ DNS verification service uses **native Node.js `dns` module** (no external dependencies)
- ✅ Background job uses **existing BullMQ infrastructure** (no new queue system)
- ✅ Frontend uses **Better Auth** for session management and **ORPC client** for API calls
- ✅ Declarative Routing requires **`bun run web -- dr:build`** after route changes
- ✅ Testing with **Vitest** (NOT `bun test`) using `bun run test` command

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

**No violations identified.** All 8 constitution principles passed without exceptions:
- ✅ No additional projects beyond monorepo structure (using existing apps/api and apps/web)
- ✅ No repository pattern complexity (using standard Drizzle ORM repositories)
- ✅ No excessive dependencies (native DNS module, existing BullMQ infrastructure, existing Better Auth)
- ✅ Feature module classification appropriate (domain-specific HTTP endpoints, not shared infrastructure)
- ✅ Standard NestJS file organization with all 10 file types in proper folders
- ✅ No architectural deviations from established patterns
- ✅ Testing strategy uses approved Vitest framework (not alternative test runners)

**Implementation proceeds without constitution waivers.**

---

## Phase 0: Research & Outline

**Status**: ✅ COMPLETE  
**Artifacts**: [`research.md`](./research.md)

### Unknowns Identified

During specification review, 5 technical unknowns were identified requiring research before design:

1. **DNS Verification Implementation** - How to verify domains using Node.js `dns` module (TXT/CNAME records, error handling, caching)
2. **BullMQ Background Job Configuration** - How to implement automatic DNS verification retry mechanism (queue setup, job scheduling, error handling)
3. **RBAC Guard Implementation** - How to enforce 4-tier role hierarchy in NestJS (guard patterns, decorator usage, permission checking)
4. **Frontend Polling Strategy** - How to implement 30-second real-time status polling without excessive server load (React Query configuration, background pause)
5. **DNS Testing Strategy** - How to test DNS verification without real DNS queries (mocking patterns, dependency injection, test coverage)

### Research Outcomes

**All research complete** - See [`research.md`](./research.md) for detailed findings.

**Summary of Decisions**:

| Research Item | Decision | Technology | Complexity |
|---------------|----------|------------|------------|
| DNS Verification | Native `dns.promises` API with 10s timeout | Node.js built-in | Low |
| Background Jobs | BullMQ repeatable job (cron: `0 */6 * * *`) | Existing infrastructure | Medium |
| RBAC Implementation | NestJS Guards + `@Roles()` decorator | Native NestJS pattern | Medium |
| Frontend Polling | React Query `refetchInterval: 30000` | React Query feature | Low |
| DNS Testing | Dependency Injection + `MockDnsResolver` | Interface abstraction | Medium |

**External Dependencies Added**: 0 (all use existing infrastructure or native modules)  
**Constitution Compliance**: ✅ All decisions align with project principles

---

## Phase 1: Data Model, Contracts, Quickstart, Tests

**Status**: ✅ COMPLETE  
**Artifacts**: 
- [`data-model.md`](./data-model.md) - Database schema design
- [`contracts/`](./contracts/) - ORPC contract definitions (4 files)
- [`quickstart.md`](./quickstart.md) - Developer onboarding guide
- [`tests/`](./tests/) - Test specifications (3 test plan files)

### Data Model

**File**: [`data-model.md`](./data-model.md)

**Database Changes**:
- ✅ **NEW TABLE**: `organization_settings` (10 columns) - Per-org domain limits and verification config
- ✅ **UPDATE**: `organization_domains` (+3 columns) - Add retry tracking (`retry_attempts`, `last_verification_attempt`, `next_retry_at`)
- ✅ **UPDATE**: `service_domain_mappings` (+4 columns) - Add routing config (`internal_path`, `internal_port`, `strip_path_enabled`, `protocol_config`)
- ✅ **NO CHANGE**: `project_domains` (existing schema sufficient)

**Total Schema Changes**: 17 new columns across 3 tables

**Migration Strategy**: 
- Additive changes only (no downtime required)
- Default values for new columns (existing data compatible)
- Backfill `organization_settings` for existing organizations
- Rollback SQL provided for safety

### ORPC Contracts

**Directory**: [`contracts/`](./contracts/)

**4 Contract Files** (all complete with Zod schemas, procedures, TypeScript types):

1. **`organization-domain.contract.md`** - Organization-level domain management
   - Endpoints: `list`, `getById`, `create`, `verify`, `delete`, `getUsage`
   - Features: Pagination, status filtering, verification instructions, usage tracking
   - RBAC: Organization Owner, Organization Admin

2. **`project-domain.contract.md`** - Project-level domain assignment
   - Endpoints: `listByProject`, `getAvailable`, `assignDomains`, `unassignDomain`
   - Features: Multi-select assignment, auto-register new domains, bulk operations
   - RBAC: Owner, Admin, Project Admin (project-scoped)

3. **`service-domain-mapping.contract.md`** - Service routing configuration
   - Endpoints: `create`, `update`, `delete`, `checkConflict`, `list`
   - Features: Real-time conflict detection (500ms debounced), routing config, protocol settings
   - RBAC: Owner, Admin, Project Admin, Member (project-scoped)

4. **`organization-settings.contract.md`** - Quota and limit management
   - Endpoints: `get`, `update`
   - Features: Configurable limits (maxDomains, verification rate, retry settings)
   - RBAC: Get (Owner, Admin), Update (Owner only)

**Contract Implementation Location**: `packages/api-contracts/domain/`  
**Frontend Type Generation**: `bun run web -- generate`

### Quickstart Guide

**File**: [`quickstart.md`](./quickstart.md)

**Developer Onboarding Phases**:
1. **Database Setup** - Schema updates, migration generation, migration application
2. **ORPC Contracts** - Contract file creation, type exports, integration with main contract index
3. **Backend Implementation** - Module creation in correct order (interfaces → repositories → services → adapters → guards → processors → controllers)
4. **Frontend Implementation** - Route generation, component creation, custom hooks for ORPC integration
5. **Testing** - Unit, integration, E2E test execution

**Common Tasks Documented**:
- Adding new domain endpoint
- Adding database column
- Adding RBAC rule
- Troubleshooting migration failures, type generation, background jobs

**Development Workflow**: Daily loop documented (start dev, make changes, test, database ops, contract regeneration)

### Test Specifications

**Directory**: [`tests/`](./tests/)

**User Requirement**: ✅ "you should write tests" - Comprehensive test strategy provided

**3 Test Plan Files**:

1. **`unit-test-plan.md`** - Isolated component testing
   - **Adapters** (100% coverage) - Pure transformation, no dependencies, test first
   - **Services** (90%+ coverage) - Business logic with mock repositories and DNS resolver
   - **Guards** (95%+ coverage) - RBAC permission matrix (all 4 role tiers)
   - **Repositories** (85%+ coverage) - Database operations with transactions
   - **Mock Implementations**: `MockDnsResolver` with TXT/CNAME record simulation

2. **`integration-test-plan.md`** - API endpoint testing
   - **Organization Domain Endpoints** - list, create, verify, delete with quota/rate limit validation
   - **Project Domain Endpoints** - multi-select assignment, auto-register, RBAC enforcement
   - **Service Domain Mapping Endpoints** - conflict detection, routing config, real-time validation
   - **Testing Strategy**: Mock DNS, database transactions, Better Auth session mocking

3. **`e2e-test-plan.md`** - End-to-end workflow testing
   - **Critical Flows**:
     * Domain verification workflow (create → configure DNS → verify → success)
     * Project domain assignment flow (multi-select + auto-register)
     * Service mapping conflict detection (real-time validation)
     * RBAC permission enforcement (all 4 role tiers)
   - **Coverage**: All 30 success criteria from specification

**Total Test Count Estimate**: 120+ tests across 3 levels  
**Test Runner**: Vitest (NOT `bun test`) - Commands: `bun run test`, `bun run test:coverage`

**Testing Principles Documented**:
- Test adapters first (no dependencies)
- Mock DNS resolver using dependency injection
- Use database transactions (rollback after tests)
- Follow AAA pattern (Arrange, Act, Assert)
- 100% adapter coverage, 90%+ service coverage, 85%+ repository coverage

---

## Next Steps

**Phase 0 & Phase 1**: ✅ COMPLETE

**Ready for Implementation**: 
1. ✅ All research complete (5 unknowns resolved)
2. ✅ Database schema designed (17 new columns, 1 new table)
3. ✅ ORPC contracts defined (4 contract files with Zod schemas)
4. ✅ Developer guide ready (quickstart.md with common tasks)
5. ✅ Test specifications complete (unit, integration, E2E plans)

**Proceed to**: 
- Generate database migration (`bun run api -- db:generate` - developer will apply manually)
- Implement ORPC contracts in `packages/api-contracts/domain/`
- Implement backend module following quickstart.md order
- Implement frontend pages and components
- Write tests following test specifications

**Constitution Compliance**: ✅ All principles verified, no violations, implementation can proceed
