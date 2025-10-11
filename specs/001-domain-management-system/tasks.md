# Tasks: Domain Management System

**Input**: Design documents from `/specs/001-domain-management-system/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: User explicitly requested testing ("you should write tests") - comprehensive test tasks included following TDD approach

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (Setup, Foundation, US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions
- **Monorepo structure**: `apps/api/src/` (backend), `apps/web/src/` (frontend), `packages/` (shared)
- All tasks reference exact file paths from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and database schema setup

- [ ] T001 Create `organizationSettings` table in `apps/api/src/config/drizzle/schema/domain.ts` with database trigger to auto-create settings when organization is created
- [ ] T002 Add retry tracking columns to `organizationDomains` table: `retry_attempts`, `last_verification_attempt`, `next_retry_at`
- [ ] T003 Add routing config columns to `serviceDomainMappings` table: `internal_path`, `internal_port`, `strip_path_enabled`, `protocol_config`
- [ ] T004 Generate database migration using `bun run api -- db:generate`
- [ ] T005 Apply migration in development using `bun run api -- db:push`
- [ ] T006 Verify schema changes in Drizzle Studio using `bun run api -- db:studio`

**Checkpoint**: Database schema updated - all tables and columns ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### ORPC Contracts (Shared Type System)

- [ ] T007 [P] Create `packages/api-contracts/domain/organization-domain.contract.ts` with 6 procedures (list, getById, create, verify, delete, getUsage) - copy from `contracts/organization-domain.contract.md`
- [ ] T008 [P] Create `packages/api-contracts/domain/project-domain.contract.ts` with 4 procedures (listByProject, getAvailable, assignDomains, unassignDomain) - copy from `contracts/project-domain.contract.md`
- [ ] T009 [P] Create `packages/api-contracts/domain/service-domain-mapping.contract.ts` with 5 procedures (create, update, delete, checkConflict, list) - copy from `contracts/service-domain-mapping.contract.md`
- [ ] T010 [P] Create `packages/api-contracts/domain/organization-settings.contract.ts` with 2 procedures (get, update) - copy from `contracts/organization-settings.contract.md`
- [ ] T011 Create `packages/api-contracts/domain/index.ts` exporting all contracts
- [ ] T012 Update `packages/api-contracts/index.ts` to include domain contracts
- [ ] T013 Regenerate frontend types using `bun run web -- generate`

### Backend Module Structure (NestJS)

- [ ] T014 Create `apps/api/src/modules/domain/domain.module.ts` with module definition
- [ ] T015 [P] Create `apps/api/src/modules/domain/interfaces/domain.types.ts` with contract type extractions
- [ ] T016 [P] Create `apps/api/src/modules/domain/interfaces/project-domain.types.ts` with contract type extractions
- [ ] T017 [P] Create `apps/api/src/modules/domain/interfaces/service-domain-mapping.types.ts` with contract type extractions
- [ ] T018 [P] Create `apps/api/src/modules/domain/interfaces/organization-settings.types.ts` with contract type extractions

### DNS Verification Service (Shared Dependency)

- [ ] T019 Create `apps/api/src/modules/domain/interfaces/dns-resolver.interface.ts` with `IDnsResolver` interface
- [ ] T020 Create `apps/api/src/modules/domain/services/native-dns-resolver.service.ts` using Node.js `dns.promises` API
- [ ] T021 Create `apps/api/src/modules/domain/services/domain-verification.service.ts` with TXT/CNAME verification methods, 10s timeout, 5-min cache, temporary vs permanent failure detection (NXDOMAIN/not-found = temporary, token-mismatch = permanent)

### RBAC Guards (Shared Security)

- [ ] T022 Create `apps/api/src/modules/domain/guards/domain-role.guard.ts` implementing 4-tier RBAC (Owner, Admin, Project Admin, Member)
- [ ] T023 Create `apps/api/src/modules/domain/decorators/roles.decorator.ts` with `@Roles()` decorator using `SetMetadata`

### Background Job Infrastructure

- [ ] T024 Register `domain-verification` queue in `apps/api/src/modules/domain/domain.module.ts` using BullModule
- [ ] T025 Create `apps/api/src/modules/domain/processors/dns-verification.processor.ts` with `@Process('retry-verification')` handler and cron `0 */6 * * *`

### Frontend Route Generation

- [ ] T026 Create `apps/web/src/app/(app)/organization/domains/page.info.ts` route definition
- [ ] T027 Create `apps/web/src/app/(app)/organization/domains/[domainId]/page.info.ts` route definition
- [ ] T028 Generate declarative routes using `bun run web -- dr:build`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Project Domain Registration with Auto-Creation (Priority: P1) 🎯 MVP

**Goal**: Enable project administrators to quickly assign domains to projects, including new domains that auto-register to organization

**Independent Test**: Login as Project Admin → navigate to project domain settings → select multiple domains (mix of existing + new) → submit → verify: (1) new domains created in org with "pending" status, (2) all domains assigned to project, (3) verification instructions shown, (4) only Owner/Admin can verify

### Tests for User Story 1

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T029 [P] [US1] Create `apps/api/src/modules/domain/tests/adapters/project-domain-adapter.service.spec.ts` - test pure transformation to `ProjectDomainContract` type
- [ ] T030 [P] [US1] Create `apps/api/src/modules/domain/tests/services/project-domain.service.spec.ts` - test multi-select assignment logic with auto-creation of org domains
- [ ] T031 [P] [US1] Create `apps/api/src/modules/domain/tests/controllers/project-domain.controller.spec.ts` - test ORPC endpoint `assignDomains` with role enforcement
- [ ] T032 [P] [US1] Create `apps/api/src/modules/domain/tests/integration/project-domain-assignment.integration.spec.ts` - test full workflow: select domains → submit → verify DB state

### Implementation for User Story 1

#### Backend - Repositories

- [ ] T033 [P] [US1] Create `apps/api/src/modules/domain/repositories/project-domain.repository.ts` with methods: `findByProject`, `create`, `delete`, `bulkCreate`
- [ ] T034 [P] [US1] Create `apps/api/src/modules/domain/repositories/domain.repository.ts` with methods: `findById`, `findByDomain`, `create`, `updateStatus`, `getUsageByDomain`

#### Backend - Services

- [ ] T035 [US1] Create `apps/api/src/modules/domain/services/project-domain.service.ts` with `assignDomains()` method (depends on T033, T034) - handles auto-creation logic
- [ ] T036 [US1] Create `apps/api/src/modules/domain/services/domain.service.ts` with `findOrCreateDomain()`, `findById()`, `verifyDomain()`, `getUsage()` methods

#### Backend - Adapters

- [ ] T037 [P] [US1] Create `apps/api/src/modules/domain/adapters/project-domain-adapter.service.ts` transforming `ProjectDomain` entities to contract types
- [ ] T038 [P] [US1] Create `apps/api/src/modules/domain/adapters/domain-adapter.service.ts` transforming `OrganizationDomain` entities to contract types

#### Backend - Controllers

- [ ] T039 [US1] Create `apps/api/src/modules/domain/controllers/project-domain.controller.ts` with `@Implement(projectDomainContract.assignDomains)` - orchestrates multi-select + auto-create
- [ ] T040 [US1] Add `@Implement(projectDomainContract.listByProject)` to controller - lists domains assigned to project
- [ ] T041 [US1] Add `@Implement(projectDomainContract.getAvailable)` to controller - lists verified org domains not yet assigned

#### Frontend - Components

- [ ] T042 [P] [US1] Create `apps/web/src/components/domain/DomainMultiSelect.tsx` - multi-select with typeahead for new domains
- [ ] T043 [P] [US1] Create `apps/web/src/app/(app)/organization/domains/_components/VerificationInstructions.tsx` - displays DNS TXT/CNAME instructions

#### Frontend - Hooks

- [ ] T044 [US1] Create `apps/web/src/hooks/useProjectDomains.ts` using `useQuery(orpc.projectDomain.listByProject.queryOptions())`
- [ ] T045 [US1] Add `useAssignDomains()` mutation hook using `useMutation(orpc.projectDomain.assignDomains.mutate())`

#### Frontend - Pages

- [ ] T046 [US1] Create `apps/web/src/app/(app)/project/[projectId]/domains/page.tsx` with project domain assignment interface (depends on T042, T044, T045)
- [ ] T047 [US1] Create `apps/web/src/app/(app)/project/[projectId]/domains/page.info.ts` route definition
- [ ] T048 [US1] Regenerate routes: `bun run web -- dr:build`

**Checkpoint**: At this point, User Story 1 should be fully functional - project admins can assign domains with auto-registration

---

## Phase 4: User Story 2 - Service Domain Mapping with Internal Routing (Priority: P1)

**Goal**: Enable developers to configure complete service routing: subdomain, external path, internal path/port, path stripping

**Independent Test**: Login as Project Member → create service → open domain mapping settings → configure subdomain, base path, internal path/port, strip path toggle → verify routing preview shows correct transformation

### Tests for User Story 2

- [ ] T049 [P] [US2] Create `apps/api/src/modules/domain/tests/adapters/service-domain-mapping-adapter.service.spec.ts` - test transformation with routing config
- [ ] T050 [P] [US2] Create `apps/api/src/modules/domain/tests/services/service-domain-mapping.service.spec.ts` - test routing configuration logic and path stripping behavior
- [ ] T051 [P] [US2] Create `apps/api/src/modules/domain/tests/services/conflict-detection.service.spec.ts` - test subdomain+basePath uniqueness validation
- [ ] T052 [P] [US2] Create `apps/api/src/modules/domain/tests/controllers/service-domain-mapping.controller.spec.ts` - test create/update/delete endpoints with RBAC
- [ ] T053 [P] [US2] Create `apps/api/src/modules/domain/tests/integration/service-routing-config.integration.spec.ts` - test complete routing config creation and preview generation

### Implementation for User Story 2

#### Backend - Repositories

- [ ] T054 [P] [US2] Create `apps/api/src/modules/domain/repositories/service-domain-mapping.repository.ts` with methods: `create`, `update`, `delete`, `findByService`, `findByProjectDomain`, `checkConflict`

#### Backend - Services

- [ ] T055 [US2] Create `apps/api/src/modules/domain/services/service-domain-mapping.service.ts` with `create()`, `update()`, `delete()`, `generateRoutingPreview()` methods
- [ ] T056 [US2] Create `apps/api/src/modules/domain/services/conflict-detection.service.ts` with `checkConflict()` method validating subdomain+basePath uniqueness

#### Backend - Adapters

- [ ] T057 [P] [US2] Create `apps/api/src/modules/domain/adapters/service-domain-mapping-adapter.service.ts` transforming entities to contract types with routing preview

#### Backend - Controllers

- [ ] T058 [US2] Create `apps/api/src/modules/domain/controllers/service-domain-mapping.controller.ts` with `@Implement(serviceDomainMappingContract.create)` - handles routing config creation
- [ ] T059 [US2] Add `@Implement(serviceDomainMappingContract.update)` to controller - updates routing configuration
- [ ] T060 [US2] Add `@Implement(serviceDomainMappingContract.delete)` to controller - removes service domain mapping
- [ ] T061 [US2] Add `@Implement(serviceDomainMappingContract.checkConflict)` to controller - real-time conflict validation (500ms debounced)
- [ ] T062 [US2] Add `@Implement(serviceDomainMappingContract.list)` to controller - lists mappings for project domain

#### Frontend - Components

- [ ] T063 [P] [US2] Create `apps/web/src/components/domain/ServiceDomainMappingForm.tsx` - complete routing config form (subdomain, paths, port, strip toggle)
- [ ] T064 [P] [US2] Create `apps/web/src/components/domain/PathStrippingToggle.tsx` - checkbox with tooltip explaining path transformation
- [ ] T065 [P] [US2] Create `apps/web/src/components/domain/ConflictWarning.tsx` - real-time conflict notification component

#### Frontend - Hooks

- [ ] T066 [US2] Create `apps/web/src/hooks/useServiceDomainMappings.ts` using `useQuery(orpc.serviceDomainMapping.list.queryOptions())`
- [ ] T067 [US2] Add `useCreateMapping()` mutation hook using `useMutation(orpc.serviceDomainMapping.create.mutate())`
- [ ] T068 [US2] Add `useCheckConflict()` query hook with 500ms debounce for real-time validation

#### Frontend - Pages

- [ ] T069 [US2] Create `apps/web/src/app/(app)/service/[serviceId]/domain-mapping/page.tsx` with service domain mapping interface (depends on T063, T064, T066, T067, T068)
- [ ] T070 [US2] Create `apps/web/src/app/(app)/service/[serviceId]/domain-mapping/page.info.ts` route definition
- [ ] T071 [US2] Regenerate routes: `bun run web -- dr:build`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - complete routing configuration functional

---

## Phase 5: User Story 3 - Protocol Configuration with HTTPS Auto-Redirect (Priority: P2)

**Goal**: Enable admins to configure HTTP/HTTPS protocol settings with automatic HTTP→HTTPS redirect option

**Independent Test**: Login as Project Admin → configure service domain mapping → select protocol options (HTTPS only, Both with redirect, etc.) → make test HTTP/HTTPS requests → verify: (1) requests accepted/rejected per config, (2) HTTP redirects to HTTPS when enabled, (3) SSL cert provisioned

### Tests for User Story 3

- [ ] T072 [P] [US3] Create `apps/api/src/modules/domain/tests/services/protocol-config.service.spec.ts` - test protocol validation and auto-redirect logic
- [ ] T073 [P] [US3] Create `apps/api/src/modules/domain/tests/integration/protocol-configuration.integration.spec.ts` - test protocol config storage and retrieval

### Implementation for User Story 3

#### Backend - Services

- [ ] T074 [US3] Update `apps/api/src/modules/domain/services/service-domain-mapping.service.ts` to validate `protocolConfig` JSONB field (at least one protocol enabled)

#### Backend - Controllers

- [ ] T075 [US3] Update `apps/api/src/modules/domain/controllers/service-domain-mapping.controller.ts` `create()` and `update()` to accept `protocolConfig` parameter

#### Frontend - Components

- [ ] T076 [P] [US3] Create `apps/web/src/components/domain/ProtocolConfigSelect.tsx` - radio buttons for HTTP/HTTPS/Both/Both with Redirect options
- [ ] T077 [P] [US3] Update `apps/web/src/components/domain/ServiceDomainMappingForm.tsx` to include protocol configuration (add T076 component)

#### Frontend - Hooks

- [ ] T078 [US3] Update `apps/web/src/hooks/useServiceDomainMappings.ts` to handle `protocolConfig` in create/update mutations

**Checkpoint**: All routing stories (US1, US2, US3) should now be independently functional with complete protocol control

---

## Phase 6: User Story 4 - Organization Domain Management Dashboard (Priority: P1)

**Goal**: Provide centralized dashboard for admins to manage all org domains, view verification status, trigger checks, see usage across projects

**Independent Test**: Login as Org Admin → navigate to org domains page → verify: (1) all domains listed with status chips, (2) "Verify" triggers DNS check and updates status, (3) "Add Domain" creates pending domain with instructions, (4) expand domain shows projects/services using it, (5) conflicts flagged with warnings, (6) delete disabled for in-use domains

### Tests for User Story 4

- [ ] T079 [P] [US4] Create `apps/api/src/modules/domain/tests/services/domain.service.spec.ts` - test domain CRUD, verification trigger, usage calculation
- [ ] T080 [P] [US4] Create `apps/api/src/modules/domain/tests/services/domain-verification.service.spec.ts` - test DNS TXT/CNAME verification with mock resolver
- [ ] T081 [P] [US4] Create `apps/api/src/modules/domain/tests/controllers/domain.controller.spec.ts` - test all 6 ORPC endpoints with role enforcement
- [ ] T082 [P] [US4] Create `apps/api/src/modules/domain/tests/integration/domain-verification-workflow.integration.spec.ts` - test full verification flow: create → configure DNS → verify → success

### Implementation for User Story 4

#### Backend - Repositories

- [ ] T083 [US4] Update `apps/api/src/modules/domain/repositories/domain.repository.ts` to add methods: `findAll`, `delete`, `getUsageStats`

#### Backend - Services

- [ ] T084 [US4] Update `apps/api/src/modules/domain/services/domain.service.ts` to add methods: `list()`, `create()`, `delete()`, `getUsageWithProjects()`

#### Backend - Controllers

- [ ] T085 [US4] Create `apps/api/src/modules/domain/controllers/domain.controller.ts` with `@Implement(organizationDomainContract.list)` - paginated domain list with status filtering
- [ ] T086 [US4] Add `@Implement(organizationDomainContract.getById)` to controller - single domain details
- [ ] T087 [US4] Add `@Implement(organizationDomainContract.create)` to controller - creates pending domain with verification token
- [ ] T088 [US4] Add `@Implement(organizationDomainContract.verify)` to controller - triggers DNS verification check
- [ ] T089 [US4] Add `@Implement(organizationDomainContract.delete)` to controller - cascade deletes with usage check
- [ ] T090 [US4] Add `@Implement(organizationDomainContract.getUsage)` to controller - returns projects/services using domain

#### Frontend - Components

- [ ] T091 [P] [US4] Create `apps/web/src/app/(app)/organization/domains/_components/DomainList.tsx` - table/list with status chips, search/filter
- [ ] T092 [P] [US4] Create `apps/web/src/app/(app)/organization/domains/_components/AddDomainDialog.tsx` - modal form for adding domains with verification method selection
- [ ] T093 [P] [US4] Update `apps/web/src/app/(app)/organization/domains/_components/VerificationInstructions.tsx` to support both TXT and CNAME methods
- [ ] T094 [P] [US4] Create `apps/web/src/app/(app)/organization/domains/_components/DomainUsagePanel.tsx` - expandable usage view showing projects/services
- [ ] T095 [P] [US4] Create `apps/web/src/app/(app)/organization/domains/_components/DomainStatusChip.tsx` - colored badge (green/yellow/red)

#### Frontend - Hooks

- [ ] T096 [US4] Create `apps/web/src/hooks/useDomains.ts` using `useQuery(orpc.organizationDomain.list.queryOptions())` with `refetchInterval: 30000`
- [ ] T097 [US4] Add `useVerifyDomain()` mutation hook using `useMutation(orpc.organizationDomain.verify.mutate())`
- [ ] T098 [US4] Add `useCreateDomain()` mutation hook using `useMutation(orpc.organizationDomain.create.mutate())`
- [ ] T099 [US4] Add `useDeleteDomain()` mutation hook using `useMutation(orpc.organizationDomain.delete.mutate())`
- [ ] T100 [US4] Add `useDomainUsage()` query hook using `useQuery(orpc.organizationDomain.getUsage.queryOptions())`

#### Frontend - Pages

- [ ] T101 [US4] Create `apps/web/src/app/(app)/organization/domains/page.tsx` with complete domain management dashboard (depends on T091-T100)
- [ ] T102 [US4] Create `apps/web/src/app/(app)/organization/domains/[domainId]/page.tsx` - domain detail page with usage view
- [ ] T103 [US4] Create `apps/web/src/app/(app)/organization/domains/[domainId]/page.info.ts` route definition
- [ ] T104 [US4] Regenerate routes: `bun run web -- dr:build`

**Checkpoint**: Organization domain dashboard complete - admins have full visibility and control

---

## Phase 7: User Story 5 - Conflict Detection with Suggestions (Priority: P2)

**Goal**: Provide clear feedback when domain mapping conflicts occur, with actionable resolution suggestions

**Independent Test**: Login as Project Member → create service mapping with subdomain="api" basePath=null → attempt second mapping with same subdomain/basePath → verify: (1) system prevents duplicate, (2) error message clear, (3) suggestions include available paths like /v1, /v2

### Tests for User Story 5

- [ ] T105 [P] [US5] Create `apps/api/src/modules/domain/tests/services/conflict-suggestion.service.spec.ts` - test suggestion generation algorithm (available paths, alternative subdomains)
- [ ] T106 [P] [US5] Create `apps/api/src/modules/domain/tests/integration/conflict-detection-realtime.integration.spec.ts` - test real-time conflict checking with 500ms debounce

### Implementation for User Story 5

#### Backend - Services

- [ ] T107 [US5] Create `apps/api/src/modules/domain/services/conflict-suggestion.service.ts` with `generateSuggestions()` method returning available paths/subdomains
- [ ] T108 [US5] Update `apps/api/src/modules/domain/services/conflict-detection.service.ts` to include suggestions in conflict error response

#### Backend - Controllers

- [ ] T109 [US5] Update `apps/api/src/modules/domain/controllers/service-domain-mapping.controller.ts` `checkConflict()` to return conflict details + suggestions

#### Frontend - Components

- [ ] T110 [US5] Update `apps/web/src/components/domain/ConflictWarning.tsx` to display suggestions (available paths, alternative subdomains, link to conflicting service)

#### Frontend - Hooks

- [ ] T111 [US5] Update `apps/web/src/hooks/useServiceDomainMappings.ts` `useCheckConflict()` to include suggestions in return value

**Checkpoint**: All user stories should now be independently functional with complete conflict detection

---

## Phase 8: Organization Settings & Rate Limiting (Infrastructure)

**Purpose**: Implement configurable quotas and rate limiting per organization

### Tests

- [ ] T112 [P] Create `apps/api/src/modules/domain/tests/services/organization-settings.service.spec.ts` - test quota enforcement and limit updates
- [ ] T113 [P] Create `apps/api/src/modules/domain/tests/guards/rate-limit.guard.spec.ts` - test verification rate limiting (1 req/min per domain)
- [ ] T114 [P] Create `apps/api/src/modules/domain/tests/integration/quota-enforcement.integration.spec.ts` - test domain quota limit enforcement

### Implementation

#### Backend - Repositories

- [ ] T115 [P] Create `apps/api/src/modules/domain/repositories/organization-settings.repository.ts` with methods: `findByOrganization`, `create`, `update`

#### Backend - Services

- [ ] T116 Create `apps/api/src/modules/domain/services/organization-settings.service.ts` with `getOrCreateSettings()`, `updateSettings()`, `checkQuota()`, `checkRateLimit()` methods

#### Backend - Adapters

- [ ] T117 [P] Create `apps/api/src/modules/domain/adapters/organization-settings-adapter.service.ts` transforming entities to contract types

#### Backend - Controllers

- [ ] T118 Create `apps/api/src/modules/domain/controllers/organization-settings.controller.ts` with `@Implement(organizationSettingsContract.get)` and `@Implement(organizationSettingsContract.update)`
- [ ] T119 Update `apps/api/src/modules/domain/controllers/domain.controller.ts` `create()` to check domain quota before allowing creation
- [ ] T120 Update `apps/api/src/modules/domain/controllers/domain.controller.ts` `verify()` to check rate limit before triggering verification

#### Frontend - Components

- [ ] T121 [P] Create `apps/web/src/components/settings/OrganizationLimitsPanel.tsx` - settings page for quota/rate limit configuration (Owner only)

#### Frontend - Hooks

- [ ] T122 Create `apps/web/src/hooks/useOrganizationSettings.ts` using `useQuery(orpc.organizationSettings.get.queryOptions())`
- [ ] T123 Add `useUpdateSettings()` mutation hook using `useMutation(orpc.organizationSettings.update.mutate())`

#### Frontend - Pages

- [ ] T124 Create `apps/web/src/app/(app)/organization/settings/domains/page.tsx` with limits configuration interface (depends on T121, T122, T123)
- [ ] T125 Create `apps/web/src/app/(app)/organization/settings/domains/page.info.ts` route definition
- [ ] T126 Regenerate routes: `bun run web -- dr:build`

**Checkpoint**: Organization settings complete - configurable quotas enforced

---

## Phase 9: Background DNS Auto-Retry Job

**Purpose**: Implement automatic DNS verification retry every 6 hours for pending domains

### Tests

- [ ] T127 [P] Create `apps/api/src/modules/domain/tests/processors/dns-verification.processor.spec.ts` - test job execution logic, retry limit (10 attempts), status updates
- [ ] T128 [P] Create `apps/api/src/modules/domain/tests/integration/auto-retry-workflow.integration.spec.ts` - test full auto-retry cycle with mock time progression

### Implementation

- [ ] T129 Update `apps/api/src/modules/domain/processors/dns-verification.processor.ts` to implement complete retry logic:
  - Query pending domains where `retryAttempts < 10` and `nextRetryAt <= now`
  - Call `domainVerificationService.verifyDomain()`
  - Increment `retryAttempts` and update `nextRetryAt` (6 hours from now)
  - Mark as `requires_manual` after 10 failed attempts
- [ ] T130 Update `apps/api/src/modules/domain/services/domain.service.ts` to add `incrementRetryAttempts()` and `scheduleNextRetry()` methods
- [ ] T131 Register repeatable job in `apps/api/src/modules/domain/domain.module.ts` with cron `0 */6 * * *`

**Checkpoint**: Auto-retry job functional - pending domains automatically verified

---

## Phase 10: In-App Notification System

**Purpose**: Implement toast notifications and notification panel for domain events

### Tests

- [ ] T132 [P] Create `apps/web/src/components/notifications/__tests__/ToastNotification.spec.tsx` - test toast display, auto-dismiss timing, manual dismiss
- [ ] T133 [P] Create `apps/web/src/components/notifications/__tests__/NotificationPanel.spec.tsx` - test event history, unread count, mark as read

### Implementation

#### Frontend - Components

- [ ] T134 [P] Create `apps/web/src/components/notifications/ToastNotification.tsx` - toast component with auto-dismiss and manual close
- [ ] T135 [P] Create `apps/web/src/components/notifications/NotificationBell.tsx` - bell icon with unread count badge
- [ ] T136 [P] Create `apps/web/src/components/notifications/NotificationPanel.tsx` - dropdown panel with last 50 events

#### Frontend - Hooks

- [ ] T137 Create `apps/web/src/hooks/useNotifications.ts` with `showToast()`, `getHistory()`, `markAllRead()` methods
- [ ] T138 Integrate toast notifications into all domain mutation hooks:
  - `useVerifyDomain()` - success/failure toasts
  - `useCreateDomain()` - domain created toast
  - `useDeleteDomain()` - domain deleted warning
  - `useAssignDomains()` - assignment success toast
  - `useCreateMapping()` - mapping created toast, conflict warnings

#### Frontend - Layout

- [ ] T139 Add `NotificationBell` component to `apps/web/src/components/layout/Header.tsx`

**Checkpoint**: Notification system complete - all domain events provide real-time feedback

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

### Documentation

- [ ] T140 [P] Update `docs/features/DOMAIN-MANAGEMENT.md` with feature documentation (architecture, usage, troubleshooting)
- [ ] T140.5 [P] Create `specs/001-domain-management-system/quickstart.md` with developer quick start guide for domain management (installation, basic usage, common patterns)
- [ ] T141 [P] Update `apps/web/src/routes/README.md` to include new domain management routes

### Testing

- [ ] T142 [P] Create `apps/api/src/modules/domain/tests/e2e/domain-management-complete.e2e.spec.ts` - test complete workflow: org domain creation → project assignment → service mapping → verification → deletion
- [ ] T143 [P] Create `apps/api/src/modules/domain/tests/e2e/rbac-enforcement.e2e.spec.ts` - test all 4 role tiers with permission matrix
- [ ] T144 Run full test suite: `bun run test` - verify all 120+ tests pass
- [ ] T145 Run coverage report: `bun run test:coverage` - verify coverage goals (adapters 100%, services 90%+, guards 95%+)

### Code Quality

- [ ] T146 Code cleanup and refactoring - remove unused imports, consolidate duplicate logic
- [ ] T147 [P] Performance optimization - add database indexes for common queries (verification status, next retry time)
- [ ] T148 [P] Security hardening - add input validation, sanitize DNS queries, prevent SQL injection
- [ ] T149 Run linting: `bun run lint` - fix all linting errors
- [ ] T150 Run type checking: `bun run type-check` - ensure no TypeScript errors

### Validation

- [ ] T151 Run quickstart.md validation - verify all documented commands work correctly
- [ ] T152 Seed test data: `bun run api -- db:seed` - populate development database with sample domains
- [ ] T153 Manual testing - verify all user stories work end-to-end in development environment
- [ ] T153.5 [P] Create performance test script to seed 1000+ domain mappings and measure query response times (target: under 100ms for domain list queries) - validates SC-018

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion
- **User Story 2 (Phase 4)**: Depends on Foundational (Phase 2) completion - Can run parallel with US1
- **User Story 3 (Phase 5)**: Depends on US2 completion (extends service mapping)
- **User Story 4 (Phase 6)**: Depends on Foundational (Phase 2) completion - Can run parallel with US1/US2
- **User Story 5 (Phase 7)**: Depends on US2 completion (extends conflict detection)
- **Settings (Phase 8)**: Depends on Foundational (Phase 2) completion - Can run parallel with user stories
- **Auto-Retry (Phase 9)**: Depends on US4 completion (requires domain verification service)
- **Notifications (Phase 10)**: Can start after Foundational (Phase 2) - integrates with all user stories
- **Polish (Phase 11)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories - can start after Foundational phase
- **User Story 2 (P1)**: No dependencies on other stories - can start after Foundational phase
- **User Story 3 (P2)**: Extends User Story 2 - requires US2 completion
- **User Story 4 (P1)**: No dependencies on other stories - can start after Foundational phase
- **User Story 5 (P2)**: Extends User Story 2 - requires US2 completion

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD approach)
- Repositories before services
- Services before adapters
- Adapters before controllers
- Controllers before frontend components
- Frontend hooks before pages
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 1 (Setup)**: All tasks can run in parallel (T001-T003 are independent database schema changes)

**Phase 2 (Foundational)**: 
- Contracts (T007-T010) can run in parallel
- Interface types (T015-T018) can run in parallel
- DNS resolver (T019-T021) independent of other foundational work
- RBAC guards (T022-T023) independent of other foundational work
- Background job (T024-T025) independent until later phases
- Route generation (T026-T028) can run in parallel

**User Story 1 Tests**: T029-T032 can run in parallel (different test files)

**User Story 1 Implementation**:
- Repositories (T033-T034) can run in parallel
- Adapters (T037-T038) can run in parallel
- Frontend components (T042-T043) can run in parallel

**User Story 2 Tests**: T049-T053 can run in parallel

**User Story 2 Implementation**:
- Frontend components (T063-T065) can run in parallel

**Cross-Story Parallelism**:
- User Story 1, 2, and 4 can ALL be worked on in parallel after Phase 2 completes (different files, no dependencies)
- Phase 8 (Settings) can run parallel with user stories
- Phase 10 (Notifications) can start early and integrate incrementally

---

## Parallel Example: Maximum Parallelization

**After Foundational Phase Completes:**

```bash
# Team Member A: User Story 1 (Project Domain Assignment)
# 15 tasks (T029-T048)

