# Configuration Builders

> **Last Updated**: 2025-01-29

## Overview

The Traefik module uses a fluent builder pattern for creating type-safe configurations. This eliminates YAML formatting errors and provides IntelliSense support.

## TraefikConfigBuilder

The main builder for creating complete Traefik configurations.

### Basic Usage

```typescript
import { TraefikConfigBuilder } from './config-builder/builders/traefik-config-builder';
import { HttpRouterBuilder, ServiceBuilder, MiddlewareBuilder } from './config-builder/builders';

// Create a builder using fluent API with sub-builders
const builder = new TraefikConfigBuilder()
  // Add a router using builder callback
  .addRouter('my-service', r => r
    .entryPoints(['websecure'])
    .rule('Host(`example.com`)')
    .service('my-service')
    .middlewares(['auth@file'])
    .tls({ certResolver: 'letsencrypt' })
  )
  // Add a service
  .addService('my-service', s => s
    .loadBalancer(lb => lb
      .server('http://backend:8080')
      .healthCheck({ path: '/health', interval: '10s' })
    )
  )
  // Add middleware
  .addMiddleware('rate-limit', m => m
    .rateLimit({ average: 100, burst: 50 })
  );

// Build raw config (variables not resolved)
const rawConfig = builder.build();

// Compile with variable resolution (context required)
const context = { domain: 'example.com', port: '8080' };
const compiledConfig = builder.compile(context);

// Output formats (require context for variable resolution)
const yaml = builder.toYAML(context);
const json = builder.toJSON(context);
```

### Loading Existing Configurations

```typescript
// Load from YAML string
const builder = TraefikConfigBuilder.load(`
http:
  routers:
    api:
      rule: Host(\`example.com\`)
      service: api-service
`);

// Load from JSON string
const builder = TraefikConfigBuilder.load('{"http":{"routers":{}}}');

// Load from object
const builder = TraefikConfigBuilder.load({
  http: {
    routers: {
      api: { rule: 'Host(`example.com`)', service: 'api-service' }
    }
  }
});
```

### Builder Methods

> **Important**: The builder pattern uses `addRouter`, `addService`, `addMiddleware` methods. Getter/update/remove methods like `getRouter()`, `updateRouter()`, `removeRouter()` are **not implemented**. To modify existing configs, use `build()` to get the raw config, modify it, and use `TraefikConfigBuilder.load()` to create a new builder.

#### Adding Routers

```typescript
// Add a router with builder callback (recommended)
builder.addRouter('name', r => r
  .entryPoints(['web', 'websecure'])
  .rule('Host(`example.com`)')
  .service('my-service')
);

// Add a router with pre-built HttpRouterBuilder
const routerBuilder = new HttpRouterBuilder('name')
  .rule('Host(`example.com`)')
  .service('my-service');
builder.addRouter('name', routerBuilder);
```

**HttpRouterBuilder Methods**:
```typescript
class HttpRouterBuilder {
  rule(rule: string): this;
  service(name: string): this;
  entryPoints(points: string[]): this;
  middlewares(names: string[]): this;
  priority(value: number): this;
  tls(options: TLSOptions): this;
  build(): { name: string; config: HttpRouterConfig };
}
```

#### Services

```typescript
// Add a service
builder.addService('name', options);

// Service types
interface ServiceConfig {
  loadBalancer?: {
    servers: { url: string }[];
    sticky?: { cookie: { name: string } };
    healthCheck?: {
      path: string;
      interval?: string;
      timeout?: string;
    };
    passHostHeader?: boolean;
  };
  weighted?: {
    services: { name: string; weight: number }[];
  };
  mirroring?: {
    service: string;
    mirrors: { name: string; percent: number }[];
  };
}
```

#### Middlewares

```typescript
// Add middleware
builder.addMiddleware('name', config);

// Middleware types
interface MiddlewareConfig {
  rateLimit?: { average: number; burst: number };
  basicAuth?: { users: string[] };
  headers?: { 
    customRequestHeaders?: Record<string, string>;
    customResponseHeaders?: Record<string, string>;
  };
  stripPrefix?: { prefixes: string[] };
  redirectScheme?: { scheme: string; permanent?: boolean };
  compress?: Record<string, never>;  // Empty object
  retry?: { attempts: number };
  circuitBreaker?: { expression: string };
  // ... many more
}
```

### TLS Configuration

The `configureTLS` method uses a callback pattern with `TLSBuilder`:

```typescript
// Configure TLS with certificates (callback pattern)
builder.configureTLS(tls => tls
  .certificate('/certs/cert.pem', '/certs/key.pem')
  .minVersion('VersionTLS12')
);

// Configure TLS options and stores
builder.configureTLS(tls => tls
  .certificate('/certs/cert.pem', '/certs/key.pem', ['default'])
  .minVersion('VersionTLS12')
  .maxVersion('VersionTLS13')
  .cipherSuites('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384')
);

