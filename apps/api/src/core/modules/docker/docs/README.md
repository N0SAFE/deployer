# Docker Module

> **Module Type**: CORE Infrastructure Module  
> **Priority**: FIRST (Foundation Layer)  
> **Last Updated**: 2025-01-20  
> **Status**: ✅ Architecture Fixed

## Overview

The Docker module provides the foundational Docker infrastructure services for the entire deployer platform. As a `@Global()` module, it makes Docker operations available to all other modules without explicit imports.

## ✅ ARCHITECTURE FIXED

**Previous Issue**: The Docker module previously imported `CoreDeploymentModule`, `ProjectModule`, and `ServiceModule` via `ZombieCleanupService`, creating an inverted dependency graph.

**Resolution**: `ZombieCleanupService` was moved to a new `CleanupModule` in the feature layer (`/modules/cleanup/`), which properly depends on Docker instead of Docker depending on business modules.

**See**: 
- [ARCHITECTURE.md](./ARCHITECTURE.md) for the clean architecture
- [CleanupModule](/modules/cleanup/) for the refactored cleanup service

## Quick Start

```typescript
import { DockerService } from '@/core/modules/docker/services/docker.service';

@Injectable()
export class MyService {
  constructor(private readonly dockerService: DockerService) {}

  async createContainer() {
    const containerId = await this.dockerService.createAndStartContainer({
      image: 'nginx:alpine',
      name: 'my-container',
      deploymentId: 'deploy-123',
    });
  }
}
```

## Services Provided

| Service | Description |
|---------|-------------|
| `DockerService` | Core Docker operations (containers, images, volumes) |

> **Note**: `ZombieCleanupService` was moved to `CleanupModule` (`/modules/cleanup/`) to maintain proper dependency direction.

## Module Responsibilities

1. **Container Lifecycle Management**
   - Create, start, stop, remove containers
   - Container health checking
   - Container logs retrieval

2. **Image Management**
   - Build images from Dockerfiles
   - Pull images from registries
   - Remove unused images

3. **Volume Operations**
   - Write files into volumes
   - Copy files between containers and volumes
   - Run commands in volume contexts

4. **Network Operations** (via dockerode)
   - Create/manage overlay networks
   - Container network connectivity

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current vs target architecture, migration plan |
| [API-REFERENCE.md](./API-REFERENCE.md) | Complete DockerService API documentation |
| [CLEANUP-SERVICE.md](./CLEANUP-SERVICE.md) | Zombie cleanup service details and refactoring plan |

## Dependencies

### Current (Clean) ✅
```
DockerModule (CORE - @Global)
└── (no dependencies - pure infrastructure)
```

### Consumers
```
CleanupModule (FEATURE)
├── DockerModule (@Global, implicit)
├── CoreDeploymentModule
├── ProjectModule  
└── ServiceModule

DeploymentModule (CORE)
└── DockerModule (@Global, implicit)

OrchestrationModule (CORE)
└── DockerModule (@Global, implicit)
```

## Usage Guidelines

1. **Always use DockerService** - Never instantiate dockerode directly
2. **Use labeled containers** - Always include `deployer.deployment_id` and `deployer.managed` labels
3. **Handle image pull failures** - Use `imagePullPolicy` appropriately
4. **Clean up resources** - Always remove containers/images when no longer needed
