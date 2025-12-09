# Orchestration Module Architecture

> **Module Status**: Production-Ready  
> **Architecture Health**: ⚠️ NEEDS REVIEW  
> **Last Updated**: 2025-11-30

## Executive Summary

The Orchestration module provides infrastructure services for deployment orchestration, including Docker Swarm management, Traefik reverse proxy configuration, resource allocation, SSL certificates, health checking, and Bull queue management.

## Architecture Issues

### Issue 1: Service Imports from Other Modules

```typescript
// CURRENT: Importing services directly from other modules
import { GitService } from '@/core/modules/git/services/git.service';
import { FileUploadService } from '@/core/modules/storage/services/file-upload.service';
```

**Problem**: The module imports GitService and FileUploadService directly from their respective modules, but then provides and exports them. This creates confusion about service ownership.

**Target State**: 
- GitService should come from a proper GitModule import
- FileUploadService should come from a proper StorageModule import
- Or these services should only be provided by their owning modules

### Issue 2: Circular Dependency with DeploymentModule

```typescript
forwardRef(() => CoreDeploymentModule),  // Use forwardRef to break circular dependency
```

**Problem**: The orchestration module has a circular dependency with DeploymentModule.

**Analysis**: This is likely acceptable because:
- Orchestration provides queue and infrastructure services
- Deployment uses these services
- Some orchestration services may need deployment context

### Issue 3: Module Scope Clarity

The module provides services from multiple domains:
- Swarm orchestration services
- Traefik services
- SSL certificate services
- Resource monitoring services
- Health check services
- Git services (should be in GitModule)
- File upload services (should be in StorageModule)

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION MODULE (@Global)                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Queue Layer (Bull)                        │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │            DeploymentQueueService                    │    │   │
│  │  │  • Job queuing and processing                       │    │   │
│  │  │  • Retry with exponential backoff                   │    │   │
│  │  │  • Priority handling                                │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                Infrastructure Services                       │   │
│  │                                                              │   │
│  │  ┌───────────────────┐  ┌────────────────────┐             │   │
│  │  │ SwarmOrchestration│  │   TraefikService   │             │   │
│  │  │     Service       │  │  • Reverse proxy   │             │   │
│  │  │  • Stack deploy   │  │  • Load balancing  │             │   │
│  │  │  • Scale services │  │  • Dynamic routes  │             │   │
│  │  │  • Rolling update │  │  • SSL termination │             │   │
│  │  └───────────────────┘  └────────────────────┘             │   │
│  │                                                              │   │
│  │  ┌───────────────────┐  ┌────────────────────┐             │   │
│  │  │ResourceAllocation │  │ SslCertificate    │             │   │
│  │  │    Service        │  │    Service        │             │   │
│  │  │  • CPU limits     │  │  • Cert generation│             │   │
│  │  │  • Memory quotas  │  │  • Cert renewal   │             │   │
│  │  │  • Storage limits │  │  • Let's Encrypt  │             │   │
│  │  └───────────────────┘  └────────────────────┘             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Monitoring Services                         │   │
│  │                                                              │   │
│  │  ┌───────────────────┐  ┌────────────────────┐             │   │
│  │  │ResourceMonitoring │  │ HealthCheckService │             │   │
│  │  │    Service        │  │  • Endpoint health │             │   │
│  │  │  • CPU usage      │  │  • Container health│             │   │
│  │  │  • Memory usage   │  │  • Dependency check│             │   │
│  │  │  • Alerts         │  │  • Auto-recovery   │             │   │
│  │  └───────────────────┘  └────────────────────┘             │   │
│  │                                                              │   │
│  │  ┌───────────────────────────────────────────────────┐      │   │
│  │  │              JobTrackingService                     │      │   │
│  │  │  • Deployment history • Job metrics • Audit log    │      │   │
│  │  └───────────────────────────────────────────────────┘      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               MISPLACED SERVICES (Should Move)               │   │
│  │                                                              │   │
│  │  ┌──────────────┐     ┌───────────────────┐                │   │
│  │  │  GitService  │     │ FileUploadService │                │   │
│  │  │  → GitModule │     │ → StorageModule   │                │   │
│  │  └──────────────┘     └───────────────────┘                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Repositories                            │   │
│  │                                                              │   │
│  │  • SslCertificateRepository   • TraefikRepository           │   │
│  │  • JobTrackingRepository      • SwarmOrchestrationRepository│   │
│  │  • ResourceMonitoringRepository • HealthCheckRepository     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Service Dependency Flow

```
                    ┌─────────────────────────┐
                    │   DeploymentModule      │
                    │   (imports forwardRef)  │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│DeploymentQueue  │  │  SwarmOrch      │  │  Traefik        │
│   Service       │  │   Service       │  │   Service       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                      │                      │
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Bull Queue    │  │ DockerService   │  │ Docker Labels   │
│   (Redis)       │  │ (via Docker)    │  │ (Traefik)       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Target Architecture

### Recommended Refactoring

```
CURRENT                              TARGET
=========                            ======

