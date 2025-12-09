# Critical Architecture Issues - Core Modules

> **Status**: 🟠 ACTIVE ISSUES  
> **Last Updated**: 2025-11-30  
> **Total Issues**: 16 (0 Critical, 5 High, 6 Medium, 2 Low, 3 Resolved)

## Quick Navigation

| Module | Severity | Issue Count | Status |
|--------|----------|-------------|--------|
| [Providers](#providers-module) | 🟡 Medium | 4 | ✅ Documented |
| [Docker](#docker-module) | ✅ Resolved | 2 | ✅ Fixed |
| [Orchestration](#orchestration-module) | 🟠 High | 3 remaining | ⚠️ O1 Fixed, O2-O4 Pending |
| [Git/GitHub](#gitgithub-modules) | 🟠 High | 2 | ⚠️ Deprecated |
| [Identifier-Resolver](#identifier-resolver-module) | 🟠 High | 2 | ⚠️ Needs Fix |
| [Environment](#environment-module) | 🟠 High | 1 | ⚠️ Incomplete |
| [Domain](#domain-module) | 🟡 Medium | 1 | ℹ️ Note |
| [Events](#events-module) | 🟢 Low | 1 | ℹ️ Empty |

---

## Providers Module

> **Status**: ✅ Created  
> **Docs**: [providers/docs/](../providers/docs/)

### Issue P1: `cloneRepository()` Not Implemented 🟡 MEDIUM

**Location**: `providers/github/github-provider.service.ts:cloneRepository()`

```typescript
async cloneRepository(config: GithubProviderConfig, targetPath: string): Promise<{ success: boolean }> {
  // TODO: Implement actual git clone
  // For now, create a placeholder
  await mkdir(targetPath, { recursive: true });
  const placeholderFile = join(targetPath, 'README.md');
  await writeFile(placeholderFile, `# Placeholder\nRepository cloning not yet implemented.`);
  return { success: true };
}
```

**Impact**: Any code path using git clone gets a placeholder file instead of actual repository.

**Resolution**: Implement using simple-git:
```typescript
import simpleGit from 'simple-git';
const git = simpleGit();
await git.clone(tokenUrl, targetPath, ['--depth', '1', '--branch', config.branch]);
```

---

### Issue P2: Cross-Module Repository Imports 🟡 MEDIUM

**Location**: `providers/github/github-provider.module.ts`

**Problem**: Imports repositories from `@/core/modules/github/repositories/`:
- `GithubRepositoryConfigRepository`
- `GithubDeploymentRulesRepository`
- `GithubDeploymentCacheRepository`

**Impact**: Creates hard dependency on external module structure.

**Resolution**: Either:
1. Move repositories to `providers/github/repositories/`, OR
2. Import `GitHubModule` properly, OR
3. Consolidate when git/github modules are deprecated

---

### Issue P3: Static Provider Heavy Dependencies 🟡 MEDIUM

**Location**: `providers/static/static-provider.module.ts`

```typescript
imports: [DatabaseModule, ProjectsModule, OrchestrationModule]
```

**Problem**: Heavy module dependencies for static file provider.

**Impact**: 
- Circular dependency risk if Projects/Orchestration need Providers
- Testing complexity - need to mock entire modules

**Resolution**: Extract interfaces and inject via tokens.

---

### Issue P4: Manual Provider Registration 🟢 LOW

**Location**: `providers/services/provider-registry-initializer.service.ts`

**Problem**: Must manually update initializer when adding new providers.

**Resolution**: Use NestJS DiscoveryService for auto-registration:
```typescript
const providers = this.discovery.getProviders()
  .filter(w => w.instance instanceof BaseProviderService)
  .map(w => w.instance as IProvider);
```

---

## Docker Module

> **Status**: ✅ RESOLVED  
> **Docs**: [docker/docs/](../docker/docs/)

### Issue D1: Inverted Dependencies ✅ RESOLVED

**Location**: `docker/docker.module.ts` (now fixed)

**Previous Problem**:
```typescript
// ❌ BEFORE: Wrong dependency direction
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ProjectModule } from '@/modules/project/project.module';
import { ServiceModule } from '@/core/modules/service/service.module';

@Global()
@Module({
  imports: [
    forwardRef(() => CoreDeploymentModule),  // ❌ WRONG DIRECTION
    forwardRef(() => ProjectModule),          // ❌ CROSS-LAYER DEPENDENCY
    ServiceModule,                            // ❌ WRONG DIRECTION
  ],
})
```

**Resolution Applied** (2025-01-20):
1. ✅ Created new `CleanupModule` in feature layer (`/modules/cleanup/`)
2. ✅ `CleanupModule` imports `DockerModule` (global), `DeploymentModule`, `ProjectModule`, `ServiceModule`
3. ✅ `DockerModule` now exports only `DockerService` with no dependencies
4. ✅ Moved `ZombieCleanupService` to `CleanupModule`

**Current Clean Architecture**:
```typescript
// ✅ AFTER: Clean infrastructure module
@Global()
@Module({
  providers: [DockerService],
  exports: [DockerService],
})
export class DockerModule {}

// modules/cleanup/cleanup.module.ts
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreDeploymentModule,
    ProjectModule,
    ServiceModule,
    // DockerModule is @Global, available implicitly
  ],
  providers: [ZombieCleanupService],
  exports: [ZombieCleanupService],
})
export class CleanupModule {}
```

---

### Issue D2: Cross-Layer Dependency ✅ RESOLVED

**Location**: `docker/docker.module.ts` (now fixed)

**Previous Problem**: Core module imported from feature module (`@/modules/project/`).

**Resolution Applied**: Part of Issue D1 fix - `ZombieCleanupService` moved to feature-layer `CleanupModule`, eliminating the cross-layer import from DockerModule.

---

## Orchestration Module

> **Status**: 🟠 HIGH (2 remaining issues)  
> **Docs**: [orchestration/docs/](../orchestration/docs/)

### Issue O1: Direct Service Imports ✅ RESOLVED

**Location**: `orchestration/orchestration.module.ts` (now fixed)

**Previous Problem**:
```typescript
// ❌ BEFORE: Direct service imports
import { GitService } from '@/core/modules/git/services/git.service';
import { FileUploadService } from '@/core/modules/storage/services/file-upload.service';

@Module({
  providers: [
    GitService,        // ❌ Instantiates service twice
    FileUploadService, // ❌ Instantiates service twice
  ],
})
```

**Resolution Applied** (2025-01-20):
```typescript
// ✅ AFTER: Module imports
import { GitModule } from '@/core/modules/git/git.module';
import { CoreStorageModule } from '@/core/modules/storage/storage.module';

@Module({
  imports: [
    GitModule,          // ✅ Proper dependency injection
    CoreStorageModule,  // ✅ Proper dependency injection
  ],
  exports: [
    GitModule,          // ✅ Re-export for consumers
    CoreStorageModule,  // ✅ Re-export for consumers
  ],
})
```

---

### Issue O2: Circular Dependency with Deployment 🟠 HIGH

**Location**: `orchestration/orchestration.module.ts`

```typescript
forwardRef(() => CoreDeploymentModule)
```

**Problem**: Uses `forwardRef` to break circular dependency with `CoreDeploymentModule`.

**Cycle Path**:
```
OrchestrationModule
  └─→ CoreDeploymentModule
       └─→ StaticProviderModule
            └─→ OrchestrationModule (circular!)
```

**Impact**: Fragile, can break with module reorganization.

**Resolution Options**:
- Option A: Move TraefikService out of OrchestrationModule into dedicated module
- Option B: StaticProviderModule uses TraefikCoreModule instead of OrchestrationModule
- Option C: Extract shared interfaces/tokens to break cycle

---

### Issue O3: @Global() on Complex Module 🟡 MEDIUM

**Location**: `orchestration/orchestration.module.ts` line 1

```typescript
@Global()
@Module({...})
export class OrchestrationModule {}
```

**Problem**: Module exports 20+ services/repositories globally.

**Impact**:
- Pollutes global scope
- Makes it harder to track dependencies
- Any module can use these services implicitly

**Recommendation**: Remove `@Global()`, require explicit imports where needed.

---

### Issue O4: Duplicate TraefikService 🟡 MEDIUM

**Locations**: 
- `orchestration/services/traefik.service.ts` (968 lines) - Heavy, uses Bull queue, Docker
- `traefik/services/traefik.service.ts` (474 lines) - Clean facade over repository/filesystem

**Problem**: Two different TraefikService implementations exist:
1. **Orchestration's TraefikService**: Monolithic, handles Docker, Bull queue, SSL generation
2. **TraefikCoreModule's TraefikService**: Clean architecture, facade pattern

**Impact**:
- Confusion about which service to use
- Duplicate repositories (TraefikRepository in both)
- Different APIs for similar functionality

**Resolution**: 
1. Consolidate to use TraefikCoreModule's cleaner implementation
2. Move orchestration-specific features to dedicated services
3. Delete orchestration/services/traefik.service.ts and related repository

---

## Git/GitHub Modules

> **Status**: 🟠 DEPRECATED  
> **Docs**: [git/docs/](../git/docs/), [github/docs/](../github/docs/)

### Issue G1: Scattered Responsibility 🟠 HIGH

**Problem**: Git operations split across two modules:
- `GitModule` → `GitService` (cloning, extraction)
- `GitHubModule` → `GitHubService` (GitHub API, OAuth)

Both are needed for GitHub deployments but aren't coordinated.

**Resolution**: Already done - `providers/github/` module consolidates this. These modules should be:
1. Marked as deprecated
2. Removed once all usages migrate to `GithubProviderService`

---

### Issue G2: Duplicated with Providers 🟠 HIGH

**Problem**: `git/` and `github/` functionality now duplicated in `providers/github/`.

**Current State**:
- `OrchestrationModule` imports `GitService` directly
- `providers/github/` has its own `GithubProviderService`

**Resolution**:
1. Update all usages to use `providers/github/`
2. Delete `git/` and `github/` directories

---

## Identifier-Resolver Module

> **Status**: 🟠 HIGH

### Issue IR1: Cross-Layer Repository Import 🟠 HIGH

**Location**: `identifier-resolver/identifier-resolver.module.ts` line 4

```typescript
import { ProjectRepository } from '@/modules/project/repositories/project.repository';
```

**Problem**: Core module imports from feature module.

**Impact**: Violates architecture layering rules.

**Resolution**: Either:
1. Move `ProjectRepository` to core, OR
2. Create `IdentifierResolverInterface` and implement in feature module, OR
3. Move `IdentifierResolverModule` to feature layer

---

### Issue IR2: Repository Duplication 🟠 HIGH

**Location**: `identifier-resolver/identifier-resolver.module.ts` lines 8-9

```typescript
providers: [
  IdentifierResolverService,
  ProjectRepository,         // Duplicate - also in ProjectModule
  EnvironmentRepository,     // Duplicate - also in EnvironmentModule?
],
```

**Problem**: Repositories declared in multiple modules.

**Impact**: Multiple instances, potential state inconsistency.

**Resolution**: Import modules instead of repositories:
```typescript
@Module({
  imports: [ProjectModule, EnvironmentModule],
  providers: [IdentifierResolverService],
})
```

---

## Environment Module

> **Status**: 🟠 HIGH

### Issue E1: Missing Module File 🟠 HIGH

**Location**: `environment/`

**Problem**: Directory contains only `repositories/environment.repository.ts` but no `environment.module.ts`.

**Current State**:
```
environment/
└── repositories/
    └── environment.repository.ts
```

**Impact**:
- `EnvironmentRepository` referenced by `IdentifierResolverModule` but no module exports it
- Inconsistent structure compared to other modules

**Resolution**: Create `environment.module.ts`:
```typescript
@Module({
  imports: [DatabaseModule],
  providers: [EnvironmentRepository],
  exports: [EnvironmentRepository],
})
export class EnvironmentModule {}
```

---

## Domain Module

> **Status**: 🟡 MEDIUM  
> **Docs**: [domain/docs/](../domain/docs/)

### Issue DM1: Controllers in Core Module 🟡 MEDIUM

**Location**: `domain/domain.module.ts` lines 9-11

```typescript
controllers: [
  OrganizationDomainController,
  ProjectDomainController,
  ServiceDomainController,
],
```

**Problem**: Core modules should provide ONLY services, not controllers.

**Architecture Rule**: Controllers belong in feature modules.

**Resolution**: Move controllers to a feature module:
```
modules/domain/              ← Feature module
├── domain.module.ts         ← Controllers here
├── controllers/
│   ├── organization-domain.controller.ts
│   ├── project-domain.controller.ts
│   └── service-domain.controller.ts

core/modules/domain/         ← Core module
├── domain.module.ts         ← Services only
└── services/
```

---

## Events Module

> **Status**: 🟢 LOW

### Issue EV1: Empty Module 🟢 LOW

**Location**: `events/events.module.ts`

```typescript
@Global()
@Module({
  providers: [],
  exports: [],
})
export class EventsModule {}
```

**Problem**: Module is empty - no providers, no exports.

**Question**: Is this intentional placeholder? If so, add comment. If not, either:
1. Implement event infrastructure (EventEmitter, etc.)
2. Delete if not needed

---

## Summary Action Plan

### Phase 1: Critical Fixes 🔴 ✅ COMPLETE
1. ✅ **Create CleanupModule** - Extracted `ZombieCleanupService` from DockerModule
2. ✅ **Fix DockerModule** - Removed inverted dependencies
3. ✅ **Fix OrchestrationModule O1** - Import modules instead of direct services

### Phase 2: High Priority 🟠
4. **Create EnvironmentModule** - Add missing module file
5. **Fix OrchestrationModule O2** - Break circular dependency with CoreDeploymentModule
6. **Fix IdentifierResolverModule** - Import modules or move to feature layer
7. **Deprecate Git/GitHub Modules** - Update usages to providers

### Phase 3: Medium Priority 🟡
8. **Move Domain Controllers** - To feature module
9. **Fix Provider Issues** - Cross-module imports, implement clone
10. **Remove @Global()** - From OrchestrationModule (O3)
11. **Consolidate TraefikService** - Remove duplicate in OrchestrationModule (O4)

### Phase 4: Low Priority 🟢
12. **Clean up EventsModule** - Implement or remove
13. **Auto-registration** - Add discovery-based provider registration
14. **Standardize Naming** - Consistent module naming conventions

---

## Verification Checklist

After fixing all issues:

- [ ] `bun run type-check` passes
- [ ] `bun run build` succeeds  
- [x] No `forwardRef` in DockerModule ✅
- [x] No cross-layer imports in DockerModule (core → feature) ✅
- [x] No direct service imports in OrchestrationModule (O1 fixed) ✅
- [ ] All modules follow consistent naming
- [ ] All modules have index.ts exports
- [ ] git/ and github/ directories deprecated/deleted
- [x] providers/ directory complete ✅
- [ ] environment.module.ts exists
- [x] CleanupModule created with ZombieCleanupService ✅
- [x] OrchestrationModule imports GitModule + CoreStorageModule ✅