// Default certificate for store
builder.configureTLS(tls => tls
  .defaultCertificate('/certs/default.pem', '/certs/default-key.pem')
);

// Client authentication
builder.configureTLS(tls => tls
  .clientAuth(['/certs/ca.pem'], 'RequireAndVerifyClientCert')
);

// Named TLS options
builder.configureTLS(tls => tls
  .options('modern-tls', {
    minVersion: 'VersionTLS13',
    curvePreferences: ['CurveP521', 'CurveP384']
  })
);
```

**TLSBuilder Methods:**

| Method | Description |
|--------|-------------|
| `certificate(certFile, keyFile, stores?)` | Add a certificate |
| `certificates(certs)` | Add multiple certificates |
| `defaultCertificate(certFile, keyFile)` | Set default certificate for store |
| `minVersion(version)` | Set minimum TLS version |
| `maxVersion(version)` | Set maximum TLS version |
| `cipherSuites(...suites)` | Set allowed cipher suites |
| `clientAuth(caFiles, authType?)` | Configure client authentication |
| `options(name, config)` | Add named TLS options |
| `store(name, config)` | Configure TLS store |

> **Note**: For router-level TLS (certResolver, domains), configure the `tls` option directly in `addRouter`:
> ```typescript
> builder.addRouter('secure', router => router
>   .rule('Host(`example.com`)')
>   .service('my-service')
>   .tls({ certResolver: 'letsencrypt', domains: [{ main: 'example.com' }] })
> );
> ```

### Output Formats

The output methods **require a `VariableContext`** for variable resolution:

```typescript
import { VariableContext } from '../interfaces';

// Create a variable context
const context: VariableContext = {
  serviceName: 'my-app',
  domain: 'app.example.com',
  port: '8080'
};

// YAML output (for Traefik file provider)
const yaml = builder.toYAML(context);

// JSON output (for API responses) 
const json = builder.toJSON(context);

// Raw compiled object without variable resolution (internal use)
const compiled = builder.compile();
```

> **Important**: `toYAML()` and `toJSON()` resolve `{{variable}}` placeholders using the provided context. Always provide a context with all required variables to avoid unresolved placeholders in output.

## Variable System

The builder supports two variable syntaxes for different use cases.

### Template Variables (~##var##~)

Used in templates, resolved at **render time**.

```typescript
// Template with variables
const template = `
http:
  routers:
    ~##serviceName##~:
      rule: "Host(\`~##domain##~\`)"
      service: ~##serviceName##~
`;

// Resolved by TraefikTemplateService
const rendered = templateService.parseTemplate(template, {
  serviceName: 'my-app',
  domain: 'app.example.com'
});
```

### Config Builder Variables ({{var}})

Used directly in TraefikConfigBuilder, resolved by **TraefikVariableResolverService**.

```typescript
const builder = new TraefikConfigBuilder()
  .addRouter('{{serviceName}}', {
    rule: 'Host(`{{domain}}`)',
    service: '{{serviceName}}'
  });

// Resolve at runtime
const resolvedBuilder = variableResolver.resolveBuilder(builder, {
  serviceName: 'my-app',
  domain: 'app.example.com'
});
```

### Built-in Variables

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `serviceName` | Service identifier | `my-app` |
| `serviceId` | Unique service ID | `abc123` |
| `domain` | Primary domain | `app.example.com` |
| `projectName` | Project name | `my-project` |
| `projectId` | Project unique ID | `proj_123` |
| `port` | Backend port | `8080` |
| `host` | Backend host | `backend.local` |
| `scheme` | URL scheme | `http` |
| `entrypoint` | Traefik entrypoint | `websecure` |

## Builder Patterns

### Service Configuration Pattern

```typescript
// Complete service configuration using callback pattern
const config = new TraefikConfigBuilder()
  // Router with TLS
  .addRouter('my-service', router => router
    .entryPoints(['websecure'])
    .rule('Host(`{{domain}}`) && PathPrefix(`/api`)')
    .service('my-service')
    .middlewares(['rate-limit', 'strip-prefix'])
    .tls({ certResolver: 'letsencrypt' })
  )
  // HTTP to HTTPS redirect
  .addRouter('my-service-redirect', router => router
    .entryPoints(['web'])
    .rule('Host(`{{domain}}`)')
    .middlewares(['redirect-https'])
    .service('noop@internal')
  )
  // Load balanced service (using LoadBalancerBuilder callback)
  .addService('my-service', service => service
    .loadBalancer(lb => lb
      .server('http://{{host}}:{{port}}')
      .healthCheck('/health', { interval: '10s' })
    )
  )
  // Rate limiting middleware
  .addMiddleware('rate-limit', mw => mw
    .rateLimit(100, 50)
  )
  // Path prefix strip middleware
  .addMiddleware('strip-prefix', mw => mw
    .stripPrefix('/api')
  );
