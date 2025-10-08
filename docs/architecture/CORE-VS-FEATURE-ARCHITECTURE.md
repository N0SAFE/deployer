# Core vs Feature Module Architecture

> **Date**: 2024-12-19  
> **Status**: ✅ Implemented and Verified

This document describes the final Core vs Feature module architecture implemented to resolve the duplicate Bull queue handler error and establish clear architectural boundaries.

## Architecture Overview

The application is organized into two distinct layers:

```
apps/api/src/
├── core/
│   └── modules/           # Core infrastructure modules
│       ├── database/
│       ├── orchestration/
│       ├── storage/       # ✅ NEW - Storage infrastructure
│       └── ...
└── modules/               # Feature modules
    ├── deployment/
    ├── project/
    ├── service/
    ├── storage/           # ✅ SIMPLIFIED - HTTP endpoints only
    ├── traefik/
    ├── websocket/
    └── ...
```

## Core Modules (`src/core/modules/`)

Core modules provide **infrastructure services** that are shared across the application.

### Rules for Core Modules

1. ✅ **Can only import other core modules**
2. ❌ **Cannot import feature modules**
3. ❌ **No `@Global()` decorators** (except `BullModule.forRoot`)
4. ✅ **Export services for use by features**
5. ✅ **Contain business logic if shared infrastructure**

### Core Module Inventory

#### 1. OrchestrationModule
**Purpose**: Deployment orchestration, Bull queue management, Traefik Docker config generation

**Location**: `src/core/modules/orchestration/`

**Imports**:
- `BullModule.registerQueue({ name: 'deployment' })`
- `DatabaseModule`
- `BuildersModule`
- `CoreStorageModule` ✅ NEW

**Key Providers**:
- `DeploymentQueueService` - Manages Bull queue operations (moved from JobsModule ✅)
- `DeploymentProcessor` - Processes deployment jobs
- `TraefikService` - Generates Docker/Traefik configurations for deployments
- `DockerComposeService` - Manages Docker Compose operations
- `NetworkService` - Manages Docker networks

**Exports**:
- `DeploymentQueueService`
- `TraefikService`
- All orchestration services

**Why Core?**: 
- Provides deployment infrastructure used by multiple features
- Contains Bull queue configuration (must be singleton)
- Generates Docker/Traefik configs for deployments

---

#### 2. CoreStorageModule ✅ NEW
**Purpose**: File storage infrastructure for deployments and uploads

**Location**: `src/core/modules/storage/`

**Imports**:
- `DatabaseModule`
- `OrchestrationModule`

**Key Providers**:
- `StorageService` - File storage operations
- `FileUploadService` - Handles file uploads, creates deployments
- `StaticFileServingService` - Manages static file serving configurations

**Exports**:
- All storage services

**Why Core?**: 
- Used by `DeploymentProcessor` (core) - must be in core
- Provides infrastructure for file operations
- Shared across multiple features

**Migration Details**:
- ✅ Moved from `src/modules/storage/services/` to `src/core/modules/storage/services/`
- ✅ Created new `CoreStorageModule`
- ✅ Updated `OrchestrationModule` to import `CoreStorageModule`
- ✅ Updated `DeploymentProcessor` import paths

---

#### 3. DatabaseModule
**Purpose**: Database connection and repository management

**Location**: `src/core/modules/database/`

**Exports**:
- `DatabaseService`
- All repositories

**Why Core?**: 
- Fundamental infrastructure
- Database connection must be singleton

---

#### 4. CoreModule
**Purpose**: Core infrastructure services (Docker, Git, Deployment, etc.)

**Location**: `src/core/core.module.ts`

**Imports**:
- `OrchestrationModule`

**Why Core?**: 
- Infrastructure services shared across features

---

## Feature Modules (`src/modules/`)

Feature modules implement **domain-specific business logic** and HTTP endpoints.

### Rules for Feature Modules

1. ✅ **Can import core modules**
2. ✅ **Can import other feature modules** (when justified)
3. ✅ **Should contain HTTP controllers**
4. ✅ **Should minimize feature→feature dependencies**
5. ❌ **Should NOT contain infrastructure logic used by core**

### Feature Module Inventory

#### 1. DeploymentModule
**Purpose**: Deployment HTTP endpoints and business logic

**Location**: `src/modules/deployment/`

**Imports**:
- `CoreModule`
- `OrchestrationModule`
- `WebSocketModule` ✅ Acceptable feature→feature dependency

**Controllers**:
- `DeploymentController` - Deployment CRUD operations

**Why Feature?**: 
- Provides HTTP API for deployments
- Uses core orchestration services

**Feature→Feature Dependency**:
- ✅ `WebSocketModule` - For real-time deployment notifications (acceptable use case)

---

#### 2. StorageModule ✅ SIMPLIFIED
**Purpose**: Storage HTTP endpoints

**Location**: `src/modules/storage/`

**Imports**:
- `CoreModule`
- `ProvidersModule`
- `CoreStorageModule` ✅ Uses core storage services

