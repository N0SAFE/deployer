# Core Module Architecture

> Updated: October 3, 2025
> 
> This document describes the architecture of the Core Module and how circular dependencies are handled.

## Architecture Principle

**The CoreModule is a Pure Aggregator**

- `CoreModule` imports and re-exports all core modules
- Individual core modules **DO NOT** import `CoreModule`
- Individual core modules import only the specific modules they need
- Use `forwardRef()` only when there's a **direct** circular dependency between two specific modules

## Module Dependency Graph

### Foundation Layer (No Dependencies)

```
GitModule
  └── No imports (pure service)

DatabaseModule
  └── No imports (infrastructure)
```

### Infrastructure Layer

```
DockerModule
  ├── DatabaseModule
  └── forwardRef(() => DeploymentModule)  // Circular

ProjectsModule
  └── DatabaseModule

OrchestrationModule
  ├── DatabaseModule
  ├── DockerModule
  └── BullModule (external)
```

### Provider Layer

```
GitHubProviderModule
  ├── DatabaseModule
  └── GitHubModule

StaticProviderModule
  ├── DatabaseModule
  ├── DockerModule
  ├── forwardRef(() => ProjectsModule)
  └── OrchestrationModule

ProvidersModule (Aggregator)
  ├── GitHubProviderModule
  └── StaticProviderModule
```

### Service Layer

```
DeploymentModule
  ├── DatabaseModule
  ├── forwardRef(() => DockerModule)  // Circular
  └── forwardRef(() => StaticProviderModule)  // Circular via CoreModule

CoreStorageModule
  ├── DatabaseModule
  ├── forwardRef(() => ProvidersModule)
  └── BullModule
```

### Builder Layer

```
DockerfileBuilderModule
  └── DockerModule

NixpackBuilderModule
  └── DockerModule

BuildpackBuilderModule
  └── DockerModule

DockerComposeBuilderModule
  └── DockerModule

StaticBuilderModule
  ├── DockerModule
  └── forwardRef(() => StaticProviderModule)

BuildersModule (Aggregator)
  ├── DockerfileBuilderModule
  ├── NixpackBuilderModule
  ├── BuildpackBuilderModule
  ├── StaticBuilderModule
  └── DockerComposeBuilderModule
```

### Integration Layer

```
GitHubModule
  ├── DatabaseModule
  └── EnvModule (external)
```

### Aggregator Layer

```
CoreModule (Top-level Aggregator)
  ├── DockerModule
  ├── GitModule
  ├── DeploymentModule
  ├── ProjectsModule
  ├── OrchestrationModule
  ├── ProvidersModule
  ├── BuildersModule
  ├── DatabaseModule
  ├── GitHubModule
  └── CoreStorageModule
```

## Circular Dependencies

The following circular dependencies are properly handled with `forwardRef()`:

### 1. Docker ↔ Deployment

```
DockerModule ⇄ DeploymentModule
```

**Reason:** 
- `DockerModule` has `ZombieCleanupService` which needs `DeploymentService`
- `DeploymentModule` has `DeploymentService` which needs `DockerService`

**Resolution:**
- Both modules use `forwardRef()` to import each other

### 2. Deployment → StaticProvider

```
DeploymentModule → StaticProviderModule → OrchestrationModule
```

**Reason:**
- `DeploymentModule` needs `StaticProviderService`
- `StaticProviderModule` imports `OrchestrationModule`

**Resolution:**
- `DeploymentModule` uses `forwardRef(() => StaticProviderModule)`

### 3. Storage → Providers

```
CoreStorageModule ⇄ ProvidersModule
```

**Reason:**
- `CoreStorageModule` needs provider services
- Provider modules may need storage services

**Resolution:**
- `CoreStorageModule` uses `forwardRef(() => ProvidersModule)`

### 4. StaticProvider → Projects

```
StaticProviderModule ⇄ ProjectsModule
```

**Reason:**
- `StaticProviderModule` may need `ProjectServerService`
- May be circular in the future

**Resolution:**
- `StaticProviderModule` uses `forwardRef(() => ProjectsModule)`

### 5. StaticBuilder → StaticProvider

```
StaticBuilderModule ⇄ StaticProviderModule
```

**Reason:**
- `StaticBuilderModule` needs `StaticProviderService`
- May be circular

**Resolution:**
- `StaticBuilderModule` uses `forwardRef(() => StaticProviderModule)`

## Benefits of This Architecture

1. **Clear Dependency Flow**: Each module explicitly declares its dependencies
2. **No CoreModule Coupling**: Core modules don't depend on the aggregator
3. **Minimal forwardRef Usage**: Only used where truly circular
4. **Better Testability**: Modules can be tested independently
5. **Clearer Intent**: Import statements show exact dependencies
6. **Easier Debugging**: Circular dependency errors point to specific modules

## Rules for Adding New Core Modules

1. **Never import CoreModule** from a core module
2. Import only the **specific modules** you need
3. Use `forwardRef()` **only** when there's a proven circular dependency
4. Document circular dependencies in module comments
5. Keep the dependency graph as flat as possible
6. Prefer composition over deep nesting

## Feature Module Usage

Feature modules should import `CoreModule` to get access to all core services:

```typescript
import { Module } from '@nestjs/common';
import { CoreModule } from '@/core/core.module';

@Module({
  imports: [CoreModule],
  // ... feature module setup
})
export class MyFeatureModule {}
```

This gives the feature module access to all core services without creating circular dependencies.

## Troubleshooting Circular Dependencies

If you encounter a circular dependency error:

1. **Identify the cycle**: Look at the error stack trace
2. **Check if it's legitimate**: Is the cycle necessary?
3. **Add forwardRef()**: Use on both sides of the cycle
4. **Test thoroughly**: Ensure services are properly injected
5. **Document it**: Add comments explaining why the cycle exists

### Common Patterns

**Service needs another service from a different module:**
```typescript
@Module({
  imports: [
    forwardRef(() => OtherModule), // Use forwardRef if circular
  ],
})
```

**Constructor injection with circular dependency:**
```typescript
constructor(
  @Inject(forwardRef(() => OtherService))
  private readonly otherService: OtherService,
) {}
```

## Migration Notes

**Before (Old Pattern):**
```typescript
import { CoreModule } from '@/core/core.module';

@Module({
  imports: [forwardRef(() => CoreModule)],
})
```

**After (New Pattern):**
```typescript
import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';

@Module({
  imports: [
    DatabaseModule,
    DockerModule,
  ],
})
```

This change:
- ✅ Eliminates unnecessary circular dependencies
- ✅ Makes dependencies explicit and clear
- ✅ Improves module initialization order
- ✅ Reduces coupling between modules
- ✅ Makes testing easier
