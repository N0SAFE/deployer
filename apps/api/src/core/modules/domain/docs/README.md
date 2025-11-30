# Domain Module Documentation

> **Module Path**: `apps/api/src/core/modules/domain/`  
> **Module Name**: `DomainModule`  
> **Last Updated**: 2025-11-30

## Overview

The Domain module provides a comprehensive system for managing custom domains in the deployment platform. It handles domain registration, DNS verification, domain allocation to projects, and service-to-domain mapping with support for subdomains and base paths.

### Key Features

- **Domain OR Subdomain Registration**: Organizations can register root domains (`example.com`) OR subdomains (`api.example.com`, `team.api.example.com`)
- **Multi-Organization Collaboration**: Different organizations can register different subdomains of the same root domain
- **Granularity Enforcement**: Projects can only use subdomains at or below the registered domain level
- **Domain-Specific Verification**: DNS verification tokens include the registered domain for uniqueness

## Documentation Index

| Document | Description |
|----------|-------------|
| **[Summary](./SUMMARY.md)** | **Executive summary and quick reference** |
| [Architecture](./ARCHITECTURE.md) | System architecture, component relationships, data flow |
| [Domain Hierarchy](./DOMAIN-HIERARCHY.md) | Organization → Project → Service domain relationship + granularity rules |
| [DNS Verification](./DNS-VERIFICATION.md) | Domain ownership verification via DNS records with domain-specific tokens |
| [Service Mapping](./SERVICE-MAPPING.md) | Mapping services to subdomains and paths |
| [Conflict Resolution](./CONFLICT-RESOLUTION.md) | Subdomain/path conflict detection and resolution |
| [API Reference](./API-REFERENCE.md) | Complete API documentation with all endpoints |
| [Error Handling](./ERROR-HANDLING.md) | Domain-specific error classes with `ErrorClass.name` convention |

## Quick Start

### Basic Usage

```typescript
import { OrganizationDomainController } from '@/core/modules/domain/controllers';

// 1. Register domain OR subdomain with organization
// Option A: Root domain
const domainResponse = await orgDomainService.create({
  organizationId: 'org_123',
  domain: 'example.com',  // Root domain
  verificationMethod: 'txt_record',
});

// Option B: Subdomain (for multi-org collaboration)
const subdomainResponse = await orgDomainService.create({
  organizationId: 'org_456',
  domain: 'api.example.com',  // Subdomain - another org can register this
  verificationMethod: 'txt_record',
});

// 2. User adds DNS record with domain-specific token, then verify
// Token format: deployer-verify-{random}-{registered_domain}
// Example: deployer-verify-abc123-api.example.com
const verifyResult = await domainVerificationService.verifyDomain(domainResponse.id);

// 3. Assign domain to project (respects granularity rules)
const projectDomain = await projectDomainService.create({
  projectId: 'proj_456',
  organizationDomainId: domainResponse.id,
  allowedSubdomains: ['staging', '*'],  // Must be at or below registered level
});

// 4. Map service to subdomain+path
const mapping = await serviceMappingService.create({
  serviceId: 'svc_789',
  projectDomainId: projectDomain.id,
  subdomain: 'staging',  // staging.api.example.com if registered is api.example.com
  basePath: '/v1',
  sslEnabled: true,
});
```

### Using ORPC Controllers

```typescript
import { domainContract } from '@repo/api-contracts';

// Add organization domain (can be subdomain for multi-org)
await orpc.domain.addOrganizationDomain({
  organizationId: 'org_123',
  domain: 'api.example.com',  // Can register subdomain
  verificationMethod: 'txt_record',
});

// Verify domain ownership (DNS record includes domain in token)
await orpc.domain.verifyOrganizationDomain({
  domainId: 'dom_abc',
});

// Map service to domain
await orpc.domain.addServiceDomain({
  serviceId: 'svc_789',
  projectDomainId: 'pd_def',
  subdomain: 'staging',  // Creates staging.api.example.com
  basePath: '/v1',
  sslEnabled: true,
});
```

## Module Structure

```
domain/
├── domain.module.ts              # NestJS module definition
├── docs/                         # Documentation
├── adapters/                     # Entity-to-contract transformations
│   └── domain.adapter.ts         # Static adapter methods
├── controllers/                  # ORPC controllers
│   ├── organization-domain.controller.ts
│   ├── project-domain.controller.ts
│   └── service-domain.controller.ts
├── repositories/                 # Database access
│   ├── organization-domain.repository.ts
│   ├── project-domain.repository.ts
│   └── service-domain-mapping.repository.ts
└── services/                     # Business logic
    ├── domain-verification.service.ts    # DNS verification
    ├── domain-conflict.service.ts        # Conflict detection
    ├── organization-domain.service.ts    # Org domain operations
    └── service-domain-mapping.service.ts # Service mapping
```