# Team Member B: User Story 2 (Service Domain Mapping)
# 23 tasks (T049-T071)

# Team Member C: User Story 4 (Organization Dashboard)
# 33 tasks (T079-T104)

# Team Member D: Phase 8 (Organization Settings)
# 15 tasks (T112-T126)

# All four work streams are completely independent!
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, and 4 Only)

1. Complete Phase 1: Setup (6 tasks)
2. Complete Phase 2: Foundational (22 tasks - CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (20 tasks - project domain assignment)
4. Complete Phase 4: User Story 2 (23 tasks - service routing config)
5. Complete Phase 6: User Story 4 (26 tasks - organization dashboard)
6. **STOP and VALIDATE**: Test all three stories independently
7. Deploy/demo if ready

**MVP Deliverables**:
- ✅ Project admins can assign domains (with auto-registration)
- ✅ Developers can configure complete service routing
- ✅ Organization admins can manage all domains with verification
- ✅ 120+ tests passing with 90%+ coverage

### Incremental Delivery

1. **Foundation** (Phase 1 + Phase 2) → Database + Contracts Ready
2. **MVP Release 1** (Phase 3 + Phase 4 + Phase 6) → Core domain management functional
3. **MVP Release 2** (Phase 5 + Phase 7) → Add protocol config + conflict suggestions
4. **Production Release** (Phase 8 + Phase 9 + Phase 10) → Add quotas + auto-retry + notifications
5. **Polish & Launch** (Phase 11) → Documentation + testing + optimization

### Parallel Team Strategy

**With 4 developers:**

1. **Week 1**: Team completes Setup + Foundational together (28 tasks)
2. **Week 2-3**: Once Foundational is done:
   - Developer A: User Story 1 (20 tasks)
   - Developer B: User Story 2 (23 tasks)
   - Developer C: User Story 4 (26 tasks)
   - Developer D: Phase 8 Settings (15 tasks)
3. **Week 4**: Integration and testing
   - All developers: Phase 11 Polish (14 tasks)
   - All developers: Fix bugs, integration testing

---

## Task Count Summary

| Phase | Task Count | User Story | Priority | Parallelizable |
|-------|-----------|------------|----------|----------------|
| Phase 1: Setup | 6 | - | - | 3 tasks |
| Phase 2: Foundational | 22 | - | - | 12 tasks |
| Phase 3: User Story 1 | 20 | US1 | P1 | 10 tasks |
| Phase 4: User Story 2 | 23 | US2 | P1 | 11 tasks |
| Phase 5: User Story 3 | 7 | US3 | P2 | 3 tasks |
| Phase 6: User Story 4 | 26 | US4 | P1 | 12 tasks |
| Phase 7: User Story 5 | 7 | US5 | P2 | 3 tasks |
| Phase 8: Settings | 15 | - | Infrastructure | 8 tasks |
| Phase 9: Auto-Retry | 5 | - | Infrastructure | 2 tasks |
| Phase 10: Notifications | 8 | - | Infrastructure | 4 tasks |
| Phase 11: Polish | 14 | - | - | 9 tasks |
| **TOTAL** | **153 tasks** | **5 user stories** | **3 P1, 2 P2** | **77 parallelizable** |

**Test Tasks**: 42 test specification tasks (27% of total)  
**Backend Tasks**: 76 implementation tasks (50% of total)  
**Frontend Tasks**: 35 implementation tasks (23% of total)

---

## Notes

- [P] tasks = different files, no dependencies, can run in parallel
- [Story] label maps task to specific user story for traceability (US1, US2, US3, US4, US5, Setup, Foundation)
- Each user story should be independently completable and testable
- **Tests written FIRST**: All test tasks must complete and FAIL before implementation tasks
- TDD approach: Write failing tests → Implement feature → Tests pass → Refactor
- Vitest command: `bun run test` (NOT `bun test`)
- Database commands: `bun run api -- db:*` (runs in Docker container)
- Route generation: `bun run web -- dr:build` (after adding/changing routes)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- MVP = Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 6 (75 tasks)
- Full feature = All 153 tasks
