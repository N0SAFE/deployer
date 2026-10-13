# Service Domain Mapping

> **Last Updated**: 2025-11-30

## Overview

Service domain mapping connects deployed services to specific URLs using a combination of subdomain and base path. This allows flexible routing configurations where multiple services can share the same domain.

**Important**: The subdomain you can use depends on what domain was registered at the organization level. See [Granularity Rules](#granularity-rules) below.

## URL Structure

```
https://[subdomain.]registered_domain[/basePath]
       └────┬─────┘ └───────┬───────┘ └────┬────┘
          Optional      Registered     Optional
         Subdomain       Domain       Base Path
```

### Multi-Level Subdomains

Subdomains can be nested to any depth. The `subdomain` field supports multi-level subdomains:

```
api.example.com                    → subdomain: "api"
staging.api.example.com            → subdomain: "staging.api"
v2.staging.api.example.com         → subdomain: "v2.staging.api"
feature-x.dev.api.example.com      → subdomain: "feature-x.dev.api"
```

**Note**: Each level is separated by a dot (`.`). The full subdomain string is stored as-is.

## Granularity Rules

**Critical**: Service mappings can ONLY use subdomains **at or below** the registered domain level. They CANNOT use parent (higher-level) domains.

### Examples by Registered Domain

**If registered domain is `example.com` (root)**:
| Subdomain | Base Path | Full URL | Status |
|-----------|-----------|----------|--------|
| `null` | `null` | `https://example.com/` | ✅ Valid |
| `"api"` | `"/v1"` | `https://api.example.com/v1` | ✅ Valid |
| `"staging.api"` | `null` | `https://staging.api.example.com/` | ✅ Valid |

**If registered domain is `api.example.com` (subdomain)**:
| Subdomain | Base Path | Full URL | Status |
|-----------|-----------|----------|--------|
| `null` | `null` | `https://api.example.com/` | ✅ Valid (exact) |
| `"staging"` | `"/v1"` | `https://staging.api.example.com/v1` | ✅ Valid (child) |
| `"v2.staging"` | `null` | `https://v2.staging.api.example.com/` | ✅ Valid (nested child) |
| `null` on parent | `null` | `https://example.com/` | ❌ **INVALID** (parent domain) |
| `"www"` on parent | `null` | `https://www.example.com/` | ❌ **INVALID** (sibling domain) |

**If registered domain is `feat.api.example.com` (nested subdomain)**:
| Subdomain | Base Path | Full URL | Status |
|-----------|-----------|----------|--------|
| `null` | `null` | `https://feat.api.example.com/` | ✅ Valid (exact) |
| `"v2"` | `null` | `https://v2.feat.api.example.com/` | ✅ Valid (child) |
| On `api.example.com` | `null` | `https://api.example.com/` | ❌ **INVALID** (parent) |
| On `example.com` | `null` | `https://example.com/` | ❌ **INVALID** (grandparent) |

### URL Examples Table

| Subdomain | Base Path | Full URL |
|-----------|-----------|----------|
| `null` | `null` | `https://example.com/` |
| `"www"` | `null` | `https://www.example.com/` |
| `"api"` | `null` | `https://api.example.com/` |
| `"api"` | `"/v1"` | `https://api.example.com/v1` |
| `"api"` | `"/v2"` | `https://api.example.com/v2` |
| `null` | `"/docs"` | `https://example.com/docs` |
| `"admin"` | `"/dashboard"` | `https://admin.example.com/dashboard` |
| `"staging.api"` | `"/v1"` | `https://staging.api.example.com/v1` |
| `"v2.staging.api"` | `null` | `https://v2.staging.api.example.com/` |
| `"feature-123.dev"` | `null` | `https://feature-123.dev.example.com/` |

## Creating Service Mappings

### Basic Mapping

```typescript
// Map frontend to www.example.com
const frontendMapping = await serviceMappingRepository.create({
  serviceId: 'svc_frontend',
  projectDomainId: projectDomain.id,
  subdomain: 'www',
  basePath: null,            // Root path
  isPrimary: true,
  sslEnabled: true,
  sslProvider: 'letsencrypt',
});
```

### API Versioning

```typescript
// API v1: api.example.com/v1
await serviceMappingRepository.create({
  serviceId: 'svc_api_v1',
  projectDomainId: projectDomain.id,
  subdomain: 'api',
  basePath: '/v1',
  isPrimary: true,
  sslEnabled: true,
});

// API v2: api.example.com/v2
await serviceMappingRepository.create({
  serviceId: 'svc_api_v2',
  projectDomainId: projectDomain.id,
  subdomain: 'api',
  basePath: '/v2',
  isPrimary: true,
  sslEnabled: true,
});
```

### Root Domain with Path

```typescript
// Documentation at example.com/docs
await serviceMappingRepository.create({
  serviceId: 'svc_docs',
  projectDomainId: projectDomain.id,
  subdomain: null,           // No subdomain = root domain
  basePath: '/docs',
  isPrimary: true,
  sslEnabled: true,
});
```

## Schema Reference

```typescript
interface ServiceDomainMapping {
  id: string;
  serviceId: string;              // Target service
  projectDomainId: string;        // Parent project domain
  
  // URL Configuration
  subdomain: string | null;       // null = root domain
  basePath: string | null;        // null = root path "/"
  
  // Priority
  isPrimary: boolean;             // Primary URL for this service
  
  // SSL Configuration
  sslEnabled: boolean;            // Enable HTTPS (default: true)
  sslProvider: 'letsencrypt' | 'custom' | 'none';
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
}
```

## Computed Full URL

The system computes the full URL by joining data from multiple tables:

```typescript
async getFullUrl(mappingId: string): Promise<string | null> {
  const result = await db
    .select({
      subdomain: serviceDomainMappings.subdomain,
      basePath: serviceDomainMappings.basePath,
      orgDomain: organizationDomains.domain,
    })
    .from(serviceDomainMappings)
    .innerJoin(projectDomains, eq(serviceDomainMappings.projectDomainId, projectDomains.id))
    .innerJoin(organizationDomains, eq(projectDomains.organizationDomainId, organizationDomains.id))
    .where(eq(serviceDomainMappings.id, mappingId));

  const { subdomain, basePath, orgDomain } = result[0];
  
  // Build URL
  const domain = subdomain ? `${subdomain}.${orgDomain}` : orgDomain;
  return `https://${domain}${basePath || ''}`;
}
```

## SSL Configuration

### Let's Encrypt (Default)

Automatic certificate provisioning via Let's Encrypt:

```typescript
{
  sslEnabled: true,
  sslProvider: 'letsencrypt',
}
```

**Benefits**:
- ✅ Automatic renewal
- ✅ No cost
- ✅ No manual management

### Custom Certificates

For enterprise or wildcard certificates:

```typescript
{
  sslEnabled: true,
  sslProvider: 'custom',
  metadata: {
    certificateId: 'cert_xyz',
  },
}
```

### No SSL (Development Only)

```typescript
{
  sslEnabled: false,
  sslProvider: 'none',
}
```

⚠️ **Warning**: Only use for development environments.

## Primary URL

Each service can have multiple URL mappings, but one should be marked as primary:

```typescript
// Primary URL: api.example.com/v2 (latest version)
await serviceMappingRepository.create({
  serviceId: 'svc_api',
  subdomain: 'api',
  basePath: '/v2',
  isPrimary: true,           // ← Primary
});