OrchestrationModule                  OrchestrationModule
├── GitService (from git/)           ├── [REMOVED]
├── FileUploadService (from storage/)├── [REMOVED]
├── SwarmOrchestrationService        ├── SwarmOrchestrationService
├── TraefikService                   ├── TraefikService
├── ResourceAllocationService        ├── ResourceAllocationService
├── SslCertificateService            ├── SslCertificateService
├── ResourceMonitoringService        ├── ResourceMonitoringService
├── HealthCheckService               ├── HealthCheckService
├── JobTrackingService               ├── JobTrackingService
└── DeploymentQueueService           └── DeploymentQueueService

                                     GitModule (separate)
                                     └── GitService
                                     
                                     StorageModule (separate)
                                     └── FileUploadService
```

## Module Configuration

### Bull Queue Configuration

```typescript
BullModule.registerQueue({
  name: 'deployment',
  defaultJobOptions: {
    removeOnComplete: 10,    // Keep last 10 completed jobs
    removeOnFail: 25,        // Keep last 25 failed jobs
    attempts: 3,             // Retry 3 times
    backoff: {
      type: 'exponential',   // Exponential backoff
      delay: 2000,           // 2s, 4s, 8s
    },
  },
})
```

### Service Responsibilities

| Service | Primary Responsibility | Dependencies |
|---------|----------------------|--------------|
| `SwarmOrchestrationService` | Docker Swarm stack lifecycle | DockerModule |
| `TraefikService` | Traefik configuration generation | - |
| `ResourceAllocationService` | Resource quota enforcement | DatabaseModule |
| `SslCertificateService` | SSL certificate lifecycle | TraefikService |
| `ResourceMonitoringService` | Resource usage tracking | ScheduleModule |
| `HealthCheckService` | Service health monitoring | ScheduleModule |
| `JobTrackingService` | Job history and metrics | DatabaseModule |
| `DeploymentQueueService` | Bull queue management | BullModule |

## Repository Layer

Each service has a corresponding repository for data persistence:

```typescript
// Repository pattern example
@Injectable()
export class SslCertificateRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}
  
  async findByDomain(domain: string): Promise<SslCertificate | null> {
    return this.db.query.sslCertificates.findFirst({
      where: eq(sslCertificates.domain, domain),
    });
  }
  
  async save(cert: NewSslCertificate): Promise<SslCertificate> {
    return this.db.insert(sslCertificates).values(cert).returning();
  }
}
```

## Migration Plan

### Phase 1: Service Ownership Cleanup

**Remove misplaced services from OrchestrationModule:**

```typescript
// REMOVE these imports and provider registrations:
// import { GitService } from '@/core/modules/git/services/git.service';
// import { FileUploadService } from '@/core/modules/storage/services/file-upload.service';

// INSTEAD: Import the modules themselves
@Module({
  imports: [
    DatabaseModule,
    ServiceModule,
    GitModule,        // Import GitModule
    StorageModule,    // Import StorageModule
    forwardRef(() => CoreDeploymentModule),
    BullModule.registerQueue({ name: 'deployment', ... }),
    ScheduleModule.forRoot(),
  ],
  // ...
})
```

### Phase 2: Circular Dependency Review

Analyze the forwardRef to CoreDeploymentModule:

1. Identify which services actually need DeploymentModule
2. Consider if those services should be in a different module
3. Potentially split OrchestrationModule into smaller focused modules

### Phase 3: Module Decomposition (Optional)

Consider splitting into focused modules:

```
orchestration/
├── queue/
│   └── queue.module.ts         # DeploymentQueueService
├── swarm/
│   └── swarm.module.ts         # SwarmOrchestrationService
├── monitoring/
│   └── monitoring.module.ts    # ResourceMonitoringService, HealthCheckService
└── certificates/
    └── certificates.module.ts  # SslCertificateService
```

## Usage Patterns

### Queue Service Usage

```typescript
@Injectable()
export class DeploymentService {
  constructor(private readonly queueService: DeploymentQueueService) {}

  async scheduleDeployment(deployment: Deployment) {
    await this.queueService.addJob('deploy', {
      deploymentId: deployment.id,
      priority: deployment.priority,
    });
  }
}
```

### Swarm Orchestration Usage

```typescript
@Injectable()
export class DeploymentOrchestrator {
  constructor(
    private readonly swarmService: SwarmOrchestrationService,
    private readonly traefikService: TraefikService,
  ) {}

  async deployStack(config: StackConfig) {
    // Generate Traefik labels
    const labels = this.traefikService.generateLabels(config);
    
    // Deploy to Swarm
    await this.swarmService.deployStack({
      ...config,
      labels,
    });
  }
}
```

## Recommendations Summary

| Priority | Issue | Recommendation |
|----------|-------|----------------|
| HIGH | GitService/FileUploadService ownership | Import GitModule and StorageModule instead of individual services |
| MEDIUM | Circular dependency | Review if truly necessary, document why |
| LOW | Module decomposition | Consider splitting if module grows too large |

## Related Documentation

- [../docker/docs/ARCHITECTURE.md](../docker/docs/ARCHITECTURE.md) - Docker infrastructure
- [../traefik/docs/ARCHITECTURE.md](../traefik/docs/ARCHITECTURE.md) - Traefik configuration
- [../deployment/docs/ARCHITECTURE.md](../deployment/docs/ARCHITECTURE.md) - Deployment orchestration
