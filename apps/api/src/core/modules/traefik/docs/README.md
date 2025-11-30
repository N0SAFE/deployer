# Traefik Module Documentation

> **Module Path**: `apps/api/src/core/modules/traefik/`  
> **Module Name**: `TraefikCoreModule`  
> **Last Updated**: 2025-11-29

## Overview

The Traefik module provides a comprehensive system for managing Traefik reverse proxy configurations through a database-driven approach. It supports type-safe configuration building, template-based deployment, virtual filesystem abstraction, and real-time synchronization.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture](./ARCHITECTURE.md) | System architecture, component relationships, data flow |
| [Config Builders](./CONFIG-BUILDERS.md) | Type-safe Traefik configuration builders |
| [Virtual Filesystem](./VIRTUAL-FILESYSTEM.md) | Database-backed virtual filesystem |
| [Sync System](./SYNC-SYSTEM.md) | Configuration synchronization to real filesystem |
| [Error Handling](./ERROR-HANDLING.md) | Error classes and handling patterns |
| [Events](./EVENTS.md) | Real-time event system |
| [Middleware Library](./MIDDLEWARE-LIBRARY.md) | Pre-built middleware configurations |
| [API Reference](./API-REFERENCE.md) | Service APIs and interfaces |

## Quick Start

### Basic Usage

```typescript
import { TraefikService } from '@/core/modules/traefik/services/traefik.service';

@Injectable()
export class MyService {
  constructor(private readonly traefikService: TraefikService) {}

  async deployService() {
    // Create service configuration
    await this.traefikService.deployServiceConfiguration('my-service', {
      domain: 'example.com',
      subdomain: 'api',
      port: 3000,
      sslEnabled: true,
    });

    // Sync to filesystem
    await this.traefikService.syncServiceConfiguration('my-service');
  }
}
```

### Using Config Builders

```typescript
import { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders';

const config = new TraefikConfigBuilder()
  .addRouter('api-router', r => r
    .rule('Host(`api.example.com`)')
    .service('api-service')
    .entryPoints('websecure')
    .tls({ certResolver: 'letsencrypt' })
  )
  .addService('api-service', s => s
    .loadBalancer(lb => lb
      .server('http://api:3000')
      .healthCheck(hc => hc.path('/health').interval('10s'))
    )
  )
  .addMiddleware('cors', m => m
    .cors({
      origins: ['https://example.com'],
      methods: ['GET', 'POST'],
      credentials: true,
    })
  )
  .build();
```

## Module Structure

```
traefik/
├── traefik.module.ts           # NestJS module definition
├── docs/                       # Documentation
├── errors/                     # Error classes
├── config-builder/             # Type-safe builders
│   ├── builders/               # Builder implementations
│   ├── types/                  # TypeScript type definitions
│   └── variables/              # Variable system (Zod-based)
├── repositories/               # Database access
└── services/                   # Business logic
    ├── traefik.service.ts                  # Main facade
    ├── traefik-file-system.service.ts      # Virtual FS
    ├── traefik-sync.service.ts             # Sync operations
    ├── traefik-template.service.ts         # Template rendering
    ├── traefik-validation.service.ts       # Config validation
    ├── traefik-variable-resolver.service.ts # Variable resolution
    ├── traefik-event.service.ts            # Real-time events
    └── traefik-middleware-library.service.ts # Middleware presets
```

## Key Concepts

### 1. Database as Source of Truth

All configurations are stored in the database. The filesystem is treated as a cache/output destination only.

```
Database (Source) → Virtual FS (View) → Real FS (Output for Traefik)
```

### 2. Type-Safe Configuration

Use the config builder system for compile-time type safety:

```typescript
// ✅ Type-safe - caught at compile time
builder.addRouter('api', r => r.rule('Host(`example.com`)').service('api-svc'));

// ❌ Runtime error - missing required properties
builder.addRouter('api', r => r.rule('Host(`example.com`)')); // No service!
```

### 3. Variable Resolution

Two variable syntaxes are supported:

| Syntax | Service | Use Case |
|--------|---------|----------|
| `~##varName##~` | TraefikTemplateService | Template rendering |
| `{{varName}}` | Config Builder VariableResolver | Runtime config building |

### 4. Optimized Sync

Only changed configurations are synced:

```typescript
// Only syncs configs where: updatedAt > lastSyncedAt OR lastSyncedAt IS NULL
await traefikService.syncAllConfigurations();
```

## Architecture Rules

### ✅ DO

1. **Use Repository for all DB operations**
2. **Keep virtual FS separate from real FS**
3. **Check sync status before operations**
4. **Use error classes for exceptions**
5. **Emit events for config changes**

### ❌ DON'T

1. **Don't bypass repository layer**
2. **Don't mix virtual/real FS operations**
3. **Don't store secrets in plain text**
4. **Don't ignore sync status**
5. **Don't create circular dependencies**

## Related Documentation

- [Traefik Official Docs](https://doc.traefik.io/traefik/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [NestJS Modules](https://docs.nestjs.com/modules)

## Support

For issues or questions, check:
1. Error handling documentation
2. API reference
3. Architecture diagrams