// Secondary URL: api.example.com/v1 (legacy)
await serviceMappingRepository.create({
  serviceId: 'svc_api',
  subdomain: 'api',
  basePath: '/v1',
  isPrimary: false,          // ← Not primary
});
```

### Setting Primary URL

```typescript
async setPrimaryServiceDomain(serviceId: string, mappingId: string) {
  // Unset other primary mappings for this service
  const allMappings = await repository.findByServiceId(serviceId);
  await Promise.all(
    allMappings
      .filter(m => m.id !== mappingId && m.isPrimary)
      .map(m => repository.update(m.id, { isPrimary: false }))
  );

  // Set new primary
  await repository.update(mappingId, { isPrimary: true });
}
```

### Primary URL Use Cases

- **Canonical URL**: Used in `<link rel="canonical">` tags
- **Redirects**: Redirect from old URLs to primary
- **API Documentation**: Display in API docs
- **Service Discovery**: External systems use primary URL

## Listing Service Domains

### Get All URLs for Service

```typescript
// Returns all mappings with computed full URLs
const mappings = await serviceMappingRepository.findByServiceIdWithUrls(serviceId);

// Result:
[
  {
    id: 'sdm_1',
    serviceId: 'svc_api',
    subdomain: 'api',
    basePath: '/v2',
    isPrimary: true,
    sslEnabled: true,
    fullUrl: 'https://api.example.com/v2',
  },
  {
    id: 'sdm_2',
    serviceId: 'svc_api',
    subdomain: 'api',
    basePath: '/v1',
    isPrimary: false,
    sslEnabled: true,
    fullUrl: 'https://api.example.com/v1',
  },
]
```

### Get with Organization Domain Details

```typescript
// In controller - enriches with org domain info
const mappingsWithDetails = await Promise.all(
  mappings.map(async (mapping) => {
    const projectDomain = await projectDomainRepo.findById(mapping.projectDomainId);
    const orgDomain = await orgDomainRepo.findById(projectDomain.organizationDomainId);
    
    return {
      ...DomainAdapter.toServiceDomainMappingWithUrl(mapping, mapping.fullUrl),
      organizationDomain: {
        id: orgDomain.id,
        domain: orgDomain.domain,
        verificationStatus: orgDomain.verificationStatus,
      },
    };
  })
);
```

## Updating Mappings

### Update Subdomain/Path

```typescript
// Check availability first!
const availability = await conflictService.checkSubdomainAvailability(
  mapping.projectDomainId,
  newSubdomain,
  newBasePath
);

