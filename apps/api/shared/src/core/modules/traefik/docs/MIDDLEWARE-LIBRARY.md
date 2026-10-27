# Middleware Library

> **Last Updated**: 2025-11-29

## Overview

The TraefikMiddlewareLibraryService provides pre-built, customizable middleware configurations that follow Traefik best practices. This eliminates boilerplate and ensures consistent middleware usage across services.

## Available Middlewares

### Rate Limiting

```typescript
// Basic rate limiter
const rateLimiter = middlewareLibrary.getRateLimiter({
  name: 'api-rate-limit',
  average: 100,
  burst: 50
});

// Advanced rate limiter with source criterion
const advancedRateLimiter = middlewareLibrary.getRateLimiter({
  name: 'api-rate-limit',
  average: 100,
  burst: 50,
  period: '1m',
  sourceCriterion: {
    ipStrategy: {
      depth: 1,
      excludedIPs: ['127.0.0.1/32']
    }
  }
});
```

**Configuration Options**:
```typescript
interface RateLimiterOptions {
  name: string;
  average: number;          // Requests per period
  burst?: number;           // Max burst (default: average * 1.5)
  period?: string;          // Rate period (default: '1s')
  sourceCriterion?: {
    ipStrategy?: {
      depth?: number;
      excludedIPs?: string[];
    };
    requestHeaderName?: string;
    requestHost?: boolean;
  };
}
```

### CORS

```typescript
// Basic CORS (allow all origins)
const basicCors = middlewareLibrary.getCors({
  name: 'api-cors',
  allowOrigins: ['*']
});

// Production CORS
const prodCors = middlewareLibrary.getCors({
  name: 'api-cors',
  allowOrigins: ['https://app.example.com', 'https://admin.example.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID'],
  maxAge: 86400,
  allowCredentials: true
});
```

**Configuration Options**:
```typescript
interface CorsOptions {
  name: string;
  allowOrigins: string[];
  allowMethods?: string[];      // Default: GET,POST,PUT,DELETE,OPTIONS
  allowHeaders?: string[];      // Default: Content-Type,Authorization
  exposeHeaders?: string[];
  maxAge?: number;              // Preflight cache (seconds)
  allowCredentials?: boolean;
}
```

### Security Headers

```typescript
// Standard security headers
const securityHeaders = middlewareLibrary.getSecurityHeaders({
  name: 'security-headers'
});

// Strict security headers
const strictHeaders = middlewareLibrary.getSecurityHeaders({
  name: 'strict-security',
  contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  contentTypeNosniff: true,
  frameOptions: 'DENY',
  xssProtection: '1; mode=block',
  referrerPolicy: 'strict-origin-when-cross-origin'
});
```

**Configuration Options**:
```typescript
interface SecurityHeadersOptions {
  name: string;
  contentSecurityPolicy?: string;
  strictTransportSecurity?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  contentTypeNosniff?: boolean;
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  xssProtection?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}
```

### Compression

```typescript
// Default compression
const compression = middlewareLibrary.getCompression({
  name: 'compress'
});

// Custom compression
const customCompression = middlewareLibrary.getCompression({
  name: 'compress',
  excludedContentTypes: ['image/jpeg', 'image/png', 'image/gif'],
  minResponseBodyBytes: 1024
});
```

**Configuration Options**:
```typescript
interface CompressionOptions {
  name: string;
  excludedContentTypes?: string[];
  minResponseBodyBytes?: number;
}
```

### Authentication

#### Basic Auth

```typescript
// Basic authentication
const basicAuth = middlewareLibrary.getBasicAuth({
  name: 'admin-auth',
  users: [
    'admin:$apr1$xxx$yyy',  // htpasswd format
    'user:$apr1$aaa$bbb'
  ],
  realm: 'Admin Area',
  removeHeader: true
});
```

**Configuration Options**:
```typescript
interface BasicAuthOptions {
  name: string;
  users: string[];          // htpasswd format
  realm?: string;
  removeHeader?: boolean;
  headerField?: string;
}
```

#### Forward Auth

```typescript
// Forward authentication to external service
const forwardAuth = middlewareLibrary.getForwardAuth({
  name: 'oauth-auth',
  address: 'http://auth-service:9091/auth',
  trustForwardHeader: true,
  authResponseHeaders: ['X-User-ID', 'X-User-Email', 'X-User-Roles']
});
```

**Configuration Options**:
```typescript
interface ForwardAuthOptions {
  name: string;
  address: string;
  trustForwardHeader?: boolean;
  authResponseHeaders?: string[];
  authResponseHeadersRegex?: string;
  authRequestHeaders?: string[];
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    insecureSkipVerify?: boolean;
  };
}
```