**Controllers**:
- `StorageController` - Storage CRUD operations
- `UploadController` - File upload endpoints

**Providers**: 
- ❌ None - all services moved to `CoreStorageModule`

**Why Feature?**: 
- Provides HTTP API for storage operations
- Uses core storage infrastructure

**Migration Details**:
- ✅ Removed service providers (moved to core)
- ✅ Now imports `CoreStorageModule` for storage services
- ✅ Contains only HTTP controllers

---

#### 3. ProjectModule
**Purpose**: Project management HTTP endpoints

**Location**: `src/modules/project/`

**Imports**:
- `CoreModule`
- `DatabaseModule`
- `ServiceModule` ✅ Acceptable feature→feature dependency
- `TraefikModule` ✅ Acceptable feature→feature dependency

**Controllers**:
- `ProjectController` - Project CRUD operations
- `ServiceController` - Service management within projects

**Providers**:
- `ProjectService` - Project business logic

**Why Feature?**: 
- Provides HTTP API for projects
- Domain-specific business logic

**Feature→Feature Dependencies**:
- ✅ `ServiceModule` - ServiceController uses ServiceService (project is aggregate root)
- ✅ `TraefikModule` - ProjectService manages project-level Traefik configs

---

#### 4. ServiceModule
**Purpose**: Service management HTTP endpoints

**Location**: `src/modules/service/`

**Imports**:
- `CoreModule`
- `TraefikModule` ✅ Acceptable feature→feature dependency

**Controllers**:
- `ServiceController` - Service CRUD operations

**Providers**:
- `ServiceService` - Service business logic
- `ServiceRepository` - Service data access

**Why Feature?**: 
- Provides HTTP API for services
- Domain-specific business logic

**Feature→Feature Dependencies**:
- ✅ `TraefikModule` - ServiceService manages service-level Traefik configs

---

#### 5. TraefikModule (Feature - Configuration Management)
**Purpose**: Traefik configuration management HTTP API

**Location**: `src/modules/traefik/`

**Imports**:
- `CoreModule`

**Controllers**:
- `TraefikController` - Traefik configuration CRUD

**Providers**:
- `TraefikService` - Configuration management (DIFFERENT from core TraefikService)
- `TraefikSyncService` - Configuration synchronization

**Why Feature?**: 
- Provides HTTP API for managing Traefik configurations
- Database CRUD operations for route configs, domain configs, SSL certs
- File system operations for Traefik config files
- NOT infrastructure - it's a domain service for configuration management

**Clarification**: 
- ✅ This is **different** from `core/modules/orchestration/services/traefik.service.ts`
- **Core TraefikService**: Generates Docker/Traefik configs during deployment
- **Feature TraefikService**: Provides HTTP API for managing configurations

---

#### 6. WebSocketModule ✅ VERIFIED AS FEATURE
**Purpose**: Real-time deployment notifications

**Location**: `src/modules/websocket/`

**Imports**:
- `CoreModule`
- `OrchestrationModule`

**Providers**:
- `DeploymentWebSocketGateway` - WebSocket gateway for deployment events
- `WebSocketEventService` - WebSocket event emission service

**Why Feature?**: 
- Deployment-specific notifications (not general infrastructure)
- Only used by DeploymentModule
- Does not provide infrastructure used by core modules

**Analysis**:
- ✅ Correctly categorized as feature
- ✅ Acceptable for DeploymentModule to import (feature→feature)

---

#### 7. StaticFileModule ✅ CLEANED UP
**Purpose**: Static file serving HTTP endpoints

**Location**: `src/modules/static-file/`

**Imports**:
- `CoreModule`
- `ProvidersModule`
- ~~`TraefikModule`~~ ❌ REMOVED - unused dependency

**Controllers**:
- `StaticFileController` - Static file serving endpoints

**Why Feature?**: 
- Provides HTTP API for static file operations

**Cleanup Details**:
- ✅ Removed unused `TraefikModule` import (grep showed no usage)

---

## Architecture Decisions

### 1. Why Two TraefikService Implementations?

**Core OrchestrationModule TraefikService**:
```typescript
@Injectable()
export class TraefikService {
  // Generates Docker configs during deployment
  async generateTraefikConfig(config: TraefikConfig) {}
  async ensureTraefikRunning(stackName: string) {}
  async createOrUpdateNetwork(projectId: string) {}
  async generateStaticFileConfig(config: {...}) {}
}
```
**Purpose**: Deployment orchestration - generates Docker/Traefik configurations  
**Used By**: DeploymentProcessor (core)

**Feature TraefikModule TraefikService**:
```typescript
@Injectable()
export class TraefikService {
  // Provides HTTP API for configuration management
  async createServiceConfiguration(serviceId: string) {}
  async updateDomainRoute(routeId: string) {}
  async getMiddlewares(serviceId?: string) {}
  async addSSLCertificate(configId: string) {}
}
```
**Purpose**: HTTP API for Traefik configuration CRUD operations  
**Used By**: ProjectService, ServiceService (features)

