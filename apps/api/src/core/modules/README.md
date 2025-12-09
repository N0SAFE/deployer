# Core Modules Index

> **Last Updated**: 2025-01-20  
> **Status**: Documentation complete, fixes in progress  
> **Issues**: 15 total (0 Critical, 5 High, 5 Medium, 2 Low, 3 Resolved)

## Module Overview

This directory contains all CORE infrastructure modules for the deployer platform. Core modules provide foundational services that are used across the application.

### Architecture Rules

1. **Core modules provide ONLY services** - No controllers, no processors
2. **Core modules should not import feature modules** - Only other core modules
3. **Use module imports, not direct service imports** - Proper dependency injection
4. **Global modules (`@Global()`) don't need imports** - Available everywhere

## Module Status

| Module | Status | Issues | Documentation |
|--------|--------|--------|---------------|
| `auth/` | ✅ Stable | None | [docs/](./auth/docs/) |
| `builders/` | ✅ Stable | None | [docs/](./builders/docs/) |
| `constants/` | ✅ Stable | None | [docs/](./constants/docs/) |
| `context/` | ✅ Stable | None | [docs/](./context/docs/) |
| `database/` | ✅ Stable | None | [docs/](./database/docs/) |
| `deployment/` | ✅ Stable | None | [docs/](./deployment/docs/) |
| `docker/` | ✅ Fixed | [~~Inverted deps~~](#resolved) | [docs/](./docker/docs/) |
| `domain/` | 🟡 Medium | [Controllers](#critical-issues) | [docs/](./domain/docs/) |
| `environment/` | 🟠 High | [Missing module](#critical-issues) | [docs/](./environment/docs/) |
| `events/` | 🟢 Low | [Empty](#critical-issues) | [docs/](./events/docs/) |
| `git/` | 🟠 Deprecated | [To merge](#critical-issues) | [docs/](./git/docs/) |
| `github/` | 🟠 Deprecated | [To merge](#critical-issues) | [docs/](./github/docs/) |
| `identifier-resolver/` | 🟠 High | [Cross-layer](#critical-issues) | [docs/](./identifier-resolver/docs/) |
| `orchestration/` | 🟡 Improved | [O1 Fixed, O2-O3 Pending](#critical-issues) | [docs/](./orchestration/docs/) |
| `providers/` | ✅ Stable | [Minor issues](#providers-module-issues) | [docs/](./providers/docs/) |
| `projects/` | ✅ Stable | None | [docs/](./projects/docs/) |
| `service/` | ✅ Stable | None | [docs/](./service/docs/) |
| `storage/` | ✅ Stable | None | [docs/](./storage/docs/) |
| `traefik/` | ✅ Stable | None | [docs/](./traefik/docs/) |

## Critical Issues

**See [CRITICAL-ISSUES.md](./docs/CRITICAL-ISSUES.md) for detailed tracking.**

### ✅ Resolved

1. ~~**Missing ProvidersModule**~~ - ✅ CREATED on 2025-11-30
   - `providers/providers.module.ts`, `providers/github/*`, `providers/static/*` created

2. ~~**Docker Inverted Dependencies**~~ - ✅ FIXED on 2025-01-20
   - Moved `ZombieCleanupService` to new `CleanupModule` in feature layer (`/modules/cleanup/`)
   - `DockerModule` now exports only `DockerService` with no dependencies

3. ~~**Docker Cross-Layer Import**~~ - ✅ FIXED on 2025-01-20
   - Part of Docker fix - no more cross-layer imports in DockerModule

4. ~~**Orchestration Direct Imports (O1)**~~ - ✅ FIXED on 2025-01-20
   - Now imports `GitModule` and `CoreStorageModule` instead of direct service imports
   - Re-exports modules for downstream consumers

### 🟠 High (5 issues remaining)

5. **Orchestration Circular Dependency (O2)** - Uses `forwardRef` with CoreDeploymentModule
6. **Git/GitHub Deprecated** - Should use `providers/github/` instead
7. **Identifier-Resolver Cross-Layer** - Imports from feature module
8. **Environment Missing Module** - No `environment.module.ts` file

### 🟡 Medium (5 issues)

9. **Domain Controllers in Core** - Controllers should be in feature module
10. **Provider Clone Not Implemented** - `cloneRepository()` is placeholder
11. **Provider Cross-Module Repos** - Imports from `core/modules/github/`
12. **Orchestration @Global() (O3)** - Too many global exports

### 🟢 Low (2 issues)

13. **Events Module Empty** - No providers or exports
14. **Manual Provider Registration** - Should use discovery

## Module Dependency Graph

```
                    ┌─────────────────────────────────────────────────┐
                    │                   DATABASE                      │
                    │              (foundation layer)                 │
                    └─────────────────────────────────────────────────┘
                                         │
           ┌─────────────────────────────┼─────────────────────────────┐
           ▼                             ▼                             ▼
    ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
    │   DOCKER    │              │   TRAEFIK   │              │   EVENTS    │
    │  (@Global)  │              │             │              │             │
    └─────────────┘              └─────────────┘              └─────────────┘
           │                             │
           ▼                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                           PROVIDERS (TODO)                          │
    │     ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │
    │     │   GITHUB    │   │   STATIC    │   │   GITLAB    │            │
    │     │  Provider   │   │  Provider   │   │  Provider   │            │
    │     └─────────────┘   └─────────────┘   └─────────────┘            │
    └─────────────────────────────────────────────────────────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                            BUILDERS                                 │
    │     ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │
    │     │ Dockerfile  │   │  Nixpack    │   │  Buildpack  │            │
    │     └─────────────┘   └─────────────┘   └─────────────┘            │
    └─────────────────────────────────────────────────────────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                           DEPLOYMENT                                │
    │  (Orchestrates providers, builders, containers, routing)            │
    └─────────────────────────────────────────────────────────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                         ORCHESTRATION                               │
    │  (Queue management, resource allocation, health monitoring)         │
    └─────────────────────────────────────────────────────────────────────┘
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                      FEATURE MODULES                                │
    │  (Controllers, processors, API endpoints)                           │
    └─────────────────────────────────────────────────────────────────────┘
```

## Adding New Modules

When adding a new core module:

1. Create directory structure:
   ```
   new-module/
   ├── new-module.module.ts
   ├── services/
   │   └── new-module.service.ts
   ├── repositories/
   │   └── new-module.repository.ts (if DB access needed)
   ├── interfaces/
   │   └── types.ts
   ├── docs/
   │   ├── README.md
   │   └── ARCHITECTURE.md
   └── index.ts
   ```

2. Follow naming conventions:
   - Module class: `Core{Name}Module` or `{Name}Module`
   - Service class: `{Name}Service`
   - Repository class: `{Name}Repository`

3. Update this index document

4. Add to `core.module.ts` exports if needed

## Documentation Standards

Each module should have a `docs/` folder containing:

- **README.md** (Required)
  - Overview and purpose
  - Services provided
  - Quick start example
  - API reference summary
  
- **ARCHITECTURE.md** (Required for complex modules)
  - Component responsibilities
  - Data flow diagrams
  - Dependency graph
  - Integration points

- **API-REFERENCE.md** (Optional)
  - Detailed method documentation
  - Type definitions
  - Usage examples

## Quick Links

- [Critical Issues](./docs/CRITICAL-ISSUES.md) - Compilation blockers and architecture issues
- [Domain Module](./domain/docs/) - Reference implementation for documentation
- [Traefik Module](./traefik/docs/) - Reference implementation for documentation
- [Builders Module](./builders/docs/) - Registry pattern example
