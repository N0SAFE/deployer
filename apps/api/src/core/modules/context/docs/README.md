# Context Module

> **Status**: ✅ Stable  
> **Type**: Core Infrastructure Module  
> **Last Updated**: 2025-11-30

## Overview

The Context module provides **service context builders** that create structured configuration objects for deployment targets. It bridges the gap between high-level service definitions and low-level Traefik/Docker configurations by generating labels, domains, and routing rules.

## Architecture

```
context/
├── context.module.ts          # Module definition
├── services/
│   └── service-context.service.ts  # Context builder service
└── types/
    └── service-context.types.ts    # Type definitions
```

## Purpose

When deploying a service, various systems need different views of the same data:

| System | Needs |
|--------|-------|
| **Docker** | Container labels, network aliases |
| **Traefik** | Router rules, service names, middleware |
| **DNS** | Domain names, CNAME targets |
| **Monitoring** | Service identifiers, health check URLs |

The `ServiceContextService` creates a unified context that can be consumed by all these systems.

## Module Configuration

```typescript
// context.module.ts
@Module({
  imports: [DomainModule],
  providers: [ServiceContextService],
  exports: [ServiceContextService],
})
export class ContextModule {}
```

## Services

### ServiceContextService

Builds deployment contexts for services and projects:

```typescript
@Injectable()
export class ServiceContextService {
  constructor(
    private readonly domainService: ServiceDomainMappingService,
  ) {}

  // Build context for a service deployment
  async buildServiceContext(options: ServiceContextOptions): Promise<ServiceContext>;
  
  // Build context for a project (multiple services)
  async buildProjectContext(options: ProjectContextOptions): Promise<ProjectContext>;
  
  // Generate Traefik labels for a service
  generateTraefikLabels(context: ServiceContext): Record<string, string>;
  
  // Get domain mappings for a service
  async getDomainMappings(serviceId: string): Promise<DomainMapping[]>;
}
```

## Types

### ServiceContextOptions

```typescript
interface ServiceContextOptions {
  serviceId: string;
  serviceName: string;
  projectId: string;
  environmentId: string;
  port: number;
  protocol?: 'http' | 'https';
  healthCheckPath?: string;
  customDomains?: string[];
}
```

### ServiceContext

```typescript
interface ServiceContext {
  // Identifiers
  id: string;
  name: string;
  projectId: string;
  environmentId: string;
  
  // Network
  internalHost: string;     // service-name.internal
  port: number;
  protocol: 'http' | 'https';
  
  // Domains
  primaryDomain: string;    // main access domain
  customDomains: string[];  // user-configured domains
  allDomains: string[];     // primary + custom
  
  // Traefik
  routerName: string;       // unique router identifier
  serviceName: string;      // unique service identifier
  labels: Record<string, string>;
  
  // Health
  healthCheckUrl: string;
  healthCheckPath: string;
}
```

### ProjectContext

```typescript
interface ProjectContext {
  projectId: string;
  projectName: string;
  environmentId: string;
  services: ServiceContext[];
  sharedDomains: string[];
  defaultDomain: string;
}
```

## Usage Examples

### Building Service Context

```typescript
import { ServiceContextService } from '@/core/modules/context/services/service-context.service';

@Injectable()
export class DeploymentService {
  constructor(private readonly contextService: ServiceContextService) {}

  async deploy(service: Service) {
    // Build context with all deployment info
    const context = await this.contextService.buildServiceContext({
      serviceId: service.id,
      serviceName: service.name,
      projectId: service.projectId,
      environmentId: service.environmentId,
      port: service.port,
      healthCheckPath: service.healthCheckPath,
      customDomains: service.domains,
    });

    // Use context for Docker container
    await this.dockerService.createContainer({
      name: context.name,
      labels: context.labels,
      // ...
    });

    return context;
  }
}
```

### Generating Traefik Labels

```typescript
const context = await this.contextService.buildServiceContext({
  serviceId: 'abc123',
  serviceName: 'api',
  projectId: 'proj1',
  environmentId: 'prod',
  port: 3000,
});

const labels = this.contextService.generateTraefikLabels(context);
// Returns:
// {
//   'traefik.enable': 'true',
//   'traefik.http.routers.api-abc123.rule': 'Host(`api.example.com`)',
//   'traefik.http.routers.api-abc123.service': 'api-abc123',
//   'traefik.http.services.api-abc123.loadbalancer.server.port': '3000',
//   ...
// }
```