## Key Concepts

### 1. Three-Tier Domain Hierarchy

```
Organization (owns domains)
    │
    └── OrganizationDomain (verified root domains)
            │
            └── ProjectDomain (domain allocated to project)
                    │
                    └── ServiceDomainMapping (service URL mapping)
```

### 2. Domain Verification

Before a domain can be used, ownership must be verified via DNS:

| Method | Record Type | Example |
|--------|-------------|---------|
| TXT Record | TXT | `_deployer-verify.example.com TXT "deployer-verify-abc123..."` |
| CNAME Record | CNAME | `_deployer-verify.example.com CNAME verify-abc123.deployer.io` |

### 3. Subdomain + Base Path Routing

Services are mapped using subdomain and base path combinations:

```
https://api.example.com/v1     → API Service v1
https://api.example.com/v2     → API Service v2
https://www.example.com/       → Web Frontend
https://admin.example.com/     → Admin Dashboard
https://example.com/docs       → Documentation Service
```

### 4. SSL Management

SSL certificates are managed per domain mapping:

| Provider | Description |
|----------|-------------|
| `letsencrypt` | Automatic Let's Encrypt certificates (default) |
| `custom` | User-provided certificates |
| `none` | No SSL (HTTP only) |

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `organization_domains` | Root domains owned by organizations |
| `project_domains` | Domain allocations to projects |
| `service_domain_mappings` | Service URL mappings |

### Entity Relationships

```
organization (1) ─────┬───> organization_domains (n)
                      │           │
                      │           └───> project_domains (n)
                      │                       │
projects (1) ─────────┴──────────────────────┤
                                              │
services (1) ────────────────────────> service_domain_mappings (n)
```

## Architecture Rules

### ✅ DO

1. **Verify domain before use** - Only verified domains can be assigned to projects
2. **Check conflicts before mapping** - Use `DomainConflictService` before creating mappings
3. **Use adapters for API responses** - Transform entities via `DomainAdapter`
4. **Validate subdomain format** - Follow DNS naming conventions
5. **Handle cascading deletes** - Removing org domain removes all child mappings

### ❌ DON'T

1. **Don't bypass verification** - Never skip DNS verification
2. **Don't allow duplicate URLs** - Same subdomain+path must be unique
3. **Don't mix wildcard with explicit** - Choose one subdomain strategy per project
4. **Don't hardcode domains** - Always reference via IDs
5. **Don't ignore SSL** - Default to `sslEnabled: true`

## API Overview

### Organization Domain Operations

| Operation | Description |
|-----------|-------------|
| `addOrganizationDomain` | Register new domain for organization |
| `listOrganizationDomains` | List all domains for organization |
| `getOrganizationDomain` | Get single domain details |
| `verifyOrganizationDomain` | Trigger DNS verification |
| `deleteOrganizationDomain` | Remove domain (cascades to all mappings) |

### Project Domain Operations

| Operation | Description |
|-----------|-------------|
| `addProjectDomain` | Assign verified domain to project |
| `listProjectDomains` | List domains assigned to project |
| `getAvailableDomains` | Get verified domains available for project |
| `updateProjectDomain` | Update allowed subdomains |
| `removeProjectDomain` | Remove domain from project |

### Service Domain Operations

| Operation | Description |
|-----------|-------------|
| `checkSubdomainAvailability` | Check if subdomain+path is available |
| `listServiceDomains` | List all domain mappings for service |
| `addServiceDomain` | Create new service URL mapping |
| `updateServiceDomain` | Update mapping configuration |
| `setPrimaryServiceDomain` | Set primary URL for service |
| `removeServiceDomain` | Remove URL mapping |

## Related Documentation

- [Traefik Module](../../traefik/docs/README.md) - Reverse proxy configuration
- [Deployment Module](../../deployment/docs/README.md) - Service deployment
- [NestJS Modules](https://docs.nestjs.com/modules)

## Support

For issues or questions:
1. Check [DNS Verification](./DNS-VERIFICATION.md) for verification issues
2. Check [Conflict Resolution](./CONFLICT-RESOLUTION.md) for URL conflicts
3. Check [API Reference](./API-REFERENCE.md) for endpoint details
