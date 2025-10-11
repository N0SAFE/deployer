# Service Context System

The Service Context System provides a unified, type-safe way to manage service and project configurations across deployment, networking, and routing services.

## Overview

The context system replaces scattered variable resolution with a centralized approach:

- **ServiceContext**: Complete configuration for a single service
- **ProjectContext**: Configuration for a project containing multiple services
- **Bidirectional References**: Services can access their project, projects can access their services
- **Domain Management**: Multiple named domains per service with primary domain selection
- **Traefik Integration**: Seamless conversion to Traefik variable context

## Architecture

```typescript
┌─────────────────────────────────────────────────────────┐
│                    ProjectContext                       │
│  - project: { id, name, baseDomain }                   │
│  - servicesContext: Record<string, ServiceContext>     │
│  - network: { name, id }                               │
│  - environment: Record<string, string>                 │
│                                                         │
│  ┌───────────────────────────────────────────────┐    │
│  │         ServiceContext (via Proxy)            │    │
│  │  - service: { id, name, type }                │    │
│  │  - deployment: { id, containerName, port }    │    │
│  │  - domains: Record<string, DomainConfig>      │    │
│  │  - network: { name, id, ports }               │    │
│  │  - paths: { healthCheck, prefix }             │    │
│  │  - routing: { rules, middlewares }            │    │
│  │  - environment: Record<string, string>        │    │
│  │  - getProjectContext() → ProjectContext       │    │
│  └───────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Core Types

### DomainConfig

```typescript
interface DomainConfig {
  name: string;                    // Domain identifier (e.g., "production", "staging")
  fullDomain: string;              // Complete domain (e.g., "api-prod.example.com")
  baseDomain: string;              // Base domain (e.g., "example.com")
  subdomain?: string;              // Subdomain (e.g., "api-prod")
  isPrimary: boolean;              // Is this the primary domain?
  ssl?: {
    enabled: boolean;
    provider?: 'letsencrypt' | 'selfsigned' | 'custom';
    certResolver?: string;
  };
  pathPrefix?: string;             // URL path prefix (e.g., "/api")
  metadata?: Record<string, any>;  // Custom metadata
}
```

### ServiceContext

```typescript
interface ServiceContext {
  // Service identity
  service: {
    id: string;
    name: string;
    type: string;
    description?: string;
  };

  // Deployment info
  deployment?: {
    id: string;
    containerName: string;
    containerPort: number;
    containerId?: string;
    environment: 'production' | 'staging' | 'preview' | 'development';
    status?: string;
  };

  // Multiple named domains
  domains: Record<string, DomainConfig>;

  // Network configuration
  network?: {
    name: string;
    id?: string;
    internalPort?: number;
    externalPort?: number;
    protocols?: Array<'http' | 'https' | 'tcp' | 'udp'>;
  };

  // Path configuration
  paths?: {
    healthCheck?: string;
    prefix?: string;
  };

  // Routing configuration
  routing?: {
    rules?: string[];
    middlewares?: string[];
    priority?: number;
    entryPoints?: string[];
  };

  // Environment variables (service-specific)
  environment?: Record<string, string>;

  // Resource limits
  resources?: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };

  // Health check configuration
  healthCheck?: {
    enabled: boolean;
    path?: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  };

  // Custom variables
  custom?: Record<string, string | number | boolean>;

  // Access parent project
  getProjectContext: () => ProjectContext;
}
```

### ProjectContext

```typescript
interface ProjectContext {
  // Project identity
  project: {
    id: string;
    name: string;
    description?: string;
    baseDomain?: string;
  };

  // Services (with bidirectional reference via Proxy)
  servicesContext: Record<string, ServiceContext>;

  // Network configuration
  network?: {
    name: string;
    id?: string;
  };

  // Environment variables (project-level)
  environment?: Record<string, string>;

  // Metadata
  metadata?: {
    createdAt?: Date;
    updatedAt?: Date;
    tags?: string[];
    owner?: string;
    custom?: Record<string, any>;
  };

  // Service lookup helpers
  getService(name: string): ServiceContext | undefined;
  getAllServices(): ServiceContext[];
}
```

## Usage Examples

### Creating a Service Context

```typescript
import { ServiceContextBuilder } from '@/core/modules/context/types/service-context.types';