#### JWT Auth (Plugin)

```typescript
// JWT authentication (requires traefik-jwt-middleware plugin)
const jwtAuth = middlewareLibrary.getJwtAuth({
  name: 'jwt-auth',
  secret: '{{JWT_SECRET}}',
  alg: 'HS256',
  headerName: 'Authorization',
  extractFrom: 'bearer'
});
```

### Retry

```typescript
// Basic retry
const retry = middlewareLibrary.getRetry({
  name: 'retry',
  attempts: 3
});

// Advanced retry
const advancedRetry = middlewareLibrary.getRetry({
  name: 'retry',
  attempts: 4,
  initialInterval: '100ms'
});
```

**Configuration Options**:
```typescript
interface RetryOptions {
  name: string;
  attempts: number;
  initialInterval?: string;  // Default: '100ms'
}
```

### Circuit Breaker

```typescript
// Circuit breaker
const circuitBreaker = middlewareLibrary.getCircuitBreaker({
  name: 'circuit-breaker',
  expression: 'ResponseCodeRatio(500, 600, 0, 600) > 0.25'
});
```

**Configuration Options**:
```typescript
interface CircuitBreakerOptions {
  name: string;
  expression: string;
  checkPeriod?: string;
  fallbackDuration?: string;
  recoveryDuration?: string;
}
```

### Path Manipulation

#### Strip Prefix

```typescript
// Remove path prefix
const stripPrefix = middlewareLibrary.getStripPrefix({
  name: 'strip-api',
  prefixes: ['/api', '/v1']
});
```

#### Add Prefix

```typescript
// Add path prefix
const addPrefix = middlewareLibrary.getAddPrefix({
  name: 'add-version',
  prefix: '/v2'
});
```

#### Replace Path

```typescript
// Replace path
const replacePath = middlewareLibrary.getReplacePath({
  name: 'replace-root',
  path: '/index.html'
});
```

#### Replace Path Regex

```typescript
// Regex path replacement
const replacePathRegex = middlewareLibrary.getReplacePathRegex({
  name: 'version-rewrite',
  regex: '^/api/v[0-9]+/(.*)',
  replacement: '/api/$1'
});
```

### Redirects

#### HTTPS Redirect

```typescript
// HTTP to HTTPS redirect
const httpsRedirect = middlewareLibrary.getRedirectScheme({
  name: 'https-redirect',
  scheme: 'https',
  permanent: true
});
```

#### Regex Redirect

```typescript
// Regex-based redirect
const wwwRedirect = middlewareLibrary.getRedirectRegex({
  name: 'www-redirect',
  regex: '^https?://www\\.(.+)',
  replacement: 'https://${1}',
  permanent: true
});
```

### IP Filtering

#### IP Allow List

```typescript
// IP whitelist
const ipWhitelist = middlewareLibrary.getIPAllowList({
  name: 'internal-only',
  sourceRange: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
  ipStrategy: { depth: 1 }
});
```

### Headers

```typescript
// Custom headers
const customHeaders = middlewareLibrary.getHeaders({
  name: 'custom-headers',
  customRequestHeaders: {
    'X-Forwarded-Proto': 'https',
    'X-Request-ID': '{{UUID}}'
  },
  customResponseHeaders: {
    'X-Powered-By': 'MyApp',
    'Cache-Control': 'no-store'
  }
});
```

### Buffering

```typescript
// Request/response buffering
const buffering = middlewareLibrary.getBuffering({
  name: 'large-upload',
  maxRequestBodyBytes: 10485760,  // 10MB
  memRequestBodyBytes: 2097152,   // 2MB in memory
  maxResponseBodyBytes: 10485760,
  retryExpression: 'IsNetworkError() && Attempts() < 2'
});
```

## Middleware Chains

The library provides pre-built middleware chains for common scenarios.

### API Chain

```typescript
const apiChain = middlewareLibrary.getApiChain({
  name: 'api-chain',
  rateLimit: { average: 100, burst: 50 },
  cors: { allowOrigins: ['https://app.example.com'] },
  compression: true,
  securityHeaders: true
});

// Results in chain: api-chain (combines rate-limit, cors, compress, security)
```

### Web Application Chain

```typescript
const webChain = middlewareLibrary.getWebAppChain({
  name: 'web-chain',
  httpsRedirect: true,
  securityHeaders: true,
  compression: true,
  wwwRedirect: { stripWww: true, domain: 'example.com' }
});
```

### Admin Panel Chain

