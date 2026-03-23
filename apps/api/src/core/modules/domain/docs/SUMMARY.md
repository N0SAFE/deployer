# Domain Module Summary

> **Module Path**: `apps/api/src/core/modules/domain/`  
> **Last Updated**: 2025-11-30

## Executive Summary

The Domain module provides comprehensive custom domain management for the deployment platform. It handles the complete lifecycle from domain registration and DNS verification to service URL mapping with support for multi-level subdomains and path-based routing.

## Core Capabilities

| Feature | Description |
|---------|-------------|
| **Domain/Subdomain Registration** | Organizations can register root domains (`example.com`) OR subdomains (`api.example.com`, `team.api.example.com`) - enables multi-org collaboration on shared domains |
| **DNS Verification** | Prove ownership via TXT or CNAME records with domain-specific verification tokens |
| **Project Allocation** | Assign verified domains to projects with subdomain granularity rules |
| **Granularity Enforcement** | Projects cannot use higher-level domains than what was registered |
| **Service Mapping** | Map services to URLs with subdomain + base path |
| **Multi-Level Subdomains** | Support `staging.api.example.com`, `v2.dev.api.example.com` |
| **SSL Management** | Automatic Let's Encrypt or custom certificates |
| **Conflict Detection** | Prevent URL collisions with smart suggestions |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     ORPC Controllers                        │
│  OrganizationDomain │ ProjectDomain │ ServiceDomain        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                       Services                               │
│  DomainVerification │ DomainConflict │ OrganizationDomain   │
│                     │ ServiceDomainMapping                   │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                      Repositories                            │
│  OrganizationDomain │ ProjectDomain │ ServiceDomainMapping  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                    PostgreSQL + Drizzle                      │
└─────────────────────────────────────────────────────────────┘
```

## Domain Hierarchy

```
Organization A                              Organization B
    │                                            │
    └── OrganizationDomain                       └── OrganizationDomain
        (api.example.com) [verified]                 (admin.example.com) [verified]
            │                                            │
            └── ProjectDomain                            └── ProjectDomain
                    │                                            │
                    ├── staging.api.example.com/v1               └── admin.example.com/
                    ├── api.example.com/v1
                    └── api.example.com/v2
```

**Key Concept**: Multiple organizations can register different subdomains of the same root domain, enabling collaboration while maintaining ownership boundaries.

## Key Flows

### 1. Domain Registration & Verification
```
Register (domain or subdomain) → Pending → User Adds DNS → Verify → Verified ✓
```

### 2. Project Assignment with Granularity Rules
```
Select Verified Domain → Assign to Project → Configure Subdomain Rules (must respect granularity)
```

**Granularity Rule**: Projects can only use subdomains AT OR BELOW the registered level:

| Registered Domain | ✅ Allowed for Project | ❌ Not Allowed |
|-------------------|------------------------|----------------|
| `example.com` | `api.example.com`, `www.example.com`, `*.example.com` | - |
| `api.example.com` | `api.example.com`, `staging.api.example.com`, `*.api.example.com` | `example.com`, `www.example.com` |
| `feat.api.example.com` | `feat.api.example.com`, `v2.feat.api.example.com` | `api.example.com`, `example.com` |

### 3. Service URL Mapping
```
Check Availability → Create Mapping → Compute Full URL → Return with SSL
```

## Database Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organization_domains` | Root domain registry | `domain`, `verificationStatus`, `verificationToken` |
| `project_domains` | Domain-to-project allocation | `projectId`, `organizationDomainId`, `allowedSubdomains` |
| `service_domain_mappings` | Service URL binding | `serviceId`, `subdomain`, `basePath`, `sslEnabled` |

## API Endpoints

### Organization Domains
| Operation | Description |
|-----------|-------------|
| `addOrganizationDomain` | Register new domain |
| `listOrganizationDomains` | List org's domains |
| `verifyOrganizationDomain` | Trigger DNS verification |
| `deleteOrganizationDomain` | Remove domain (cascades) |

