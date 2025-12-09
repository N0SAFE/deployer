# Service Module

> **Module Type**: CORE Business Module  
> **Priority**: HIGH (Business Layer)  
> **Last Updated**: 2025-11-30

## Overview

The Service module manages service entities within projects. It provides CRUD operations for services, deployment management, health monitoring, dependency tracking, and Traefik configuration management.

## ✅ Architecture Status

This module has a **CLEAN architecture**:
- Simple, focused responsibility
- Minimal dependencies (no imports)
- Clear repository/service separation
- Well-documented business logic

## Services Provided

| Component | Description |
|-----------|-------------|
| `ServiceService` | Business logic for service management |
| `ServiceRepository` | Database operations for services |

## Key Responsibilities

### 1. Service CRUD Operations
- Create, read, update, delete services
- Service search and filtering
- Project-based service listing

### 2. Deployment Management
- Service deployment listing
- Deployment status tracking
- Active deployment queries

### 3. Health & Monitoring
- Service health status calculation
- Health check configuration
- Deployment-based health rules

### 4. Dependency Tracking
- Service dependency management
- Dependency graph generation
- Required vs optional dependencies

### 5. Traefik Configuration
- Traefik config management per service
- Config sync to filesystem
- Domain and routing configuration

## Module Dependencies

```
ServiceModule
└── DatabaseModule (@Global - implicit)
```

**No explicit imports** - This module is completely standalone, relying only on the global DatabaseModule.

## Quick Start

```typescript
import { ServiceService } from '@/core/modules/service/services/service.service';

@Injectable()
export class MyController {
  constructor(private readonly serviceService: ServiceService) {}

  async listServices(projectId: string) {
    return this.serviceService.listServicesByProject({
      projectId,
      limit: 20,
      offset: 0,
    });
  }
}
```

## Service Data Model

```typescript
interface CreateServiceData {
  // Required
  projectId: string;
  name: string;
  type: string;
  providerId: string;  // e.g., "github", "static"
  builderId: string;   // e.g., "dockerfile", "nixpack"
  
  // Optional
  description?: string;
  providerConfig?: Record<string, any>;
  builderConfig?: Record<string, any>;
  port?: number;
  environmentVariables?: Record<string, any>;
  resourceLimits?: { memory?: string; cpu?: string; storage?: string };
  healthCheckPath?: string;
  customDomains?: string[];
  metadata?: { tags?: string[]; category?: string; icon?: string };
}
```

## Health Status Calculation

The service calculates health based on deployment rollback rules:

```
Latest Deployment Status → Service Health
─────────────────────────────────────────
success                 → healthy
building/deploying      → pending
failed (has previous)   → healthy (rolled back)
failed (no previous)    → unhealthy
```

## Dependency Graph

The module can generate a dependency graph for projects:

```typescript
const graph = await serviceService.getProjectDependencyGraph(projectId);
// Returns:
// {
//   nodes: [{ id, name, type, status, latestDeployment }],
//   edges: [{ sourceId, targetId, isRequired }],
//   project: { id, name, baseDomain }
// }
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
| [API-REFERENCE.md](./API-REFERENCE.md) | Full API documentation |

## Traefik Integration

Each service can have associated Traefik configuration:

```typescript
await serviceService.updateTraefikConfig(serviceId, {
  domain: 'example.com',
  subdomain: 'api',
  sslEnabled: true,
  sslProvider: 'letsencrypt',
  pathPrefix: '/v1',
  port: 3000,
});

// Sync to filesystem
await serviceService.syncTraefikConfig(serviceId);
```