const serviceContext = new ServiceContextBuilder()
  .withService({
    id: 'svc-123',
    name: 'api',
    type: 'backend',
    description: 'Main API service',
  })
  .withDeployment({
    id: 'dep-456',
    containerName: 'api-prod-container',
    containerPort: 3000,
    environment: 'production',
  })
  .withDomains({
    production: {
      name: 'production',
      fullDomain: 'api.example.com',
      baseDomain: 'example.com',
      subdomain: 'api',
      isPrimary: true,
      ssl: {
        enabled: true,
        provider: 'letsencrypt',
        certResolver: 'default',
      },
    },
    staging: {
      name: 'staging',
      fullDomain: 'api-staging.example.com',
      baseDomain: 'example.com',
      subdomain: 'api-staging',
      isPrimary: false,
      ssl: {
        enabled: true,
        provider: 'letsencrypt',
        certResolver: 'default',
      },
    },
  })
  .withNetwork({
    name: 'project-network',
    internalPort: 3000,
    externalPort: 80,
    protocols: ['http', 'https'],
  })
  .withPaths({
    healthCheck: '/health',
    prefix: '/api',
  })
  .withEnvironment({
    DATABASE_URL: 'postgresql://...',
    REDIS_URL: 'redis://...',
  })
  .withHealthCheck({
    enabled: true,
    path: '/health',
    interval: 30000,
    timeout: 5000,
    retries: 3,
  })
  .build();
```

### Creating a Project Context

```typescript
import { ProjectContextBuilder } from '@/core/modules/context/types/service-context.types';

const projectContext = new ProjectContextBuilder()
  .withProject({
    id: 'proj-789',
    name: 'my-app',
    description: 'My awesome application',
    baseDomain: 'example.com',
  })
  .withNetwork({
    name: 'my-app-network',
    id: 'net-abc',
  })
  .withEnvironment({
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
  })
  .addService('api', apiServiceContext)
  .addService('web', webServiceContext)
  .addService('worker', workerServiceContext)
  .build();
```

### Using Service Context Service

```typescript
import { ServiceContextService } from '@/core/modules/context/services/service-context.service';

@Injectable()
export class MyService {
  constructor(private contextService: ServiceContextService) {}

  async createContext() {
    // Create from database entities
    const serviceContext = await this.contextService.createServiceContext({
      service: {
        id: service.id,
        name: service.name,
        type: service.type,
        port: service.port,
      },
      deployment: {
        id: deployment.id,
        containerName: deployment.containerName,
        containerPort: deployment.port,
        environment: 'production',
      },
      domains: [
        {
          name: 'production',
          fullDomain: 'api.example.com',
          baseDomain: 'example.com',
          isPrimary: true,
          ssl: { enabled: true, provider: 'letsencrypt' },
        },
      ],
      project: {
        id: project.id,
        name: project.name,
        baseDomain: project.baseDomain,
      },
      network: {
        name: `${project.name}-network`,
      },
    });

    // Convert to Traefik context
    const traefikContext = this.contextService.toTraefikContext(serviceContext);

    // Get primary domain
    const primaryDomain = this.contextService.getDomainOrPrimary(serviceContext);

    // Get merged environment (project + service)
    const env = this.contextService.getMergedEnvironment(serviceContext);

    return serviceContext;
  }
}
```

### Domain Management

```typescript
// Generate default domain
const defaultDomain = this.contextService.generateDefaultDomain({
  serviceName: 'api',
  projectName: 'my-app',
  baseDomain: 'example.com',
  environment: 'production',
});
// Result: { name: 'default', fullDomain: 'api-production.example.com', ... }

// Add domain to existing service
const updatedContext = this.contextService.addDomainToService(
  serviceContext,
  {
    name: 'custom',
    fullDomain: 'custom.example.com',
    baseDomain: 'example.com',
    isPrimary: false,
    ssl: { enabled: true },
  }
);

// Set primary domain
const contextWithNewPrimary = this.contextService.setPrimaryDomain(
  serviceContext,
  'custom'
);

// Get all domains
const allDomains = this.contextService.getAllDomains(serviceContext);
```

### Traefik Integration

```typescript
import { TraefikVariableResolverService } from '@/core/modules/traefik/services/traefik-variable-resolver.service';

@Injectable()
export class TraefikSyncService {
  constructor(
    private variableResolver: TraefikVariableResolverService,
    private contextService: ServiceContextService
  ) {}

