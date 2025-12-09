# Orchestration Module

> **Module Type**: CORE Infrastructure Module  
> **Priority**: HIGH (Infrastructure Layer)  
> **Last Updated**: 2025-01-20

## Overview

The Orchestration module provides infrastructure services for deployment orchestration, including:

- Docker Swarm stack management
- Traefik reverse proxy configuration
- Resource allocation and monitoring
- SSL certificate management
- Health checking services
- Bull queue for deployment processing

## 🟡 Architecture Issues

### ✅ FIXED: Direct Service Imports (O1)

**Resolved 2025-01-20**: This module now imports `GitModule` and `CoreStorageModule` instead of direct service imports.

**Previous (Wrong)**:
```typescript
// ❌ BEFORE: Direct service imports
import { GitService } from '@/core/modules/git/services/git.service';
import { FileUploadService } from '@/core/modules/storage/services/file-upload.service';

providers: [
  GitService,        // ❌ Duplicates service instance
  FileUploadService, // ❌ Duplicates service instance
]
```

**Current (Fixed)**:
```typescript
// ✅ AFTER: Module imports
import { GitModule } from '@/core/modules/git/git.module';
import { CoreStorageModule } from '@/core/modules/storage/storage.module';

imports: [
  GitModule,         // ✅ Proper dependency injection
  CoreStorageModule, // ✅ Proper dependency injection
]
```

### ⚠️ Pending: Circular Dependency (O2)

**Problem**: Uses `forwardRef(() => CoreDeploymentModule)` to break circular dependency.

**Cause**: OrchestrationModule → CoreDeploymentModule → StaticProviderModule → OrchestrationModule

**See**: [CRITICAL-ISSUES.md](../../docs/CRITICAL-ISSUES.md#issue-o2-circular-dependency-with-deployment--high) for tracking

### Note
This is a **@Global()** module - its services are available to all other modules without explicit imports.

## Services Provided

| Service | Description |
|---------|-------------|
| `SwarmOrchestrationService` | Docker Swarm stack management |
| `TraefikService` | Reverse proxy and load balancing |
| `ResourceAllocationService` | Resource quota management |
| `SslCertificateService` | SSL certificate lifecycle |
| `ResourceMonitoringService` | Resource usage monitoring |
| `HealthCheckService` | Service health monitoring |
| `JobTrackingService` | Deployment job history |
| `DeploymentQueueService` | Bull queue for deployments |
| `GitService` | Git repository operations |
| `FileUploadService` | File upload handling |

## Repositories

| Repository | Description |
|------------|-------------|
| `SslCertificateRepository` | SSL certificate data |
| `JobTrackingRepository` | Job tracking data |
| `ResourceMonitoringRepository` | Resource metrics |
| `HealthCheckRepository` | Health check results |
| `SwarmOrchestrationRepository` | Stack orchestration data |
| `TraefikRepository` | Traefik configuration data |

## Module Dependencies

```
OrchestrationModule (@Global)
├── DatabaseModule
├── ServiceModule
├── CoreDeploymentModule (forwardRef)
├── BullModule (deployment queue)
└── ScheduleModule (cron jobs)
```

## Quick Start

```typescript
import { DeploymentQueueService } from '@/core/modules/orchestration/services/deployment-queue.service';

@Injectable()
export class MyService {
  constructor(private readonly queueService: DeploymentQueueService) {}

  async queueDeployment(deploymentId: string) {
    await this.queueService.addDeploymentJob({
      deploymentId,
      priority: 'high',
    });
  }
}
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
| [QUEUE-SYSTEM.md](./QUEUE-SYSTEM.md) | Bull queue configuration |
| [RESOURCE-MANAGEMENT.md](./RESOURCE-MANAGEMENT.md) | Resource allocation |
| [SSL-CERTIFICATES.md](./SSL-CERTIFICATES.md) | SSL management |

## Bull Queue Configuration

```typescript
BullModule.registerQueue({
  name: 'deployment',
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 25,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
})
```

## Architecture Principles

**This is a CORE module - it provides ONLY services:**
- NO controllers (moved to feature modules)
- NO processors (moved to feature modules)

Controllers and processors should be in separate feature modules like `OrchestrationControllerModule`.