### Project Domains
| Operation | Description |
|-----------|-------------|
| `addProjectDomain` | Assign domain to project |
| `listProjectDomains` | List project's domains |
| `getAvailableDomains` | Get unassigned verified domains |
| `updateProjectDomain` | Update subdomain rules |
| `removeProjectDomain` | Unassign from project |

### Service Domains
| Operation | Description |
|-----------|-------------|
| `checkSubdomainAvailability` | Check URL availability |
| `listServiceDomains` | List service's URLs |
| `addServiceDomain` | Create URL mapping |
| `updateServiceDomain` | Update mapping |
| `setPrimaryServiceDomain` | Set primary URL |
| `removeServiceDomain` | Delete mapping |

## URL Examples

| Subdomain | Base Path | Result URL |
|-----------|-----------|------------|
| `null` | `null` | `https://example.com/` |
| `"api"` | `"/v1"` | `https://api.example.com/v1` |
| `"staging.api"` | `"/v1"` | `https://staging.api.example.com/v1` |
| `"v2.staging.api"` | `null` | `https://v2.staging.api.example.com/` |
| `"feature-123.dev"` | `null` | `https://feature-123.dev.example.com/` |

## Module Statistics

| Metric | Count |
|--------|-------|
| Controllers | 3 |
| Services | 4 |
| Repositories | 3 |
| Database Tables | 3 |
| ORPC Endpoints | 14 |
| Enums | 3 |
| Error Classes | 19 |
| Interface Files | 6 |

## Module Structure

```
domain/
├── adapters/              # Entity-to-contract transformations
├── controllers/           # ORPC controllers (3)
├── docs/                  # Documentation (9 files)
├── domain.module.ts       # NestJS module definition
├── errors/                # Domain-specific error classes (6 files)
├── interfaces/            # Type definitions (6 files)
├── repositories/          # Database access (3)
└── services/              # Business logic (4)
```

## Key Features

### ✅ Implemented
- Domain registration and verification
- TXT and CNAME verification methods
- Multi-level subdomain support
- Path-based routing
- Conflict detection and suggestions
- SSL configuration (Let's Encrypt, custom)
- Cascade deletion
- Adapter pattern for API responses

### 🔄 Ready for Enhancement
- Auto-verification cron (needs `@nestjs/schedule`)
- Domain events for Traefik integration
- Caching for frequent lookups
- Rate limiting on verification endpoint

### 📋 Future Considerations
- Soft delete with `deletedAt`
- Audit trail (`createdBy`, `updatedBy`)
- Domain transfer between organizations
- Wildcard SSL certificates
- Domain health monitoring

## Documentation Index

| Document | Description |
|----------|-------------|
| [README.md](./README.md) | Overview and quick start |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and data flow |
| [DOMAIN-HIERARCHY.md](./DOMAIN-HIERARCHY.md) | Three-tier domain structure |
| [DNS-VERIFICATION.md](./DNS-VERIFICATION.md) | Domain ownership verification |
| [SERVICE-MAPPING.md](./SERVICE-MAPPING.md) | Service-to-URL mapping |
| [CONFLICT-RESOLUTION.md](./CONFLICT-RESOLUTION.md) | URL conflict handling |
| [API-REFERENCE.md](./API-REFERENCE.md) | Complete API documentation |

## Quick Reference

### Register Domain
```typescript
await orpc.domain.addOrganizationDomain({
  organizationId: 'org_123',
  domain: 'example.com',
  verificationMethod: 'txt_record',
});
```

### Map Service to URL
```typescript
await orpc.domain.addServiceDomain({
  serviceId: 'svc_789',
  projectDomainId: 'pd_456',
  subdomain: 'api',        // Or 'staging.api' for multi-level
  basePath: '/v1',
  sslEnabled: true,
});
```

### Check Availability
```typescript
const result = await orpc.domain.checkSubdomainAvailability({
  projectDomainId: 'pd_456',
  subdomain: 'api',
  basePath: '/v2',
});
// result.available === true/false
// result.suggestions.availableBasePaths === ['/v3', '/app', ...]
```

## Related Modules

- **Traefik Module**: Reverse proxy configuration generated from domain mappings
- **Deployment Module**: Services that receive domain mappings
- **Auth Module**: Organization ownership for domains