  async syncService(serviceContext: ServiceContext) {
    // Build variable map from context
    const variables = this.variableResolver.buildVariableMapFromServiceContext(
      serviceContext
    );

    // Resolve template string
    const resolved = this.variableResolver.resolveStringFromServiceContext(
      'Host(`~##host##~`)',
      serviceContext
    );
    // Result: "Host(`api.example.com`)" (using primary domain)

    // Resolve entire config
    const config = {
      http: {
        routers: {
          '~##routerName##~': {
            rule: 'Host(`~##host##~`)',
            service: '~##serviceName##~',
          },
        },
      },
    };

    const resolvedConfig = this.variableResolver.resolveConfigFromServiceContext(
      config,
      serviceContext
    );
  }
}
```

### Bidirectional References

```typescript
// Service can access its project
const projectContext = serviceContext.getProjectContext();
console.log(projectContext.project.name); // "my-app"

// Project can access its services
const apiService = projectContext.getService('api');
console.log(apiService?.service.name); // "api"

// Services can access sibling services
const projectFromService = serviceContext.getProjectContext();
const webService = projectFromService.getService('web');
console.log(webService?.service.name); // "web"
```

## Utility Functions

### ContextUtils

```typescript
import { ContextUtils } from '@/core/modules/context/types/service-context.types';

// Convert to Traefik variable context
const traefikContext = ContextUtils.toTraefikVariableContext(serviceContext);

// Get all domains
const domains = ContextUtils.getAllDomains(serviceContext);

// Get domain by name or primary
const domain = ContextUtils.getDomainOrPrimary(serviceContext, 'production');
const primaryDomain = ContextUtils.getDomainOrPrimary(serviceContext); // Gets primary

// Get merged environment
const env = ContextUtils.getMergedEnvironment(serviceContext);
// Merges project.environment + service.environment
```

## Migration Guide

### Old Approach (Scattered Variables)

```typescript
// Before: Multiple parameters everywhere
async syncTraefik(
  serviceId: string,
  serviceName: string,
  containerName: string,
  containerPort: number,
  domain: string,
  healthCheckPath: string,
  // ... 20+ more parameters
) {
  // Manual variable building
  const variables = {
    serviceName,
    containerName,
    containerPort: containerPort.toString(),
    domain,
    // ... manual mapping
  };
}
```

### New Approach (Context System)

```typescript
// After: Single context object
async syncTraefik(serviceContext: ServiceContext) {
  // Automatic variable conversion
  const variables = this.variableResolver.buildVariableMapFromServiceContext(
    serviceContext
  );
  
  // Or use utility
  const traefikContext = ContextUtils.toTraefikVariableContext(serviceContext);
}
```

## Best Practices

1. **Always use builders**: Don't construct contexts manually
   ```typescript
   // ✅ Good
   const context = new ServiceContextBuilder()
     .withService({ ... })
     .build();
   
   // ❌ Bad
   const context = { service: { ... } };
   ```

2. **Set primary domain**: Always have one primary domain
   ```typescript
   domains: {
     production: { isPrimary: true, ... },
     staging: { isPrimary: false, ... },
   }
   ```

3. **Use context service for database integration**
   ```typescript
   const context = await this.contextService.createServiceContext({
     service: dbService,
     deployment: dbDeployment,
     // ...
   });
   ```

4. **Leverage bidirectional references**
   ```typescript
   // Access project from service
   const project = serviceContext.getProjectContext();
   
   // Access sibling services
   const webService = project.getService('web');
   ```

5. **Use utility functions**
   ```typescript
   // Don't manually extract domains
   const primary = ContextUtils.getDomainOrPrimary(context);
   ```

## Integration Checklist

When integrating context system:

- [ ] Create ServiceContext using ServiceContextBuilder
- [ ] Set up multiple domains with primary designation
- [ ] Use ServiceContextService for database integration
- [ ] Convert to Traefik context using ContextUtils.toTraefikVariableContext()
- [ ] Update variable resolution to use context-based methods
- [ ] Replace scattered parameters with single context parameter
- [ ] Leverage bidirectional references for cross-service access
- [ ] Use domain utilities for domain management

## Future Enhancements

Planned features:
- Database persistence for contexts
- Context versioning and history
- Context validation rules
- Context templates for common patterns
- GraphQL schema for context queries
- Event-driven context updates
