# Service Adapter Pattern: Core Services with Feature Adapters

> **Purpose**: Architectural pattern for separating business logic (core services) from contract transformations (feature adapters)  
> **Date**: 2024-12-XX  
> **Status**: 📝 Specification

---

## TL;DR - The Three Golden Rules

### 1. 🎯 Services: Composable Methods Returning Entities
```typescript
// ✅ DO: Generic, reusable methods
findById(id: string): Promise<Service>
getTraefikConfig(id: string): Promise<TraefikConfig>

// ❌ DON'T: Endpoint-specific methods with contract types
getServiceById(id: string): Promise<ServiceContract>
```

### 2. 🔧 Adapters: Fixed Contract Output Types
```typescript
// ✅ DO: Exact contract type from @repo/api-contracts
type ServiceContract = typeof serviceContract.getById.output;
adaptToContract(service, config): ServiceContract { ... }

// ❌ DON'T: Generic types or service calls
async adaptToContract(id: string): Promise<any> { ... }
```

### 3. 🎭 Controllers: Orchestrate and Mix Service Methods
```typescript
// ✅ DO: Mix multiple service methods
const service = await this.service.findById(id);
const config = await this.service.getTraefikConfig(id);
return this.adapter.adaptToContract(service, config);

// ❌ DON'T: Just delegate to one service method
return this.service.getServiceById(id);
```

**Key Principle**: Controllers mix composable service methods and pass aggregated data to adapters with fixed contract return types.

---

## Quick Visual Guide

### ❌ Anti-Pattern: 1:1 Service-Controller Mapping

```
Controller Method 1 ──→ Service Method 1 ──→ Returns Contract Type
Controller Method 2 ──→ Service Method 2 ──→ Returns Contract Type
Controller Method 3 ──→ Service Method 3 ──→ Returns Contract Type

Problem: 
- Service methods tied to specific endpoints
- Contract types in service layer
- No reusability, tight coupling
```

### ✅ Correct Pattern: Composable Services + Fixed-Type Adapters

```
Controller Method 1 ─┬─→ Service.findById() ──→ Returns Entity
                     ├─→ Service.getConfig() ──→ Returns Partial Entity  
                     └─→ Service.getStats() ──→ Returns Partial Entity
                            ↓
                     Adapter.adaptToContract() ──→ Returns ServiceContract
                     (Fixed output type)


Controller Method 2 ─┬─→ Service.findById() ──→ Returns Entity (reused!)
                     └─→ Service.getConfig() ──→ Returns Partial Entity (reused!)
                            ↓
                     Adapter.adaptToBasicContract() ──→ Returns BasicContract
                     (Different fixed output type)

Benefits:
✅ Service methods reusable across endpoints
✅ Controllers orchestrate and mix methods
✅ Adapters have fixed contract types
✅ Clean separation of concerns
```

## Folder Structure

### Feature Module Organization

Every feature module MUST follow this exact folder structure:

```
apps/api/src/modules/[feature-name]/
├── adapters/              # ✅ Adapter services (contract transformations)
│   ├── [feature]-adapter.service.ts
│   └── [feature]-adapter.service.spec.ts
├── controllers/           # HTTP endpoints
│   ├── [feature].controller.ts
│   └── [feature].controller.spec.ts
├── interfaces/            # ✅ Type definitions and interfaces
│   ├── [feature].types.ts
│   └── [feature].interfaces.ts
├── services/              # Feature-specific business logic (optional)
│   ├── [feature].service.ts
│   └── [feature].service.spec.ts
├── [feature].module.ts    # Module definition
└── index.ts               # Barrel exports
```

### Folder Rules

#### 1. `adapters/` Folder (Required)
- **Purpose**: Contract transformation services
- **Contents**: All `*-adapter.service.ts` files
- **Rule**: ✅ ALL adapter services MUST be in `adapters/`, NOT in `services/`
- **Why**: Clear separation between business logic (services) and transformations (adapters)

#### 2. `interfaces/` Folder (Required)
- **Purpose**: Type definitions and interfaces
- **Contents**: 
  - `*.types.ts` - Type aliases extracted from contracts
  - `*.interfaces.ts` - Interface definitions
  - DTOs (Data Transfer Objects)
- **Rule**: ✅ ALL types and interfaces MUST be in `interfaces/`, NOT inline in services/adapters
- **Why**: Centralized type definitions, reusable across the module, easier to maintain

#### 3. `services/` Folder (Optional)
- **Purpose**: Feature-specific business logic that doesn't belong in core
- **Contents**: Feature-specific services (not adapters)
- **Rule**: Only use if you have feature-specific logic; otherwise rely on core services

#### 4. `controllers/` Folder (Required)
- **Purpose**: HTTP endpoints
- **Contents**: All `*.controller.ts` files
- **Rule**: Controllers orchestrate core services and adapters

### Example: Project Feature Module

```
apps/api/src/modules/project/
├── adapters/
│   ├── service-adapter.service.ts       # ✅ Adapters in adapters/
│   ├── project-adapter.service.ts
│   └── deployment-adapter.service.ts
├── controllers/
│   ├── project.controller.ts
│   └── service.controller.ts
├── interfaces/
│   ├── service.types.ts                 # ✅ Types in interfaces/
│   ├── project.types.ts
│   └── deployment.types.ts
├── services/
│   └── project-specific.service.ts      # Optional feature logic
├── project.module.ts
└── index.ts
```

### Type Definition Pattern

**Extract contract types in `interfaces/*.types.ts`**:

```typescript
// interfaces/service.types.ts
import { serviceContract } from '@repo/api-contracts';

// Extract exact output types from contracts
export type ServiceContract = typeof serviceContract.getById.output;
export type ServiceListContract = typeof serviceContract.list.output;
export type ServiceWithStatsContract = typeof serviceContract.listByProject.output[number];
export type ServiceBasicContract = typeof serviceContract.getBasicInfo.output;

// Custom types specific to this feature
export interface ServiceAggregateData {
  service: Service;
  config: TraefikConfig | null;
  stats: ServiceStats;
}
```

**Import types in adapters**:

```typescript
// adapters/service-adapter.service.ts
import { ServiceContract, ServiceWithStatsContract } from '../interfaces/service.types';

@Injectable()
export class ServiceAdapterService {
  adaptToContract(...): ServiceContract { ... }  // ✅ Uses imported type
  adaptWithStats(...): ServiceWithStatsContract[] { ... }
}
```

### Why This Structure?

1. **Clear Separation**: 
   - `adapters/` = contract transformations
   - `services/` = business logic
   - `interfaces/` = type definitions
   - `controllers/` = HTTP endpoints

2. **Easy Navigation**: 
   - Need an adapter? → Look in `adapters/`
   - Need a type? → Look in `interfaces/`
   - Need an endpoint? → Look in `controllers/`

3. **Maintainability**:
   - Types centralized in `interfaces/` (single source of truth)
   - Adapters isolated from services (clear boundaries)
   - Easy to find and update contract types

4. **Scalability**:
   - Add new adapters without cluttering `services/`
   - Add new types without cluttering adapter files
   - Clear structure as module grows

---

## Table of Contents