### Project-Level Context

```typescript
const projectContext = await this.contextService.buildProjectContext({
  projectId: 'proj1',
  projectName: 'my-app',
  environmentId: 'production',
  services: [
    { serviceId: 's1', serviceName: 'api', port: 3000 },
    { serviceId: 's2', serviceName: 'web', port: 80 },
    { serviceId: 's3', serviceName: 'worker', port: 9000 },
  ],
});

// projectContext.services contains ServiceContext for each service
// projectContext.sharedDomains lists domains shared across services
```

## Domain Mapping Logic

The service determines domains based on hierarchy:

1. **Custom Domains**: User-configured domains (e.g., `api.myapp.com`)
2. **Project Domains**: `{service}.{project}.{platform-domain}`
3. **Environment Domains**: `{service}.{env}.{project}.{platform-domain}`
4. **Default Domain**: Platform default (e.g., `{service}.deployer.local`)

```typescript
// Example domain resolution
const context = await this.contextService.buildServiceContext({
  serviceName: 'api',
  projectId: 'myapp',
  environmentId: 'production',
  customDomains: ['api.mycompany.com'],
});

context.primaryDomain;   // 'api.mycompany.com' (custom takes precedence)
context.customDomains;   // ['api.mycompany.com']
context.allDomains;      // ['api.mycompany.com', 'api.production.myapp.deployer.local']
```

## Traefik Label Generation

Labels follow Traefik's label schema:

```typescript
generateTraefikLabels(context: ServiceContext): Record<string, string> {
  const labels: Record<string, string> = {
    'traefik.enable': 'true',
  };

  // Router for each domain
  context.allDomains.forEach((domain, index) => {
    const routerName = `${context.routerName}-${index}`;
    labels[`traefik.http.routers.${routerName}.rule`] = `Host(\`${domain}\`)`;
    labels[`traefik.http.routers.${routerName}.service`] = context.serviceName;
    labels[`traefik.http.routers.${routerName}.entrypoints`] = 'websecure';
    labels[`traefik.http.routers.${routerName}.tls`] = 'true';
  });

  // Service definition
  labels[`traefik.http.services.${context.serviceName}.loadbalancer.server.port`] = 
    String(context.port);

  return labels;
}
```

## Integration Points

| Module | Relationship | Purpose |
|--------|-------------|---------|
| `DomainModule` | Dependency | Domain resolution and mapping |
| `DeploymentModule` | Consumer | Uses context for deployments |
| `DockerModule` | Consumer | Uses labels for containers |
| `TraefikModule` | Consumer | Uses context for routing |

## Testing

```typescript
import { Test } from '@nestjs/testing';
import { ServiceContextService } from '@/core/modules/context/services/service-context.service';

describe('ServiceContextService', () => {
  let service: ServiceContextService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ServiceContextService,
        {
          provide: ServiceDomainMappingService,
          useValue: {
            getDomainMappings: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get(ServiceContextService);
  });

  it('should build service context', async () => {
    const context = await service.buildServiceContext({
      serviceId: 'test-id',
      serviceName: 'api',
      projectId: 'proj1',
      environmentId: 'dev',
      port: 3000,
    });

    expect(context.id).toBe('test-id');
    expect(context.name).toBe('api');
    expect(context.port).toBe(3000);
    expect(context.labels).toBeDefined();
  });

  it('should generate traefik labels', () => {
    const context: ServiceContext = {
      id: 'test-id',
      name: 'api',
      routerName: 'api-test-id',
      serviceName: 'api-test-id',
      port: 3000,
      allDomains: ['api.example.com'],
      // ... other properties
    };

    const labels = service.generateTraefikLabels(context);

    expect(labels['traefik.enable']).toBe('true');
    expect(labels).toHaveProperty('traefik.http.routers.api-test-id-0.rule');
  });
});
```

## Related Documentation

- [Domain Module](../../domain/docs/) - Domain hierarchy and verification
- [Traefik Module](../../traefik/docs/) - Reverse proxy configuration
- [Deployment Module](../../deployment/docs/) - Deployment orchestration