```

### Multi-Service Pattern

```typescript
// Multiple services with shared middleware
const config = new TraefikConfigBuilder()
  // Shared middlewares
  .addMiddleware('global-rate-limit', mw => mw
    .rateLimit(1000, 200)
  )
  .addMiddleware('security-headers', mw => mw
    .headers({
      stsSeconds: 31536000,
      stsIncludeSubdomains: true,
      stsPreload: true,
      contentSecurityPolicy: "default-src 'self'"
    })
  );

// Add multiple services dynamically
services.forEach(svc => {
  config
    .addRouter(svc.name, router => router
      .entryPoints(['websecure'])
      .rule(`Host(\`${svc.domain}\`)`)
      .service(svc.name)
      .middlewares(['global-rate-limit', 'security-headers'])
    )
    .addService(svc.name, service => service
      .loadBalancer(lb => lb.server(svc.backendUrl))
    );
});
```

### Weighted Routing Pattern

```typescript
// Blue/green or canary deployment using callback pattern
const config = new TraefikConfigBuilder()
  // Main router pointing to weighted service
  .addRouter('app', router => router
    .entryPoints(['websecure'])
    .rule('Host(`app.example.com`)')
    .service('app-weighted')
  )
  // Weighted service for canary deployment
  .addService('app-weighted', service => service
    .weighted([
      { name: 'app-v1', weight: 90 },
      { name: 'app-v2', weight: 10 }
    ])
  )
  // Backend service v1 (90% traffic)
  .addService('app-v1', service => service
    .loadBalancer(lb => lb.server('http://app-v1:8080'))
  )
  // Backend service v2 (10% traffic - canary)
  .addService('app-v2', service => service
    .loadBalancer(lb => lb.server('http://app-v2:8080'))
  );
```

## Drizzle ORM Integration

The builder integrates with Drizzle ORM via a custom column type.

### Custom Type Definition

```typescript
// apps/api/src/config/drizzle/custom-types/traefik-config-builder.ts
import { customType } from 'drizzle-orm/pg-core';
import { TraefikConfigBuilder } from '../../../core/modules/traefik/config-builder/builders/traefik-config-builder';

export const traefikConfigBuilder = customType<{
  data: TraefikConfigBuilder;
  driverData: Record<string, unknown>;
}>({
  dataType() {
    return 'jsonb';
  },
  toDriver(value: TraefikConfigBuilder) {
    return serializeTraefikConfigBuilder(value);
  },
  fromDriver(value: unknown) {
    return deserializeTraefikConfigBuilder(value);
  }
});
```

### Schema Usage

```typescript
// In schema definition
export const traefikServiceConfigs = pgTable('traefik_service_configs', {
  id: text('id').primaryKey(),
  config: traefikConfigBuilder('config').notNull(),
  // ... other columns
});
```

### Repository Usage

```typescript
// Automatic serialization/deserialization
const config = await db.query.traefikServiceConfigs.findFirst({
  where: eq(traefikServiceConfigs.id, configId)
});

// config.config is already a TraefikConfigBuilder instance!
// Provide context for variable resolution
const context = { serviceName: 'my-app', domain: 'app.example.com' };
const yaml = config.config.toYAML(context);

// Insert also works automatically
await db.insert(traefikServiceConfigs).values({
  id: 'new-id',
  config: new TraefikConfigBuilder().addRouter('service', router => router
    .rule('Host(`{{domain}}`)')
    .service('my-service')
  ),
});
```

## Best Practices

### 1. Always Use Builder Pattern

```typescript
// ✅ Good: Type-safe and validated (use callback pattern)
const config = new TraefikConfigBuilder()
  .addRouter('my-router', router => router
    .rule('Host(`example.com`)')
    .service('my-service')
  );

// ❌ Bad: Manual YAML construction
const yaml = `
http:
  routers:
    my-router: ...
`;
```

### 2. Use Variables for Dynamic Values

```typescript
// ✅ Good: Reusable configuration with variables
builder.addRouter('{{serviceName}}', router => router
  .rule('Host(`{{domain}}`)')
  .service('{{serviceName}}')
);

// ❌ Bad: Hardcoded values
builder.addRouter('my-app', router => router
  .rule('Host(`my-app.example.com`)')
  .service('my-app')
);
```

### 3. Store Builders, Not YAML

```typescript
// ✅ Good: Store TraefikConfigBuilder in database
await repository.saveConfig({
  config: builder, // Custom type handles serialization
});

// ❌ Bad: Store YAML strings
const context = { serviceName: 'my-app' };
await repository.saveConfig({
  yamlContent: builder.toYAML(context), // Loses type safety
});
```

### 4. Validate Before Sync

```typescript
// Always validate before writing to real filesystem
// Note: validateConfig returns synchronously
const context = { serviceName: 'my-app', domain: 'app.example.com' };
const validation = validationService.validateConfig(
  builder.toYAML(context)
);

if (!validation.isValid) {
  throw new TraefikValidationError('Config validation failed', validation.errors);