1. [Folder Structure](#folder-structure)
2. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Core Services](#core-services)
4. [Feature Adapters](#feature-adapters)
5. [Controller Orchestration](#controller-orchestration)
6. [Complete Data Flow](#complete-data-flow)
7. [Implementation Examples](#implementation-examples)
8. [Best Practices](#best-practices)
9. [Migration Guide](#migration-guide)
10. [Summary](#summary)

---

## Overview

This pattern separates **business logic** from **contract transformations** by introducing three distinct layers with specific responsibilities:

```
Controller (Orchestration Layer)
    ↓
    ├─→ Service Method 1 (Returns Entity/Partial)
    ├─→ Service Method 2 (Returns Entity/Partial)
    └─→ Service Method 3 (Returns Entity/Partial)
         ↓
    Aggregate Data
         ↓
Feature Adapter (Transformation Layer - Fixed Contract Output)
    ↓
API Response (Exact Contract Format)
```

### Core Principles

1. **Services Have Composable Public Methods**
   - Services provide **reusable, focused methods** that return entities or partial entities
   - Controllers **mix and match** service methods to gather needed data
   - **NOT** one service method per controller endpoint (avoid 1:1 mapping)

2. **Adapters Have Fixed Contract Output Types**
   - Adapter return types are **exact contract types** (e.g., `ServiceContract`)
   - Methods like `adaptToContract(...inputs): ServiceContract { return {...adaptedOutput} }`
   - TypeScript guarantees contract compliance at compile-time

3. **Controllers Orchestrate, Don't Delegate**
   - Controllers **combine multiple service method calls**
   - Aggregate results from different service methods
   - Pass aggregated data to adapters for transformation
   - **NOT** simple delegation to a single service method

### Key Differences from Infrastructure Core/Feature Pattern

This document describes a **different architectural concern** than the existing `CORE-VS-FEATURE-ARCHITECTURE.md`:

| Aspect | Infrastructure Pattern (Existing Doc) | Service Adapter Pattern (This Doc) |
|--------|--------------------------------------|-----------------------------------|
| **Purpose** | Module organization & dependencies | Method design & data transformation |
| **Scope** | Where modules live (`core/` vs `modules/`) | How services return data |
| **Focus** | Avoiding circular dependencies | Separating business logic from contracts |
| **Layer** | Module/Package level | Service/Method level |
| **Example** | `CoreStorageModule` vs `StorageModule` | `ServiceService.findById()` vs `ServiceAdapterService.adaptToContract()` |

**Both patterns work together**:
- Infrastructure pattern: Determines module location (`core/modules/service/` vs `modules/project/`)
- Service adapter pattern: Determines method design within those modules

---

## Architecture Principles

### 1. Core Services Return Pure Entities (Not Contract Types)

**Core services** contain business logic and return **domain entities** or **partial entities**. Services should provide **reusable, composable methods** that controllers can mix and match.

#### ✅ GOOD - Composable Service Methods

```typescript
class ServiceService {
  // Generic methods that return entities
  async findById(id: string): Promise<Service | null> {
    return this.serviceRepository.findById(id);
  }
  
  async findByProject(projectId: string): Promise<Service[]> {
    return this.serviceRepository.findByProject(projectId);
  }
  
  // Partial entity methods that controllers can combine
  async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
    return this.serviceRepository.getTraefikConfigByService(serviceId);
  }
  
  async getHealthCheckConfig(serviceId: string): Promise<HealthCheckConfig | null> {
    return this.serviceRepository.getHealthCheckConfigByService(serviceId);
  }
  
  async getStats(serviceId: string): Promise<{ deploymentCount: number; uptime: number }> {
    return this.serviceRepository.getServiceStats(serviceId);
  }
}
```

**Why this is good:**
- ✅ Methods return pure entities/partial entities
- ✅ Each method has a single, focused responsibility
- ✅ Controllers can **mix and match** methods (e.g., `findById()` + `getTraefikConfig()` + `getStats()`)
- ✅ Same methods reusable across different endpoints
- ✅ No contract knowledge in core service

#### ❌ BAD - Endpoint-Specific Service Methods

```typescript
class ServiceService {
  // ❌ One method per endpoint - not composable
  async getServiceById(id: string): Promise<ServiceContract> {
    const service = await this.repository.findById(id);
    const config = await this.getTraefikConfig(id);
    return this.transformToContract(service, config); // ❌ Contract transformation in core
  }
  
  // ❌ Another endpoint-specific method - duplicates logic
  async listServicesByProject(projectId: string): Promise<ServiceContract[]> {
    const services = await this.repository.findByProject(projectId);
    return services.map(s => this.transformToContract(s, ...)); // ❌ Same transformation
  }
}
```

**Why this is bad:**
- ❌ One service method per controller endpoint (1:1 mapping)
- ❌ Contract transformation logic in core service
- ❌ Methods cannot be reused for different response shapes
- ❌ Controllers just delegate, don't orchestrate

### 2. Feature Adapters Transform to Contracts (Fixed Output Types)

**Feature adapters** receive data as parameters and return **exact contract types**. The adapter signature must match the contract output exactly.

#### ✅ GOOD - Adapter with Fixed Contract Output Type

```typescript
import { serviceContract } from '@repo/api-contracts';

// Extract exact output type from contract
type ServiceContract = typeof serviceContract.getById.output;
type ServiceWithStatsContract = typeof serviceContract.listByProject.output[number];

class ServiceAdapterService {
  // ✅ Return type EXACTLY matches contract output
  adaptServiceToContract(
    service: Service,
    traefikConfig: TraefikConfig | null,
    healthCheckConfig: HealthCheckConfig | null
  ): ServiceContract {  // ← Fixed output type from contract
    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      traefikConfig: this.transformTraefikConfig(traefikConfig),
      healthCheckConfig: this.transformHealthCheckConfig(healthCheckConfig),
      // ... all fields required by ServiceContract
    };
  }
  
  // ✅ Return type EXACTLY matches array item from contract
  adaptServicesWithStatsToContract(
    services: Service[],
    traefikConfigs: Map<string, TraefikConfig | null>,
    stats: Map<string, { deploymentCount: number; uptime: number }>
  ): ServiceWithStatsContract[] {  // ← Fixed output type from contract
    return services.map(service => ({
      ...this.adaptServiceToContract(service, traefikConfigs.get(service.id), null),
      deploymentCount: stats.get(service.id)?.deploymentCount || 0,
      uptime: stats.get(service.id)?.uptime || 0,
    }));
  }
}
```

**Why this is good:**
- ✅ Return type is `ServiceContract` (imported from contract) - guarantees type safety
- ✅ TypeScript ensures all contract fields are present
- ✅ Contract changes automatically caught by compiler
- ✅ Adapter receives ALL data as parameters (no service calls)

#### ❌ BAD - Adapter Calling Services or Without Fixed Types

```typescript
class ServiceAdapterService {
  constructor(
    private serviceService: ServiceService,  // ❌ Service dependency
    private traefikService: TraefikService   // ❌ Service dependency
  ) {}
  
  // ❌ Calls services internally instead of receiving data
  // ❌ Return type not explicitly fixed to contract
  async adaptServiceToContract(id: string): Promise<any> {  // ❌ No fixed type
    const service = await this.serviceService.findById(id); // ❌ Service call in adapter
    const config = await this.traefikService.getConfig(id);  // ❌ Service call in adapter
    return this.transform(service, config);
  }
}
```

**Why this is bad:**
- ❌ Adapter depends on services (should receive data as parameters)
- ❌ Adapter makes async calls (should be pure transformation)
- ❌ Return type is `any` or generic `Promise<T>` (not contract-specific)
- ❌ No compile-time guarantee that output matches contract

### 3. Controllers Orchestrate and Mix Service Methods

**Controllers** are the **orchestration layer**. They:
1. Call **multiple composable service methods** 
2. Combine/aggregate the results
3. Pass aggregated data to **adapters**
4. Return **contract types**

Controllers should **mix and match** service methods, not just call one service method per endpoint.

#### ✅ GOOD - Controller Orchestrates Multiple Service Methods

```typescript
@Controller('services')
export class ServiceController {
  constructor(
    private coreServiceService: ServiceService,      // Core business logic
    private serviceAdapter: ServiceAdapterService     // Contract transformation
  ) {}
  
  @Implement(serviceContract.getById)
  async getById(input: { id: string }) {
    // Step 1: Mix multiple service methods to gather data
    const service = await this.coreServiceService.findById(input.id);
    const traefikConfig = await this.coreServiceService.getTraefikConfig(input.id);
    const healthCheckConfig = await this.coreServiceService.getHealthCheckConfig(input.id);
    
    // Step 2: Pass aggregated data to adapter
    return this.serviceAdapter.adaptServiceToContract(
      service,
      traefikConfig,
      healthCheckConfig
    );
  }
  
  @Implement(serviceContract.listByProject)
  async listByProject(input: { projectId: string }) {
    // Step 1: Mix service methods - fetch services + stats
    const services = await this.coreServiceService.findByProject(input.projectId);
    
    // Step 2: Aggregate additional data for all services
    const traefikConfigs = new Map();
    const stats = new Map();
    
    await Promise.all(
      services.map(async (service) => {
        // Mix multiple service methods per service
        const [config, serviceStats] = await Promise.all([
          this.coreServiceService.getTraefikConfig(service.id),
          this.coreServiceService.getStats(service.id),
        ]);
        traefikConfigs.set(service.id, config);
        stats.set(service.id, serviceStats);
      })
    );
    
    // Step 3: Pass aggregated data to adapter
    return this.serviceAdapter.adaptServicesWithStatsToContract(
      services,
      traefikConfigs,
      stats
    );
  }
}
```

**Why this is good:**
- ✅ Controller **mixes** multiple service methods (`findById()` + `getTraefikConfig()` + `getHealthCheckConfig()`)
- ✅ Same service methods reused across different endpoints
- ✅ Controller orchestrates data aggregation
- ✅ Adapter receives all data as parameters (pure transformation)
- ✅ Clear separation: services (business logic) → controller (orchestration) → adapter (transformation)

#### ❌ BAD - Controller Just Delegates to One Service Method

```typescript
@Controller('services')
export class ServiceController {
  constructor(private serviceService: ServiceService) {}
  
  @Implement(serviceContract.getById)
  async getById(input: { id: string }) {
    // ❌ Just delegates to single service method (1:1 mapping)
    return this.serviceService.getServiceById(input.id);
  }
  
  @Implement(serviceContract.listByProject)
  async listByProject(input: { projectId: string }) {
    // ❌ Just delegates to single service method (1:1 mapping)
    return this.serviceService.listServicesByProject(input.projectId);
  }
}
```

**Why this is bad:**
- ❌ Controller doesn't orchestrate - just delegates
- ❌ One service method per controller endpoint (tight coupling)
- ❌ Service methods cannot be reused for different response shapes
- ❌ All orchestration logic is in service layer (wrong layer)
- ❌ Controller becomes a thin, useless wrapper

---

## Core Services

### Location
```
apps/api/src/core/modules/service/services/service.service.ts
```

### Responsibilities

1. **Business Logic**: Domain rules, validations, calculations
2. **Data Access**: Coordinate with repositories
3. **Return Entities**: Pure domain entities or partial entities
4. **Composable Methods**: Provide focused, reusable methods (not endpoint-specific)
5. **NO Contract Knowledge**: Never import or reference contract types

### The Anti-Pattern: Endpoint-Specific Service Methods

This is what we want to **AVOID**:

```typescript
// ❌ ANTI-PATTERN - One method per controller endpoint
@Injectable()
export class ServiceService {
  
  // ❌ Method specifically for "get by id" endpoint
  async getServiceById(id: string): Promise<ServiceContract> {
    const service = await this.repository.findById(id);
    const traefikConfig = await this.getTraefikConfig(id);
    const healthCheck = await this.getHealthCheckConfig(id);
    return this.transformToContract(service, traefikConfig, healthCheck);
  }
  
  // ❌ Method specifically for "list by project" endpoint
  async listServicesByProject(projectId: string): Promise<ServiceContract[]> {
    const services = await this.repository.findByProject(projectId);
    return services.map(s => this.transformToContract(s, ...));
  }
  
  // ❌ Method specifically for "get with stats" endpoint
  async getServiceWithStats(id: string): Promise<ServiceWithStatsContract> {
    const service = await this.repository.findById(id);
    const stats = await this.repository.getStats(id);
    return { ...this.transformToContract(service), ...stats };
  }
}
```

**Problems with this approach:**
1. ❌ **1:1 mapping** - One service method for each controller endpoint
2. ❌ **Contract coupling** - Service returns contract types (`ServiceContract`)
3. ❌ **Not reusable** - `getServiceById()` only works for one specific endpoint
4. ❌ **Duplication** - Same transformation logic repeated in multiple methods
5. ❌ **Controller is useless** - Just delegates to service, no orchestration
6. ❌ **Tight coupling** - Contract changes require changing core service

### The Correct Pattern: Composable Service Methods

This is what we want to **IMPLEMENT**:

```typescript
// ✅ CORRECT PATTERN - Composable methods returning entities
@Injectable()
export class ServiceService {
  constructor(private serviceRepository: ServiceRepository) {}

  // ✅ Generic method - returns entity
  async findById(id: string): Promise<Service | null> {
    return this.serviceRepository.findById(id);
  }

  // ✅ Generic method - returns entities array
  async findByProject(projectId: string): Promise<Service[]> {
    return this.serviceRepository.findByProject(projectId);
  }

  // ✅ Focused method - returns partial entity (config data)
  async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
    const service = await this.findById(serviceId);
    if (!service) return null;
    
    // Business logic to construct config
    return {
      domain: service.domain,
      port: service.port,
      protocol: service.protocol,
      sslEnabled: service.sslEnabled,
      // ... pure entity data
    };
  }

  // ✅ Focused method - returns partial entity (health check data)
  async getHealthCheckConfig(serviceId: string): Promise<HealthCheckConfig | null> {
    const service = await this.findById(serviceId);
    if (!service?.healthCheckEnabled) return null;
    
    // Business logic to construct config
    return {
      path: service.healthCheckPath,
      interval: service.healthCheckInterval,
      timeout: service.healthCheckTimeout,
      retries: service.healthCheckRetries,
      // ... pure entity data
    };
  }

  // ✅ Focused method - returns stats (partial entity)
  async getStats(serviceId: string): Promise<{ deploymentCount: number; uptime: number }> {
    return this.serviceRepository.getServiceStats(serviceId);
  }
  
  // ✅ Focused method - returns deployments (related entities)
  async getDeployments(serviceId: string, filters?: DeploymentFilters): Promise<Deployment[]> {
    return this.serviceRepository.getDeploymentsByService(serviceId, filters);
  }
  
  // ✅ Focused method - returns dependencies (related entities)
  async getDependencies(serviceId: string): Promise<ServiceDependency[]> {
    return this.serviceRepository.getServiceDependencies(serviceId);
  }
}
```

**Benefits of this approach:**
1. ✅ **Composable** - Controller can mix `findById()` + `getTraefikConfig()` + `getStats()`
2. ✅ **Reusable** - Same methods work for multiple endpoints with different response shapes
3. ✅ **Pure entities** - Returns domain entities, not contract types
4. ✅ **No duplication** - Each method has single responsibility
5. ✅ **Controller orchestrates** - Controller decides what to combine
6. ✅ **Loose coupling** - Contract changes don't affect service layer

### How Controllers Mix Service Methods

```typescript
// Example: Different endpoints using same service methods
@Controller()
export class ServiceController {
  constructor(
    private service: ServiceService,
    private adapter: ServiceAdapterService
  ) {}
  
  // Endpoint 1: Service with traefik config only
  @Implement(contract.getBasicInfo)
  async getBasicInfo(input: { id: string }) {
    const service = await this.service.findById(input.id);
    const traefikConfig = await this.service.getTraefikConfig(input.id);
    
    return this.adapter.adaptServiceToBasicContract(service, traefikConfig);
  }
  
  // Endpoint 2: Service with full config (traefik + health check)
  @Implement(contract.getFullInfo)
  async getFullInfo(input: { id: string }) {
    const service = await this.service.findById(input.id);
    const traefikConfig = await this.service.getTraefikConfig(input.id);
    const healthCheck = await this.service.getHealthCheckConfig(input.id);
    
    return this.adapter.adaptServiceToFullContract(service, traefikConfig, healthCheck);
  }
  
  // Endpoint 3: Service with stats
  @Implement(contract.getWithStats)
  async getWithStats(input: { id: string }) {
    const service = await this.service.findById(input.id);
    const stats = await this.service.getStats(input.id);
    const deployments = await this.service.getDeployments(input.id);
    
    return this.adapter.adaptServiceWithStatsContract(service, stats, deployments);
  }
}
```

**Notice:**
- Same `findById()` method used in all three endpoints
- Same `getTraefikConfig()` used in multiple endpoints
- Controller **mixes different combinations** based on endpoint needs
- Service layer is **completely reusable**

### Structure

```typescript
import { Injectable } from '@nestjs/common';
import { ServiceRepository } from '../repositories/service.repository';
import { Service, TraefikConfig, HealthCheckConfig } from '../entities';

@Injectable()
export class ServiceService {
  constructor(private serviceRepository: ServiceRepository) {}

  // ✅ Generic method names (not endpoint-specific)
  async findById(id: string): Promise<Service | null> {
    return this.serviceRepository.findById(id);
  }

  async findByProject(projectId: string): Promise<Service[]> {
    return this.serviceRepository.findByProject(projectId);
  }

  async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
    const service = await this.findById(serviceId);
    if (!service) return null;
    
    // Business logic to construct config
    return {
      domain: service.domain,
      port: service.port,
      protocol: service.protocol,
      // ... pure entity data
    };
  }

  async getHealthCheckConfig(serviceId: string): Promise<HealthCheckConfig | null> {
    const service = await this.findById(serviceId);
    if (!service?.healthCheckEnabled) return null;
    
    // Business logic to construct config
    return {
      path: service.healthCheckPath,
      interval: service.healthCheckInterval,
      timeout: service.healthCheckTimeout,
      // ... pure entity data
    };
  }

  async getServiceStats(serviceId: string): Promise<{ deploymentCount: number; uptime: number }> {
    // Business logic for statistics
    return this.serviceRepository.getServiceStats(serviceId);
  }
}
```

### What Core Services Should NOT Do

- ❌ Import contract types from `@repo/api-contracts`
- ❌ Transform data to match contract formats
- ❌ Have endpoint-specific method names (e.g., `listServicesByProject`)
- ❌ Return contract types (`ServiceContract`, `ServiceWithStatsContract`)
- ❌ Know about API response structures

### What Core Services SHOULD Do

- ✅ Return domain entities (`Service`, `TraefikConfig`, `HealthCheckConfig`)
- ✅ Contain business logic and domain rules
- ✅ Coordinate with repositories for data access
- ✅ Have generic, reusable method names (`findById`, `findByProject`)
- ✅ Be usable by multiple features/controllers

---

## Feature Adapters

### Location
```
apps/api/src/modules/project/adapters/service-adapter.service.ts
```

**Folder Structure Rule**: All adapter services MUST be placed in an `adapters/` folder within the feature module, not in `services/`.

### Responsibilities

1. **Contract Transformation**: Convert entities to contract formats
2. **Fixed Return Types**: Return **exact contract types** (imported from contracts)
3. **Data as Parameters**: Receive all data as method parameters (not via service calls)
4. **Minimal Dependencies**: Depend on as few services as possible (ideally zero)
5. **Pure Transformations**: Stateless, deterministic transformations only

### Critical Requirement: Fixed Contract Output Types

**Every adapter method MUST have a return type that exactly matches the contract output type.**

```typescript
import { serviceContract } from '@repo/api-contracts';

// ✅ Extract EXACT output types from contracts
type ServiceContract = typeof serviceContract.getById.output;
type ServiceWithStatsContract = typeof serviceContract.listByProject.output[number];
type ServiceBasicContract = typeof serviceContract.getBasicInfo.output;
```

### The Anti-Pattern: Adapters Without Fixed Types

This is what we want to **AVOID**:

```typescript
// ❌ ANTI-PATTERN - Adapter without fixed contract types
@Injectable()
export class ServiceAdapterService {
  constructor(
    private serviceService: ServiceService,  // ❌ Service dependency
    private traefikService: TraefikService   // ❌ Service dependency
  ) {}
  
  // ❌ Return type is generic/any - not contract-specific
  async adaptServiceToContract(id: string): Promise<any> {
    const service = await this.serviceService.findById(id); // ❌ Service call
    const config = await this.traefikService.getConfig(id);  // ❌ Service call
    return { ...service, config }; // ❌ No guarantee this matches contract
  }
  
  // ❌ Return type not explicitly tied to contract
  adaptServices(services: Service[]): Promise<any[]> {
    return services.map(s => this.transform(s)); // ❌ What contract?
  }
}
```

**Problems with this approach:**
1. ❌ **No type safety** - Return type is `any` or generic, not contract-specific
2. ❌ **Async adapter** - Makes service calls instead of receiving data
3. ❌ **Service dependencies** - Coupled to services instead of pure transformation
4. ❌ **No contract guarantee** - No compile-time verification of contract compliance
5. ❌ **Not testable** - Requires mocking services

### The Correct Pattern: Fixed Contract Output Types

This is what we want to **IMPLEMENT**:

```typescript
import { Injectable } from '@nestjs/common';
import { serviceContract } from '@repo/api-contracts';
import { Service, TraefikConfig, HealthCheckConfig } from '@/core/modules/service/entities';

// ✅ Extract exact output types from contracts
type ServiceContract = typeof serviceContract.getById.output;
type ServiceWithStatsContract = typeof serviceContract.listByProject.output[number];
type ServiceBasicContract = typeof serviceContract.getBasicInfo.output;

@Injectable()
export class ServiceAdapterService {
  // NO service dependencies - pure transformation only
  
  // ✅ Return type EXACTLY matches contract output
  adaptServiceToContract(
    service: Service,
    traefikConfig: TraefikConfig | null,
    healthCheckConfig: HealthCheckConfig | null
  ): ServiceContract {  // ← Fixed output type
    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      domain: service.domain,
      port: service.port,
      protocol: service.protocol,
      status: service.status,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
      
      // Transform nested configs
      traefikConfig: traefikConfig ? {
        enabled: true,
        domain: traefikConfig.domain,
        port: traefikConfig.port,
        protocol: traefikConfig.protocol,
        sslEnabled: traefikConfig.sslEnabled,
      } : null,
      
      healthCheckConfig: healthCheckConfig ? {
        enabled: true,
        path: healthCheckConfig.path,
        interval: healthCheckConfig.interval,
        timeout: healthCheckConfig.timeout,
      } : null,
    };
    // TypeScript guarantees all ServiceContract fields are present ✅
  }

  // ✅ Return type EXACTLY matches array item from contract
  adaptServicesWithStatsToContract(
    services: Service[],
    traefikConfigs: Map<string, TraefikConfig | null>,
    stats: Map<string, { deploymentCount: number; uptime: number }>
  ): ServiceWithStatsContract[] {  // ← Fixed output type
    return services.map(service => {
      const traefikConfig = traefikConfigs.get(service.id) || null;
      const serviceStats = stats.get(service.id) || { deploymentCount: 0, uptime: 0 };
      
      return {
        ...this.adaptServiceToContract(service, traefikConfig, null),
        deploymentCount: serviceStats.deploymentCount,
        uptime: serviceStats.uptime,
      };
      // TypeScript guarantees all ServiceWithStatsContract fields are present ✅
    });
  }
  
  // ✅ Return type for different contract shape
  adaptServiceToBasicContract(
    service: Service,
    traefikConfig: TraefikConfig | null
  ): ServiceBasicContract {  // ← Different fixed output type
    return {
      id: service.id,
      name: service.name,
      status: service.status,
      domain: traefikConfig?.domain ?? null,
    };
    // TypeScript guarantees all ServiceBasicContract fields are present ✅
  }

  // ✅ Private helper for transformations (not exposed)
  private transformTraefikConfig(config: TraefikConfig | null) {
    if (!config) return null;
    return {
      enabled: true,
      domain: config.domain,
      port: config.port,
      protocol: config.protocol,
      sslEnabled: config.sslEnabled,
    };
  }

  private transformHealthCheckConfig(config: HealthCheckConfig | null) {
    if (!config) return null;
    return {
      enabled: true,
      path: config.path,
      interval: config.interval,
      timeout: config.timeout,
    };
  }
}
```

**Benefits of this approach:**
1. ✅ **Type safety** - Return type is exact contract type (e.g., `ServiceContract`)
2. ✅ **Compile-time guarantee** - TypeScript ensures all contract fields present
3. ✅ **Pure transformation** - No service calls, synchronous only
4. ✅ **Zero dependencies** - No service dependencies required
5. ✅ **Contract changes detected** - Compiler error if contract changes
6. ✅ **Easily testable** - Pure functions with data as parameters

### Adapter Method Signature Pattern

**Every adapter method should follow this pattern:**

```typescript
adaptTo<ContractName>(
  ...inputs: EntityOrPartialEntity[]
): ExactContractType {
  return {
    // Map entity fields to contract fields
    // TypeScript enforces all contract fields are present
  };
}
```

**Examples:**
```typescript
// Pattern: adaptTo<Contract>(...entities): ContractType
adaptServiceToContract(...): ServiceContract { ... }
adaptServicesWithStatsToContract(...): ServiceWithStatsContract[] { ... }
adaptServiceToBasicContract(...): ServiceBasicContract { ... }
adaptDeploymentToContract(...): DeploymentContract { ... }
```

### Why Fixed Output Types Matter

```typescript
// ❌ WITHOUT fixed output type
adaptService(service: Service): any {
  return { id: service.id };  // Missing fields, no compiler error
}

// ✅ WITH fixed output type
adaptService(service: Service): ServiceContract {
  return { id: service.id };  // ❌ Compiler error: missing required fields!
}
```

TypeScript **forces** you to return the exact contract shape, catching errors at compile-time instead of runtime.

### Type Definitions

**Folder Structure Rule**: All interface and type definitions MUST be placed in an `interfaces/` folder within the feature module.

```typescript
// apps/api/src/modules/project/interfaces/service.types.ts
import { serviceContract } from '@repo/api-contracts';

// Extract exact output types from contracts
export type ServiceContract = typeof serviceContract.getById.output;
export type ServiceWithStatsContract = typeof serviceContract.listByProject.output[number];
export type ServiceBasicContract = typeof serviceContract.getBasicInfo.output;
```

### Structure

```typescript
// apps/api/src/modules/project/adapters/service-adapter.service.ts
import { Injectable } from '@nestjs/common';
import { Service, TraefikConfig, HealthCheckConfig } from '@/core/modules/service/entities';
import { ServiceContract, ServiceWithStatsContract } from '../interfaces/service.types';

// Import contract output types from interfaces folder

@Injectable()
export class ServiceAdapterService {
  
  // ✅ Fixed return type from contract
  // ✅ All data passed as parameters
  adaptServiceToContract(
    service: Service,
    traefikConfig: TraefikConfig | null,
    healthCheckConfig: HealthCheckConfig | null
  ): ServiceContract {
    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      domain: service.domain,
      port: service.port,
      protocol: service.protocol,
      status: service.status,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
      
      // Transform nested configs
      traefikConfig: traefikConfig ? {
        enabled: true,
        domain: traefikConfig.domain,
        port: traefikConfig.port,
        protocol: traefikConfig.protocol,
      } : null,
      
      healthCheckConfig: healthCheckConfig ? {
        enabled: true,
        path: healthCheckConfig.path,
        interval: healthCheckConfig.interval,
        timeout: healthCheckConfig.timeout,
      } : null,
    };
  }

  // ✅ Fixed return type from contract
  // ✅ Batch transformation
  adaptServicesWithStatsToContract(
    services: Service[],
    traefikConfigs: Map<string, TraefikConfig | null>,
    healthCheckConfigs: Map<string, HealthCheckConfig | null>,
    stats: Map<string, { deploymentCount: number; uptime: number }>
  ): ServiceWithStatsContract[] {
    return services.map(service => {
      const traefikConfig = traefikConfigs.get(service.id) || null;
      const healthCheckConfig = healthCheckConfigs.get(service.id) || null;
      const serviceStats = stats.get(service.id) || { deploymentCount: 0, uptime: 0 };
      
      return {
        ...this.adaptServiceToContract(service, traefikConfig, healthCheckConfig),
        deploymentCount: serviceStats.deploymentCount,
        uptime: serviceStats.uptime,
      };
    });
  }

  // ✅ Private helper for transformations
  private transformTraefikConfig(config: TraefikConfig | null) {
    if (!config) return null;
    return {
      enabled: true,
      domain: config.domain,
      port: config.port,
      protocol: config.protocol,
    };
  }

  private transformHealthCheckConfig(config: HealthCheckConfig | null) {
    if (!config) return null;
    return {
      enabled: true,
      path: config.path,
      interval: config.interval,
      timeout: config.timeout,
    };
  }
}
```

### What Feature Adapters Should NOT Do

- ❌ Call services internally (e.g., `this.serviceService.findById()`)
- ❌ Contain business logic
- ❌ Access repositories directly
- ❌ Have multiple service dependencies
- ❌ Fetch data internally

### What Feature Adapters SHOULD Do

- ✅ Receive all data as method parameters
- ✅ Return exact contract types (imported from contracts)
- ✅ Perform pure transformations (entity → contract)
- ✅ Be stateless and deterministic
- ✅ Have minimal or no dependencies

---

## Controller Orchestration

### Location
```
apps/api/src/modules/project/controllers/service.controller.ts
```

### Pattern

Controllers **orchestrate** by:
1. Fetching data from **core services**
2. Passing data to **adapters** for transformation
3. Returning **contract types** to client

### Structure

```typescript
import { Controller } from '@nestjs/common';
import { Implement } from '@orpc/nestjs';
import { serviceContract } from '@repo/api-contracts';
import { ServiceService } from '@/core/modules/service/services/service.service';
import { ServiceAdapterService } from '../services/service-adapter.service';

@Controller()
export class ServiceController {
  constructor(
    private coreServiceService: ServiceService,      // Core business logic
    private serviceAdapter: ServiceAdapterService     // Contract transformation
  ) {}

  @Implement(serviceContract.getById)
  async getById(input: { id: string }) {
    // Step 1: Fetch entity from core
    const service = await this.coreServiceService.findById(input.id);
    if (!service) {
      throw new Error('Service not found');
    }

    // Step 2: Fetch additional data from core
    const traefikConfig = await this.coreServiceService.getTraefikConfig(input.id);
    const healthCheckConfig = await this.coreServiceService.getHealthCheckConfig(input.id);

    // Step 3: Transform via adapter
    return this.serviceAdapter.adaptServiceToContract(
      service,
      traefikConfig,
      healthCheckConfig
    );
  }

  @Implement(serviceContract.listByProject)
  async listByProject(input: { projectId: string }) {
    // Step 1: Fetch entities from core
    const services = await this.coreServiceService.findByProject(input.projectId);

    // Step 2: Fetch additional data for all services
    const traefikConfigs = new Map();
    const healthCheckConfigs = new Map();
    const stats = new Map();

    await Promise.all(
      services.map(async (service) => {
        const [traefikConfig, healthCheckConfig, serviceStats] = await Promise.all([
          this.coreServiceService.getTraefikConfig(service.id),
          this.coreServiceService.getHealthCheckConfig(service.id),
          this.coreServiceService.getServiceStats(service.id),
        ]);

        traefikConfigs.set(service.id, traefikConfig);
        healthCheckConfigs.set(service.id, healthCheckConfig);
        stats.set(service.id, serviceStats);
      })
    );

    // Step 3: Transform via adapter
    return this.serviceAdapter.adaptServicesWithStatsToContract(
      services,
      traefikConfigs,
      healthCheckConfigs,
      stats
    );
  }
}
```

### What Controllers Should NOT Do

- ❌ Contain business logic
- ❌ Access repositories directly
- ❌ Perform contract transformations
- ❌ Directly delegate to a single service method

### What Controllers SHOULD Do

- ✅ Orchestrate core service calls
- ✅ Aggregate data from multiple core services
- ✅ Pass aggregated data to adapters
- ✅ Handle HTTP-specific concerns (errors, validation)
- ✅ Return contract types via adapters

---

## Complete Data Flow

```
HTTP Request
    ↓
Controller (Orchestration Layer)
    │
    ├─→ Core Service.findById() → Entity
    │
    ├─→ Core Service.getTraefikConfig() → TraefikConfig
    │
    ├─→ Core Service.getHealthCheckConfig() → HealthCheckConfig
    │
    └─→ Adapter.adaptToContract(Entity, TraefikConfig, HealthCheckConfig)
            ↓
        Contract Type
            ↓
HTTP Response (Contract Format)
```

### Example: `GET /services/:id`

```typescript
// 1. HTTP Request
GET /services/123

// 2. Controller receives request
@Implement(serviceContract.getById)
async getById(input: { id: '123' }) {
  
  // 3. Fetch entity from core (business logic)
  const service = await this.coreServiceService.findById('123');
  // → Returns: Service { id: '123', name: 'web', projectId: 'proj1', ... }
  
  // 4. Fetch additional data from core
  const traefikConfig = await this.coreServiceService.getTraefikConfig('123');
  // → Returns: TraefikConfig { domain: 'web.example.com', port: 3000, ... }
  
  const healthCheckConfig = await this.coreServiceService.getHealthCheckConfig('123');
  // → Returns: HealthCheckConfig { path: '/health', interval: 30, ... }
  
  // 5. Transform via adapter (contract transformation)
  return this.serviceAdapter.adaptServiceToContract(
    service,
    traefikConfig,
    healthCheckConfig
  );
  // → Returns: ServiceContract { id: '123', name: 'web', traefikConfig: {...}, ... }
}

// 6. HTTP Response (Contract Format)
{
  "id": "123",
  "name": "web",
  "projectId": "proj1",
  "traefikConfig": {
    "enabled": true,
    "domain": "web.example.com",
    "port": 3000,
    "protocol": "http"
  },
  "healthCheckConfig": {
    "enabled": true,
    "path": "/health",
    "interval": 30,
    "timeout": 5
  }
}
```

---

## Implementation Examples

### Example 1: Simple GET Endpoint

**Contract** (`packages/api-contracts/index.ts`):
```typescript
export const serviceContract = o.contract({
  getById: o.route({
    method: 'GET',
    path: '/services/:id',
    input: z.object({ id: z.string() }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      projectId: z.string(),
      traefikConfig: z.object({
        enabled: z.boolean(),
        domain: z.string(),
        port: z.number(),
      }).nullable(),
    }),
  }),
});
```

**Core Service** (`core/modules/service/services/service.service.ts`):
```typescript
@Injectable()
export class ServiceService {
  constructor(private serviceRepository: ServiceRepository) {}

  async findById(id: string): Promise<Service | null> {
    return this.serviceRepository.findById(id);
  }

  async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
    const service = await this.findById(serviceId);
    if (!service) return null;

    return {
      domain: service.domain,
      port: service.port,
      protocol: service.protocol,
    };
  }
}
```

**Adapter** (`modules/project/adapters/service-adapter.service.ts`):
```typescript
// Import types from interfaces folder
import { ServiceContract } from '../interfaces/service.types';

@Injectable()
export class ServiceAdapterService {
  adaptServiceToContract(
    service: Service,
    traefikConfig: TraefikConfig | null
  ): ServiceContract {
    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      traefikConfig: traefikConfig ? {
        enabled: true,
        domain: traefikConfig.domain,
        port: traefikConfig.port,
      } : null,
    };
  }
}
```

**Controller** (`modules/project/controllers/service.controller.ts`):
```typescript
import { ServiceAdapterService } from '../adapters/service-adapter.service';

@Controller()
export class ServiceController {
  constructor(
    private coreServiceService: ServiceService,
    private serviceAdapter: ServiceAdapterService
  ) {}

  @Implement(serviceContract.getById)
  async getById(input: { id: string }) {
    const service = await this.coreServiceService.findById(input.id);
    if (!service) throw new Error('Service not found');

    const traefikConfig = await this.coreServiceService.getTraefikConfig(input.id);

    return this.serviceAdapter.adaptServiceToContract(service, traefikConfig);
  }
}
```

---

### Example 2: List with Aggregated Stats

**Contract** (`packages/api-contracts/index.ts`):
```typescript
export const serviceContract = o.contract({
  listByProject: o.route({
    method: 'GET',
    path: '/projects/:projectId/services',
    input: z.object({ projectId: z.string() }),
    output: z.array(z.object({
      id: z.string(),
      name: z.string(),
      projectId: z.string(),
      deploymentCount: z.number(),
      uptime: z.number(),
      traefikConfig: z.object({
        enabled: z.boolean(),
        domain: z.string(),
      }).nullable(),
    })),
  }),
});
```

**Core Service** (`core/modules/service/services/service.service.ts`):
```typescript
@Injectable()
export class ServiceService {
  async findByProject(projectId: string): Promise<Service[]> {
    return this.serviceRepository.findByProject(projectId);
  }

  async getServiceStats(serviceId: string): Promise<{ deploymentCount: number; uptime: number }> {
    return this.serviceRepository.getServiceStats(serviceId);
  }

  async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
    // ... same as Example 1
  }
}
```

**Adapter** (`modules/project/adapters/service-adapter.service.ts`):
```typescript
// Import types from interfaces folder
import { ServiceWithStatsContract } from '../interfaces/service.types';

@Injectable()
export class ServiceAdapterService {
  adaptServicesWithStatsToContract(
    services: Service[],
    traefikConfigs: Map<string, TraefikConfig | null>,
    stats: Map<string, { deploymentCount: number; uptime: number }>
  ): ServiceWithStatsContract[] {
    return services.map(service => ({
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      deploymentCount: stats.get(service.id)?.deploymentCount || 0,
      uptime: stats.get(service.id)?.uptime || 0,
      traefikConfig: this.transformTraefikConfig(traefikConfigs.get(service.id)),
    }));
  }

  private transformTraefikConfig(config: TraefikConfig | null) {
    if (!config) return null;
    return {
      enabled: true,
      domain: config.domain,
    };
  }
}
```

**Controller** (`modules/project/controllers/service.controller.ts`):
```typescript
@Controller()
export class ServiceController {
  @Implement(serviceContract.listByProject)
  async listByProject(input: { projectId: string }) {
    // Step 1: Fetch all services
    const services = await this.coreServiceService.findByProject(input.projectId);

    // Step 2: Fetch additional data for each service in parallel
    const traefikConfigs = new Map<string, TraefikConfig | null>();
    const stats = new Map<string, { deploymentCount: number; uptime: number }>();

    await Promise.all(
      services.map(async (service) => {
        const [traefikConfig, serviceStats] = await Promise.all([
          this.coreServiceService.getTraefikConfig(service.id),
          this.coreServiceService.getServiceStats(service.id),
        ]);

        traefikConfigs.set(service.id, traefikConfig);
        stats.set(service.id, serviceStats);
      })
    );

    // Step 3: Transform via adapter
    return this.serviceAdapter.adaptServicesWithStatsToContract(
      services,
      traefikConfigs,
      stats
    );
  }
}
```

---

## Best Practices

### Core Services

**DO**:
- ✅ Return domain entities or partial entities
- ✅ Contain business logic and domain rules
- ✅ Use generic, reusable method names
- ✅ Be stateless where possible
- ✅ Coordinate with repositories for data access
- ✅ Validate business rules and constraints

**DON'T**:
- ❌ Import contract types from `@repo/api-contracts`
- ❌ Transform data to match API contracts
- ❌ Use endpoint-specific method names (e.g., `listServicesByProject`)
- ❌ Return contract types
- ❌ Know about HTTP requests/responses

### Feature Adapters

**DO**:
- ✅ Receive all data as method parameters
- ✅ Return exact contract types (imported from contracts)
- ✅ Perform pure transformations
- ✅ Be stateless and deterministic
- ✅ Use private helpers for nested transformations
- ✅ Handle batch transformations efficiently

**DON'T**:
- ❌ Call services internally
- ❌ Contain business logic
- ❌ Access repositories
- ❌ Have service dependencies (or keep them minimal)
- ❌ Perform data fetching

### Controllers

**DO**:
- ✅ Orchestrate core service calls
- ✅ Aggregate data from multiple sources
- ✅ Pass aggregated data to adapters
- ✅ Handle HTTP-specific concerns (errors, validation)
- ✅ Use `Promise.all()` for parallel data fetching
- ✅ Return contract types via adapters

**DON'T**:
- ❌ Contain business logic
- ❌ Access repositories directly
- ❌ Perform contract transformations
- ❌ Directly delegate to a single service method
- ❌ Return raw entities

---

## Migration Guide

### Step 1: Identify Contract Transformations in Core Services

**Find methods that**:
- Return contract types (e.g., `ServiceContract`)
- Transform data to match API response formats
- Have endpoint-specific names (e.g., `getServiceById`, `listServicesByProject`)

**Example Before**:
```typescript
// ❌ Core service with contract transformation
async getServiceById(id: string): Promise<ServiceContract> {
  const service = await this.repository.findById(id);
  const config = await this.getTraefikConfig(id);
  return this.transformToContract(service, config);
}
```

### Step 2: Refactor Core Service to Return Entities

**Change methods to**:
- Return domain entities
- Use generic names
- Remove contract transformations

**Example After**:
```typescript
// ✅ Core service returns entity
async findById(id: string): Promise<Service | null> {
  return this.repository.findById(id);
}

async getTraefikConfig(serviceId: string): Promise<TraefikConfig | null> {
  const service = await this.findById(serviceId);
  if (!service) return null;
  
  return {
    domain: service.domain,
    port: service.port,
    protocol: service.protocol,
  };
}
```

### Step 3: Create Feature Adapter Service

**Create new adapter service in feature module's `adapters/` folder**:

**First, create type definitions** (`modules/project/interfaces/service.types.ts`):
```typescript
import { serviceContract } from '@repo/api-contracts';

export type ServiceContract = typeof serviceContract.getById.output;
```

**Then, create adapter service** (`modules/project/adapters/service-adapter.service.ts`):
```typescript
// modules/project/adapters/service-adapter.service.ts
import { Injectable } from '@nestjs/common';
import { serviceContract } from '@repo/api-contracts';
import { Service, TraefikConfig } from '@/core/modules/service/entities';

type ServiceContract = typeof serviceContract.getById.output;

@Injectable()
export class ServiceAdapterService {
  adaptServiceToContract(
    service: Service,
    traefikConfig: TraefikConfig | null
  ): ServiceContract {
    return {
      id: service.id,
      name: service.name,
      projectId: service.projectId,
      traefikConfig: traefikConfig ? {
        enabled: true,
        domain: traefikConfig.domain,
        port: traefikConfig.port,
      } : null,
    };
  }
}
```

### Step 4: Update Controller to Orchestrate

**Change from direct delegation to orchestration**:

**Before**:
```typescript
@Implement(serviceContract.getById)
async getById(input: { id: string }) {
  return this.serviceService.getServiceById(input.id);
}
```

**After**:
```typescript
@Implement(serviceContract.getById)
async getById(input: { id: string }) {
  // Fetch from core
  const service = await this.coreServiceService.findById(input.id);
  if (!service) throw new Error('Service not found');
  
  const traefikConfig = await this.coreServiceService.getTraefikConfig(input.id);
  
  // Transform via adapter
  return this.serviceAdapter.adaptServiceToContract(service, traefikConfig);
}
```

### Step 5: Register Adapter in Module

**Update feature module to provide adapter**:

```typescript
// modules/project/project.module.ts
import { Module } from '@nestjs/common';
import { ServiceController } from './controllers/service.controller';
import { ServiceAdapterService } from './adapters/service-adapter.service';
import { CoreModule } from '@/core/core.module';

@Module({
  imports: [CoreModule],
  controllers: [ServiceController],
  providers: [ServiceAdapterService],
  exports: [ServiceAdapterService],
})
export class ProjectModule {}
```

### Step 6: Update Tests

**Update tests to reflect new pattern**:

**Core Service Tests**:
```typescript
describe('ServiceService', () => {
  it('should return entity from findById', async () => {
    const result = await serviceService.findById('123');
    expect(result).toBeInstanceOf(Service);
    expect(result.id).toBe('123');
  });
});
```

**Adapter Tests**:
```typescript
describe('ServiceAdapterService', () => {
  it('should transform service to contract', () => {
    const service = createMockService();
    const config = createMockTraefikConfig();
    
    const result = adapter.adaptServiceToContract(service, config);
    
    expect(result.id).toBe(service.id);
    expect(result.traefikConfig).toEqual({
      enabled: true,
      domain: config.domain,
      port: config.port,
    });
  });
});
```

**Controller Tests**:
```typescript
describe('ServiceController', () => {
  it('should orchestrate core service and adapter', async () => {
    const mockService = createMockService();
    const mockConfig = createMockTraefikConfig();
    
    jest.spyOn(coreServiceService, 'findById').mockResolvedValue(mockService);
    jest.spyOn(coreServiceService, 'getTraefikConfig').mockResolvedValue(mockConfig);
    
    const result = await controller.getById({ id: '123' });
    
    expect(coreServiceService.findById).toHaveBeenCalledWith('123');
    expect(coreServiceService.getTraefikConfig).toHaveBeenCalledWith('123');
    expect(result.id).toBe('123');
    expect(result.traefikConfig).toBeDefined();
  });
});
```

---

## Summary

### Pattern Comparison

| Aspect | ❌ Anti-Pattern (Old) | ✅ Correct Pattern (New) |
|--------|---------------------|------------------------|
| **Core Service Methods** | Endpoint-specific (`getServiceById`) | Generic, composable (`findById`, `getStats`) |
| **Service Return Types** | Contract types (`ServiceContract`) | Pure entities (`Service`, `TraefikConfig`) |
| **Method Reusability** | One method per endpoint (1:1) | Same methods mixed across endpoints |
| **Adapter Return Types** | Generic/any (`Promise<any>`) | Exact contract types (`ServiceContract`) |
| **Adapter Dependencies** | Services (async calls) | Zero dependencies (pure functions) |
| **Adapter Input** | Service calls internally | All data as parameters |
| **Controller Role** | Delegates to single method | Orchestrates multiple methods |
| **Type Safety** | Runtime errors | Compile-time errors |
| **Contract Coupling** | Service knows contracts | Service independent of contracts |
| **Testability** | Requires mocking services | Pure functions, easy to test |

### The Three Golden Rules

#### 1. 🎯 **Services: Composable Methods Returning Entities**

```typescript
// ✅ DO: Provide focused, composable methods
class ServiceService {
  findById(id: string): Promise<Service>                    // Returns entity
  findByProject(projectId: string): Promise<Service[]>      // Returns entities
  getTraefikConfig(id: string): Promise<TraefikConfig>      // Returns partial
  getStats(id: string): Promise<{ count: number }>          // Returns partial
}

// ❌ DON'T: One method per endpoint with contract types
class ServiceService {
  getServiceById(id: string): Promise<ServiceContract>      // ❌ Contract type
  listServicesByProject(id: string): Promise<ServiceContract[]> // ❌ Endpoint-specific
}
```

**Key Points:**
- ✅ Methods return **entities or partial entities** (not contracts)
- ✅ Methods are **focused and reusable** (not endpoint-specific)
- ✅ Controllers **mix and match** methods for different endpoints
- ❌ **NO** 1:1 mapping between service methods and controller endpoints

#### 2. 🔧 **Adapters: Fixed Contract Output Types**

```typescript
// ✅ DO: Fixed output type from contract
import { serviceContract } from '@repo/api-contracts';
type ServiceContract = typeof serviceContract.getById.output;

class ServiceAdapterService {
  adaptServiceToContract(
    service: Service,
    config: TraefikConfig
  ): ServiceContract {  // ← EXACT contract type
    return { /* all required fields */ };
  }
}

// ❌ DON'T: Generic return types or service dependencies
class ServiceAdapterService {
  async adaptService(id: string): Promise<any> {  // ❌ Generic type
    const service = await this.service.findById(id); // ❌ Service call
    return { /* no type guarantee */ };
  }
}
```

**Key Points:**
- ✅ Return type is **exact contract type** (`ServiceContract`, not `any`)
- ✅ Receives **all data as parameters** (no service calls)
- ✅ **Zero or minimal dependencies** (pure transformation)
- ✅ TypeScript **guarantees contract compliance** at compile-time
- ❌ **NO** async operations or service dependencies in adapters

#### 3. 🎭 **Controllers: Orchestrate and Mix**

```typescript
// ✅ DO: Orchestrate multiple service methods
class ServiceController {
  @Implement(contract.getById)
  async getById(input: { id: string }) {
    // Mix multiple service methods
    const service = await this.service.findById(input.id);
    const config = await this.service.getTraefikConfig(input.id);
    const stats = await this.service.getStats(input.id);
    
    // Pass aggregated data to adapter
    return this.adapter.adaptWithStats(service, config, stats);
  }
}

// ❌ DON'T: Just delegate to one service method
class ServiceController {
  @Implement(contract.getById)
  async getById(input: { id: string }) {
    return this.service.getServiceById(input.id); // ❌ Just delegates
  }
}
```

**Key Points:**
- ✅ **Orchestrates** multiple service method calls
- ✅ **Aggregates** data from different sources
- ✅ **Passes** aggregated data to adapter
- ✅ Same service methods **reused** across endpoints
- ❌ **NO** simple delegation to one service method

### Quick Reference: Method Naming Conventions

**Services (Generic, Reusable):**
- ✅ `findById(id)` - not `getServiceById(id)`
- ✅ `findByProject(projectId)` - not `listServicesByProject(projectId)`
- ✅ `getStats(id)` - returns partial entity
- ✅ `getTraefikConfig(id)` - returns partial entity
- ✅ `getDependencies(id)` - returns related entities

**Adapters (Contract-Specific):**
- ✅ `adaptServiceToContract(...): ServiceContract`
- ✅ `adaptServicesWithStatsToContract(...): ServiceWithStatsContract[]`
- ✅ `adaptServiceToBasicContract(...): ServiceBasicContract`
- ✅ All return types are **exact contract types** imported from `@repo/api-contracts`

**Controllers (Orchestration):**
- ✅ Mix: `findById()` + `getTraefikConfig()` + `getStats()` → `adapter.adaptWithStats()`
- ✅ Mix: `findByProject()` + `getStats()` (for each) → `adapter.adaptServicesWithStats()`
- ✅ Different endpoints can mix the same service methods differently

### Type Safety Guarantee

```typescript
// This is the compile-time guarantee we achieve:

// 1. Services return entities
const service: Service = await serviceService.findById(id);

// 2. Adapters return exact contract types
const contract: ServiceContract = adapter.adaptServiceToContract(service, config);

// 3. Controllers return exact contract types (via adapter)
const response: ServiceContract = await controller.getById({ id }); // ✅ Type-safe!

// If contract changes:
// - Adapter will have compile error (missing/extra fields)
// - Service layer unaffected (returns entities, not contracts)
// - Fix is isolated to adapter layer only
```

### Benefits

1. **Separation of Concerns**:
   - Core services: Business logic only (entities)
   - Adapters: Contract transformations only (exact types)
   - Controllers: Orchestration only (mixing methods)

2. **Reusability**:
   - Core services can be used by multiple features
   - Same service methods work for different API endpoints
   - Adapters can be composed for different contract shapes

3. **Type Safety**:
   - Compile-time guarantee that contracts are satisfied
   - TypeScript enforces all contract fields are present
   - Contract changes caught by compiler, not runtime

4. **Testability**:
   - Core services tested with pure entities
   - Adapters tested with mock entities (no service mocking)
   - Controllers tested with mocked core services and adapters

5. **Maintainability**:
   - Contract changes only affect adapters
   - Business logic changes only affect core services
   - Clear boundaries between layers
   - Easy to understand data flow

### Key Takeaways

1. **Services provide composable methods, NOT endpoint-specific methods**
2. **Adapters have fixed contract output types, NOT generic types**
3. **Adapters receive data as parameters, NOT via service calls**
4. **Controllers orchestrate and mix service methods, NOT just delegate**
5. **Clear separation: business logic (service) → orchestration (controller) → transformation (adapter)**

---

## Related Documentation

- **Infrastructure Core/Feature Pattern**: See `CORE-VS-FEATURE-ARCHITECTURE.md` for module organization
- **ORPC Contracts**: See `ORPC-TYPE-CONTRACTS.md` for contract definition patterns
- **Development Workflow**: See `DEVELOPMENT-WORKFLOW.md` for implementation workflows

---

**Status**: 📝 Specification (implementation pending)