if (!availability.available) {
  throw new Error('URL already in use');
}

// Then update
await serviceMappingRepository.update(mappingId, {
  subdomain: newSubdomain,
  basePath: newBasePath,
});
```

### Update SSL Settings

```typescript
await serviceMappingRepository.update(mappingId, {
  sslEnabled: true,
  sslProvider: 'letsencrypt',
});
```

## Removing Mappings

```typescript
// Verify ownership before deletion
const mapping = await serviceMappingRepository.findById(mappingId);

if (mapping.serviceId !== serviceId) {
  throw new Error('Mapping does not belong to this service');
}

await serviceMappingRepository.delete(mappingId);
```

## Shared Subdomains

Multiple services can share a subdomain with different base paths:

```
api.example.com/users    → User Service
api.example.com/orders   → Order Service
api.example.com/products → Product Service
```

### Creating Shared Subdomain Mapping

```typescript
// All services share "api" subdomain
const services = [
  { id: 'svc_users', basePath: '/users' },
  { id: 'svc_orders', basePath: '/orders' },
  { id: 'svc_products', basePath: '/products' },
];

for (const service of services) {
  await serviceMappingRepository.create({
    serviceId: service.id,
    projectDomainId: projectDomain.id,
    subdomain: 'api',        // Same subdomain
    basePath: service.basePath, // Different paths
    isPrimary: true,
    sslEnabled: true,
  });
}
```

### Shared Subdomain Warning

The system detects and warns about shared subdomains:

```typescript
// After creating mapping, check for shared usage
const sharedMappings = await serviceMappingRepository.findBySubdomain(
  projectDomainId,
  subdomain
);

if (sharedMappings.length > 1) {
  return {
    mapping,
    fullUrl,
    warning: {
      message: `This subdomain is shared with ${sharedMappings.length - 1} other service(s)`,
      sharedWith: sharedMappings
        .filter(m => m.id !== mapping.id)
        .map(m => ({
          serviceId: m.serviceId,
          basePath: m.basePath,
        })),
    },
  };
}
```

## Routing Behavior

### Path Matching Priority

When multiple services share a subdomain, routing is determined by base path specificity:

```
api.example.com/users/123    → /users (User Service)
api.example.com/users        → /users (User Service)
api.example.com/             → /      (Root Service, if exists)
```

**Rules**:
1. Longer paths match first (more specific)
2. Exact paths match before prefix paths
3. Root path (`/`) is the fallback

### Traefik Integration

Service domain mappings generate Traefik router rules:

```yaml
# Generated for api.example.com/v1 → API v1 Service
http:
  routers:
    api-v1-router:
      rule: "Host(`api.example.com`) && PathPrefix(`/v1`)"
      service: api-v1-service
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
```

## Best Practices

### 1. Use Consistent URL Patterns

```typescript
// ✅ Good: Consistent API versioning
api.example.com/v1
api.example.com/v2

// ❌ Bad: Inconsistent patterns
v1-api.example.com
api.example.com/version2
```

### 2. Plan Path Hierarchies

```typescript
// ✅ Good: Clear service boundaries
api.example.com/users
api.example.com/orders
api.example.com/products

// ❌ Bad: Overlapping paths (routing confusion)
api.example.com/users
api.example.com/users/admin  // Is this part of users or separate?
```

### 3. Set Primary URLs

```typescript
// Always set one primary URL per service
{
  isPrimary: true,  // For canonical references
}
```

### 4. Enable SSL by Default

```typescript
// ✅ Always use HTTPS in production
{
  sslEnabled: true,
  sslProvider: 'letsencrypt',
}
```

### 5. Validate Before Creating

```typescript
// Always check availability before creating
const check = await conflictService.checkSubdomainAvailability(
  projectDomainId,
  subdomain,
  basePath
);

if (!check.available) {
  // Use suggestions or return error
  throw new Error(`URL in use. Try: ${check.suggestions.availableBasePaths.join(', ')}`);
}
```

## Common Patterns

### Microservices Architecture

```
api.example.com/auth      → Auth Service
api.example.com/users     → User Service  
api.example.com/orders    → Order Service
api.example.com/payments  → Payment Service
api.example.com/graphql   → GraphQL Gateway
```

### Multi-Environment

```
api.example.com/v1            → Production API
staging.api.example.com/v1    → Staging API (nested subdomain)
dev.api.example.com/v1        → Development API (nested subdomain)
```

### Feature Branch Environments

Using multi-level subdomains for ephemeral environments:

```
feature-123.dev.example.com   → Feature branch #123
feature-456.dev.example.com   → Feature branch #456
pr-789.staging.example.com    → PR #789 preview
```

### Blue-Green Deployment

```
api.example.com/          → Current (Blue)
api-green.example.com/    → New Version (Green)

# After verification, swap:
api.example.com/          → New (was Green)
api-blue.example.com/     → Old (was Blue)
```

### Canary Deployment

```
api.example.com/          → Main (90% traffic)
api-canary.example.com/   → Canary (10% traffic)
```
