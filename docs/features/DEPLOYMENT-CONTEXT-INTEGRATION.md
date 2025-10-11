# Deployment Service Context Integration

## Overview

The deployment services have been updated to use the **Service Context System** for unified variable resolution and configuration management. This replaces the previous scattered parameter approach with a clean, type-safe context object.

## What Changed

### Before: Scattered Parameters
```typescript
// Old approach - manual variable building
const context: VariableResolutionContext = {
  service: { id, name, type },
  deployment: { id, containerName, containerPort, ... },
  domain: { domain, subdomain, fullDomain, baseDomain },
  project: { id, name },
  ssl: { certFile, keyFile, certResolver },
  path: { prefix, healthCheck },
  // ... many more parameters
};
```

### After: Service Context
```typescript
// New approach - unified context
const serviceContext = await this.buildServiceContext(serviceId);
const resolvedBuilder = this.traefikVariableResolver.resolveBuilderFromServiceContext(
  traefikConfig,
  serviceContext
);
```

## Implementation Details

### DeploymentOrchestrator Changes

**New Dependency:**
- Added `ServiceContextService` injection for context management

**New Method:**
```typescript
private async buildServiceContext(serviceId: string): Promise<ServiceContext | null>
```

**Purpose:** Creates a unified ServiceContext from database entities including:
- Service information (id, name, type, description)
- Latest deployment data (container info, environment, status)
- Domain configuration (auto-generated default domain)
- Project information (id, name, base domain)
- Network configuration
- Resource limits and health check settings

**Updated Method:**
```typescript
private async updateRouting(serviceId: string, url: string): Promise<void>
```

**Changes:**
1. Builds `ServiceContext` instead of manual context object
2. Uses `resolveBuilderFromServiceContext()` for cleaner variable resolution
3. Extracts primary domain from context for logging
4. Simplified from ~100 lines to ~50 lines

### Key Benefits

1. **Type Safety**: ServiceContext provides complete type safety across the deployment pipeline
2. **Domain Management**: Automatic domain generation with support for multiple named domains
3. **Reduced Complexity**: Single context object replaces dozens of scattered parameters
4. **Bidirectional References**: Services can access their project context
5. **Maintainability**: Centralized context building logic
6. **Consistency**: Same context structure used across Traefik, deployment, and environment services

## Domain Generation

The system automatically generates a default domain for each deployment:

```typescript
const defaultDomain = this.serviceContextService.generateDefaultDomain({
  serviceName: 'api',
  projectName: 'my-app',
  baseDomain: 'example.com',
  environment: 'production',
});
// Result: api-production.example.com
```

Domain configuration includes:
- Full domain (e.g., `api-production.example.com`)
- Base domain (e.g., `example.com`)
- Subdomain (e.g., `api-production`)
- Primary flag for multi-domain support
- SSL configuration (enabled by default with Let's Encrypt)

## Variable Resolution Flow

```
┌─────────────────────────────────────────┐
│  1. Get service, deployment, project    │
│     from database                       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  2. Generate default domain config      │
│     (serviceName-environment.domain)    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  3. Build ServiceContext with all data  │
│     using ServiceContextBuilder         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  4. Convert to Traefik variable context │
│     using ContextUtils                  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  5. Resolve variables in Traefik config │
│     using resolveBuilderFromServiceContext │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  6. Write resolved config to file       │
│     and log primary domain URL          │
└─────────────────────────────────────────┘
```

## Example Usage

### Building Service Context

```typescript
// In DeploymentOrchestrator
const serviceContext = await this.buildServiceContext('service-123');

if (!serviceContext) {
  this.logger.warn('Failed to build service context');
  return;
}

// Context contains:
// - service: { id, name, type, description }
// - deployment: { id, containerName, containerPort, environment, status }
// - domains: { default: { fullDomain, baseDomain, subdomain, isPrimary, ssl } }
// - project: { id, name, baseDomain }
// - network: { name, id }
// - paths: { healthCheck, prefix }
// - resources: { cpu, memory, storage }
// - healthCheck: { enabled, path }
```

### Resolving Traefik Configuration

```typescript
// Old approach
const context: VariableResolutionContext = { /* many fields */ };
const resolvedBuilder = this.traefikVariableResolver.resolveBuilder(traefikConfig, context);

// New approach - cleaner and type-safe
const resolvedBuilder = this.traefikVariableResolver.resolveBuilderFromServiceContext(
  traefikConfig,
  serviceContext
);
```

### Getting Service URL

```typescript
// Old approach
const fullDomain = `${subdomain}.${domain}`;
this.logger.log(`Service accessible at: http://${fullDomain}`);

// New approach - extracts from context
const primaryDomain = this.serviceContextService.getDomainOrPrimary(serviceContext);
const serviceUrl = primaryDomain ? `http://${primaryDomain.fullDomain}` : 'Unknown';
this.logger.log(`Service accessible at: ${serviceUrl}`);
```

## Integration Checklist

When integrating Service Context into other deployment-related services:

- [x] ✅ **DeploymentOrchestrator**: Updated to use ServiceContext
- [x] ✅ **Traefik Variable Resolver**: Added context-based methods
- [x] ✅ **Context Module**: Integrated into CoreModule
- [ ] **DeploymentService**: Update to use ServiceContext for deployments
- [ ] **DeploymentHealthMonitor**: Use ServiceContext for health checks
- [ ] **Environment Resolver**: Integrate ServiceContext for env variable resolution
- [ ] **Docker Service**: Use ServiceContext for container configuration
- [ ] **Database Schema**: Add domain configuration tables
- [ ] **ORPC Contracts**: Add domain management endpoints
- [ ] **Frontend**: Add UI for managing multiple domains

## Testing

To test the integration:

1. **Create a deployment** - verify ServiceContext is built correctly
2. **Check Traefik config** - ensure variables are resolved using context
3. **Verify domain generation** - check auto-generated domain format
4. **Test routing update** - confirm service URL is logged correctly
5. **Monitor logs** - ensure "Resolving Traefik config variables using ServiceContext" appears

## Future Enhancements

1. **Multiple Domains**: Support for adding custom domains beyond default
2. **Domain Persistence**: Store domain configurations in database
3. **SSL Management**: Per-domain SSL configuration
4. **Path Prefixes**: Custom path prefixes per domain
5. **Domain Aliases**: Support for domain aliases and redirects
6. **Context Caching**: Cache contexts to avoid repeated database queries
7. **Context Validation**: Validate context completeness before deployment
8. **Context Versioning**: Track context changes over time

## Migration Notes

### For Service Developers

If you're working on deployment-related services:

1. **Import ServiceContextService** from `@/core/modules/context/services/service-context.service`
2. **Use `buildServiceContext()`** to create contexts from database entities
3. **Pass ServiceContext** to Traefik resolver instead of manual contexts
4. **Extract domains** using `getDomainOrPrimary()` utility
5. **Access environment** using `getMergedEnvironment()` for project + service vars

### Breaking Changes

None - the old `VariableResolutionContext` is still supported. New methods provide an alternative approach.

## Related Documentation

- [`SERVICE-CONTEXT-SYSTEM.md`](./SERVICE-CONTEXT-SYSTEM.md) - Complete Service Context documentation
- [`docs/architecture/TRAEFIK-DATABASE-ARCHITECTURE.md`](../architecture/TRAEFIK-DATABASE-ARCHITECTURE.md) - Traefik integration
- [`docs/concepts/SERVICE-ADAPTER-PATTERN.md`](../concepts/SERVICE-ADAPTER-PATTERN.md) - Service patterns