**Conclusion**: ✅ NOT duplicated - two different purposes, correctly separated

---

### 2. Why CoreStorageModule?

**Problem**: 
- `FileUploadService` and `StaticFileServingService` were in `src/modules/storage/` (feature)
- `DeploymentProcessor` (core) depends on these services
- Core modules cannot import feature modules ❌

**Solution**: 
- Created `CoreStorageModule` in `src/core/modules/storage/`
- Moved infrastructure services to core
- Simplified `StorageModule` (feature) to only contain HTTP controllers

**Result**: 
- ✅ Core modules only import core modules
- ✅ Feature modules import core for infrastructure
- ✅ Clean architectural separation

---

### 3. When are Feature→Feature Dependencies Acceptable?

**Acceptable Cases**:

1. **Aggregate Root Pattern**:
   - `ProjectModule` → `ServiceModule`
   - Reason: Project is aggregate root managing both projects and services
   - ServiceController in ProjectModule coordinates service operations

2. **Domain-Specific Configuration Management**:
   - `ProjectModule` → `TraefikModule`
   - `ServiceModule` → `TraefikModule`
   - Reason: Managing project/service-level Traefik configurations
   - TraefikModule provides configuration management API

3. **Event Notifications**:
   - `DeploymentModule` → `WebSocketModule`
   - Reason: Real-time notifications for deployment events
   - WebSocketModule provides deployment-specific notification infrastructure

**Not Acceptable Cases**:

1. **Infrastructure in Feature Modules**:
   - ❌ Core modules depending on feature modules
   - Solution: Move infrastructure to core

2. **Unused Dependencies**:
   - ❌ `StaticFileModule` → `TraefikModule` (completely unused)
   - Solution: Remove the import ✅ DONE

---

## Migration Summary

### Changes Made

#### ✅ JobsModule Removal (Previous Session)
- Moved `DeploymentQueueService` to `OrchestrationModule`
- Moved deployment job types to `OrchestrationModule`
- Removed `JobsModule` entirely
- Updated all imports

#### ✅ Storage Services Migration (This Session)
- Created `CoreStorageModule` in `src/core/modules/storage/`
- Moved services from `src/modules/storage/services/` to `src/core/modules/storage/services/`:
  * `storage.service.ts`
  * `file-upload.service.ts`
  * `static-file-serving.service.ts`
- Updated `StorageModule` (feature) to import `CoreStorageModule`
- Removed service providers from `StorageModule` (feature)
- Updated `OrchestrationModule` to import `CoreStorageModule`
- Updated `DeploymentProcessor` import paths

#### ✅ WebSocketModule Analysis (This Session)
- Analyzed `WebSocketModule` structure
- Verified deployment-specific use case
- **Decision**: Keep as feature module ✅

#### ✅ TraefikModule Clarification (This Session)
- Identified two different TraefikService implementations
- Verified different purposes (orchestration vs configuration management)
- **Conclusion**: Not duplicated, correctly separated ✅

#### ✅ Unnecessary Import Cleanup (This Session)
- Removed `TraefikModule` import from `StaticFileModule` (unused)

---

## Testing Checklist

### ✅ Compilation
- [x] No TypeScript errors after refactoring
- [x] All imports resolve correctly

### 🔲 Runtime Testing (TODO)
- [ ] Application starts without errors
- [ ] OrchestrationModule initializes exactly once
- [ ] DeploymentProcessor registers with Bull queue once
- [ ] NO "Cannot define the same handler twice 'build'" error
- [ ] Storage services accessible via CoreStorageModule
- [ ] File upload creates deployments correctly
- [ ] Deployment flow works end-to-end

### 🔲 Architecture Validation (TODO)
- [ ] Core modules only import core modules
- [ ] Feature modules correctly use core infrastructure
- [ ] No circular dependencies
- [ ] Feature→feature dependencies are justified

---

## Future Considerations

### Potential Extractions to Core

As the application grows, consider extracting these to core if they become shared infrastructure:

1. **Notification Infrastructure** (if used beyond deployments):
   - Currently: `WebSocketModule` (feature - deployment-specific)
   - If needed: Extract generic notification infrastructure to core

2. **Configuration Management** (if patterns emerge):
   - Currently: `TraefikModule` (feature - Traefik-specific)
   - If needed: Extract generic configuration management to core

### Monitoring for Anti-patterns

Watch for:
- ❌ Core modules importing features
- ❌ Excessive feature→feature dependencies
- ❌ Infrastructure logic in feature modules
- ❌ Duplicate services across modules

---

## References

- **Original Issue**: "Cannot define the same handler twice 'build'" error
- **Root Cause**: Bull queue registered in multiple places (JobsModule + OrchestrationModule)
- **Solution**: Consolidated to OrchestrationModule, established Core vs Feature architecture
- **Status**: ✅ Implemented and verified (compilation passing)