```typescript
const adminChain = middlewareLibrary.getAdminChain({
  name: 'admin-chain',
  ipAllowList: ['10.0.0.0/8'],
  basicAuth: { users: ['admin:$apr1$...'] },
  rateLimit: { average: 20, burst: 10 },
  securityHeaders: true
});
```

## Usage with TraefikConfigBuilder

```typescript
const builder = new TraefikConfigBuilder();

// Get middleware from library
const rateLimiter = middlewareLibrary.getRateLimiter({
  name: 'api-limit',
  average: 100,
  burst: 50
});

const cors = middlewareLibrary.getCors({
  name: 'api-cors',
  allowOrigins: ['https://app.example.com']
});

// Add to builder
builder
  .addMiddleware('api-limit', rateLimiter.config)
  .addMiddleware('api-cors', cors.config)
  .addRouter('api', {
    rule: 'Host(`api.example.com`)',
    service: 'api-service',
    middlewares: ['api-limit', 'api-cors']
  });
```

## Storing Middleware in Database

```typescript
// Store global middleware
await traefikService.createMiddleware({
  name: 'global-rate-limit',
  scope: 'global',
  config: middlewareLibrary.getRateLimiter({
    name: 'global-rate-limit',
    average: 1000,
    burst: 200
  }).config
});

// Store project-local middleware
await traefikService.createMiddleware({
  name: 'project-auth',
  scope: 'local',
  projectId: 'proj_123',
  config: middlewareLibrary.getForwardAuth({
    name: 'project-auth',
    address: 'http://auth:9091/verify'
  }).config
});
```

## Best Practices

### 1. Use Library Over Manual Configuration

```typescript
// ✅ Good: Use library
const rateLimiter = middlewareLibrary.getRateLimiter({
  name: 'limit',
  average: 100,
  burst: 50
});

// ❌ Bad: Manual configuration
builder.addMiddleware('limit', {
  rateLimit: {
    average: 100,
    burst: 50
  }
});
```

### 2. Centralize Common Middleware

```typescript
// ✅ Good: Define once, use everywhere
const globalMiddlewares = {
  rateLimit: middlewareLibrary.getRateLimiter({ name: 'global-limit', average: 100 }),
  security: middlewareLibrary.getSecurityHeaders({ name: 'security' }),
  cors: middlewareLibrary.getCors({ name: 'cors', allowOrigins: ['*'] })
};

// Apply to all services
services.forEach(svc => {
  builder.addRouter(svc.name, {
    ...svc.config,
    middlewares: ['global-limit', 'security', 'cors']
  });
});
```

### 3. Layer Middleware Appropriately

```typescript
// ✅ Good: Layer from general to specific
middlewares: [
  'global-rate-limit',    // First: Rate limit
  'global-security',      // Then: Security headers
  'api-cors',             // Then: CORS
  'service-auth',         // Then: Auth
  'service-strip-prefix'  // Finally: Path manipulation
]
```

### 4. Use Chains for Common Patterns

```typescript
// ✅ Good: Use pre-built chain
const apiMiddleware = middlewareLibrary.getApiChain({ ... });

// ❌ Bad: Build chain manually each time
const middlewares = [
  middlewareLibrary.getRateLimiter(...),
  middlewareLibrary.getCors(...),
  middlewareLibrary.getSecurityHeaders(...),
  middlewareLibrary.getCompression(...)
];
```

### 5. Document Custom Middleware

```typescript
// ✅ Good: Include documentation in metadata
await traefikService.createMiddleware({
  name: 'custom-auth',
  config: customAuthConfig,
  metadata: {
    description: 'Custom OAuth2 authentication for partner APIs',
    author: 'Security Team',
    version: '1.0.0',
    requirements: ['auth-service must be running']
  }
});
```

## Middleware Reference Table

| Middleware | Use Case | Key Options |
|------------|----------|-------------|
| `rateLimit` | Traffic control | average, burst, period |
| `cors` | Cross-origin requests | allowOrigins, allowMethods |
| `securityHeaders` | Security hardening | CSP, HSTS, X-Frame-Options |
| `compress` | Response compression | excludedContentTypes |
| `basicAuth` | Simple authentication | users, realm |
| `forwardAuth` | External auth service | address, authResponseHeaders |
| `retry` | Fault tolerance | attempts, initialInterval |
| `circuitBreaker` | Cascading failure prevention | expression |
| `stripPrefix` | Path rewriting | prefixes |
| `redirectScheme` | HTTPS enforcement | scheme, permanent |
| `ipAllowList` | IP filtering | sourceRange |
| `headers` | Custom headers | customRequest/ResponseHeaders |
| `buffering` | Large payload handling | maxRequestBodyBytes |
