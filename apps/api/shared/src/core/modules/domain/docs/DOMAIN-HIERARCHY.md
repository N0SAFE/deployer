# Domain Hierarchy

> **Last Updated**: 2025-11-30

## Overview

The domain module implements a three-tier hierarchy that allows organizations to manage domains, allocate them to projects, and map them to specific services.

**Key Feature**: Organizations can register either root domains OR subdomains, enabling multi-organization collaboration on shared domains.

```
Organization
    │
    └── OrganizationDomain (domain OR subdomain, e.g., example.com OR api.example.com)
            │
            └── ProjectDomain (allocation to project with granularity rules)
                    │
                    └── ServiceDomainMapping (service → URL binding)
```

## Tier 1: Organization Domains

**Purpose**: Registry of all domains AND subdomains owned by an organization with verification status.

### Subdomain Registration (Multi-Org Collaboration)

Organizations can register:
- **Root domains**: `example.com` → owns entire domain
- **Subdomains**: `api.example.com` → owns only that subdomain branch
- **Nested subdomains**: `team.api.example.com` → owns only that nested branch

**Use Case**: Multiple organizations collaborating on the same root domain:

```
Organization "Acme Corp"     → registers api.example.com
Organization "Beta Team"     → registers admin.example.com
Organization "Partner Inc"   → registers partner.api.example.com
```

Each organization only verifies and controls their registered subdomain branch.

### Schema

```typescript
interface OrganizationDomain {
  id: string;
  organizationId: string;         // Owner organization
  domain: string;                 // Domain OR subdomain (e.g., "example.com" OR "api.example.com")
  
  // Verification
  verificationStatus: 'pending' | 'verified' | 'failed';
  verificationMethod: 'txt_record' | 'cname_record';
  verificationToken: string;      // Secret token for DNS verification
  dnsRecordChecked: boolean;      // Whether DNS was queried
  lastVerificationAttempt: Date;
  verifiedAt: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  metadata: JsonObject;
}
```

### Lifecycle

```
┌─────────┐    Register     ┌─────────┐    Verify    ┌──────────┐
│  None   │  ───────────>   │ Pending │  ─────────>  │ Verified │
└─────────┘                 └─────────┘              └──────────┘
                                 │                        │
                                 │      Retry             │
                                 ▼                        │
                            ┌────────┐                    │
                            │ Failed │  ──────────────────┘
                            └────────┘
```

### Example

```typescript
// Register domain
const domain = await orgDomainRepository.create({
  organizationId: 'org_abc123',
  domain: 'example.com',
  verificationMethod: 'txt_record',
  verificationToken: 'deployer-verify-xyz789...',
  verificationStatus: 'pending',
});

// After DNS verification succeeds
await orgDomainRepository.updateVerificationStatus(
  domain.id,
  'verified',
  'txt_record',
  new Date()
);
```

### Constraints

- **Unique per organization**: Same domain/subdomain can't be registered twice by same org
- **Unique globally at same level**: `api.example.com` can only be registered by ONE organization
- **Parent-child independence**: Registering `example.com` does NOT prevent others from registering `api.example.com`
- **Must be verified**: Only verified domains can be assigned to projects

### Multi-Org Collaboration Example

```typescript
// Organization A registers the API subdomain
await orgDomainRepository.create({
  organizationId: 'org_acme',
  domain: 'api.example.com',  // Subdomain, not root
  verificationMethod: 'txt_record',
  verificationToken: 'deployer-verify-abc123-api.example.com',
});
// DNS record: _deployer-verify.api.example.com TXT "deployer-verify-abc123-api.example.com"

// Organization B registers the Admin subdomain (same root domain, different org)
await orgDomainRepository.create({
  organizationId: 'org_beta',
  domain: 'admin.example.com',  // Different subdomain
  verificationMethod: 'txt_record',
  verificationToken: 'deployer-verify-xyz789-admin.example.com',
});
// DNS record: _deployer-verify.admin.example.com TXT "deployer-verify-xyz789-admin.example.com"
```

## Tier 2: Project Domains

**Purpose**: Allocate verified organization domains to specific projects with subdomain restrictions AND granularity enforcement.

### Granularity Rule (Critical)

Projects can ONLY use subdomains **at or below** the registered domain level. They CANNOT use higher-level (parent) domains.

| Registered Domain | ✅ Project Can Use | ❌ Project CANNOT Use |
|-------------------|-------------------|----------------------|
| `example.com` | `example.com`, `api.example.com`, `*.example.com` | (none - owns root) |
| `api.example.com` | `api.example.com`, `staging.api.example.com`, `*.api.example.com` | `example.com`, `www.example.com` |
| `feat.api.example.com` | `feat.api.example.com`, `v2.feat.api.example.com`, `*.feat.api.example.com` | `api.example.com`, `example.com` |

**Why?** The organization only verified ownership of their specific subdomain, not the parent domains.

### Schema

```typescript
interface ProjectDomain {
  id: string;
  projectId: string;              // Target project
  organizationDomainId: string;   // Parent org domain
  
  // Subdomain Management
  allowedSubdomains: string[];    // Allowed subdomains, empty = all
  // Examples:
  // ["api", "www", "admin"] - only these subdomains
  // ["*"] - any subdomain allowed
  // [] - only root domain, no subdomains
  
  isPrimary: boolean;             // Primary domain for project
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  metadata: JsonObject;
}
```

### Subdomain Rules

| `allowedSubdomains` | Meaning | Valid Subdomains |
|---------------------|---------|------------------|
| `[]` | Registered domain only | Exact registered domain only |
| `["*"]` | Any subdomain at or below | `*.{registered}` |
| `["staging", "prod"]` | Explicit list | `staging.{registered}`, `prod.{registered}` |
| `["staging", "*"]` | Mixed (invalid) | Don't mix explicit with wildcard |

### Granularity Enforcement Examples

```typescript
// Organization registered: api.example.com

// ✅ VALID: Using exact registered domain
allowedSubdomains: []  // Only api.example.com

// ✅ VALID: Using subdomains OF the registered domain
allowedSubdomains: ['staging', 'prod']  // staging.api.example.com, prod.api.example.com
allowedSubdomains: ['*']  // Any *.api.example.com

// ❌ INVALID: Cannot use parent domains (would be rejected)
// Trying to use 'example.com' when registered is 'api.example.com' = ERROR
```

### Example

```typescript
// Assign domain to project with specific subdomains
const projectDomain = await projectDomainRepository.create({
  projectId: 'proj_def456',
  organizationDomainId: domain.id,  // Must be verified
  allowedSubdomains: ['api', 'www', 'admin', 'staging'],
  isPrimary: true,
});

// Update allowed subdomains later
await projectDomainRepository.updateAllowedSubdomains(
  projectDomain.id,
  ['api', 'www', 'admin', 'staging', 'preview']
);
```

### Constraints

- **Verified only**: Can only assign verified organization domains
- **Unique per project**: Each org domain can only be assigned once per project
- **Single primary**: Only one primary domain per project

## Tier 3: Service Domain Mappings

**Purpose**: Bind specific services to subdomain + base path combinations.

### Schema

```typescript
interface ServiceDomainMapping {
  id: string;
  serviceId: string;              // Target service
  projectDomainId: string;        // Parent project domain
  
  // URL Configuration
  subdomain: string | null;       // null = root domain
  basePath: string | null;        // null = root path "/"
  
  // Priority and SSL
  isPrimary: boolean;             // Primary URL for service
  sslEnabled: boolean;            // Enable HTTPS
  sslProvider: 'letsencrypt' | 'custom' | 'none';
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  metadata: JsonObject;
}
```

### URL Construction

```
Full URL = https:// + [subdomain.] + domain + [basePath]
```

| `subdomain` | `basePath` | Result URL |
|-------------|------------|------------|
| `null` | `null` | `https://example.com/` |
| `"api"` | `null` | `https://api.example.com/` |
| `null` | `"/docs"` | `https://example.com/docs` |
| `"api"` | `"/v1"` | `https://api.example.com/v1` |
| `"api"` | `"/v2"` | `https://api.example.com/v2` |

### Shared Subdomains

Multiple services can share a subdomain with different base paths:

```
api.example.com/v1  →  API Service v1
api.example.com/v2  →  API Service v2
api.example.com/graphql  →  GraphQL Gateway
```

### Example

```typescript
// Create API service mapping
const apiMapping = await serviceMappingRepository.create({
  serviceId: 'svc_api_123',
  projectDomainId: projectDomain.id,
  subdomain: 'api',
  basePath: '/v1',
  isPrimary: true,
  sslEnabled: true,
  sslProvider: 'letsencrypt',
});

// Create another version on same subdomain
const apiV2Mapping = await serviceMappingRepository.create({
  serviceId: 'svc_api_v2_456',
  projectDomainId: projectDomain.id,
  subdomain: 'api',           // Same subdomain
  basePath: '/v2',            // Different path
  isPrimary: false,
  sslEnabled: true,
  sslProvider: 'letsencrypt',
});
```

### Constraints

- **Unique URL**: Combination of (projectDomainId, subdomain, basePath) must be unique
- **Single primary per service**: Each service can have only one primary URL
- **Subdomain allowed**: Subdomain must be in project domain's `allowedSubdomains`

## Complete Example

```typescript
// 1. Organization registers domain
const orgDomain = await orgDomainRepository.create({
  organizationId: 'org_acme',
  domain: 'acme-corp.com',
  verificationMethod: 'txt_record',
  verificationToken: 'deployer-verify-abc...',
});

// 2. User adds DNS record:
// _deployer-verify.acme-corp.com TXT "deployer-verify-abc..."

// 3. Verify domain
await verificationService.verifyDomain(orgDomain.id);
// Status changes to 'verified'

// 4. Assign to project
const projectDomain = await projectDomainRepository.create({
  projectId: 'proj_acme_main',
  organizationDomainId: orgDomain.id,
  allowedSubdomains: ['api', 'www', 'admin', '*'],  // Flexible
  isPrimary: true,
});

// 5. Map services
// Frontend: www.acme-corp.com
await serviceMappingRepository.create({
  serviceId: 'svc_frontend',
  projectDomainId: projectDomain.id,
  subdomain: 'www',
  basePath: null,
  isPrimary: true,
});

// API v1: api.acme-corp.com/v1
await serviceMappingRepository.create({
  serviceId: 'svc_api_v1',
  projectDomainId: projectDomain.id,
  subdomain: 'api',
  basePath: '/v1',
  isPrimary: true,
});

// API v2: api.acme-corp.com/v2
await serviceMappingRepository.create({
  serviceId: 'svc_api_v2',
  projectDomainId: projectDomain.id,
  subdomain: 'api',
  basePath: '/v2',
  isPrimary: true,
});

// Admin: admin.acme-corp.com
await serviceMappingRepository.create({
  serviceId: 'svc_admin',
  projectDomainId: projectDomain.id,
  subdomain: 'admin',
  basePath: null,
  isPrimary: true,
});

// Docs: acme-corp.com/docs (root domain with path)
await serviceMappingRepository.create({
  serviceId: 'svc_docs',
  projectDomainId: projectDomain.id,
  subdomain: null,            // Root domain
  basePath: '/docs',
  isPrimary: true,
});
```

### Resulting URLs

| Service | URL |
|---------|-----|
| Frontend | `https://www.acme-corp.com/` |
| API v1 | `https://api.acme-corp.com/v1` |
| API v2 | `https://api.acme-corp.com/v2` |
| Admin | `https://admin.acme-corp.com/` |
| Docs | `https://acme-corp.com/docs` |

## Cascade Behavior

### Deleting Organization Domain

```
DELETE organization_domain WHERE id = 'od_123'
  └── CASCADE DELETE project_domains WHERE organization_domain_id = 'od_123'
        └── CASCADE DELETE service_domain_mappings WHERE project_domain_id IN (...)
```

### Deleting Project Domain

```
DELETE project_domain WHERE id = 'pd_456'
  └── CASCADE DELETE service_domain_mappings WHERE project_domain_id = 'pd_456'
```

### Deleting Service

```
DELETE service WHERE id = 'svc_789'
  └── CASCADE DELETE service_domain_mappings WHERE service_id = 'svc_789'
```

## Access Control Matrix

| Operation | Organization Admin | Project Admin | Service Owner |
|-----------|-------------------|---------------|---------------|
| Add Org Domain | ✅ | ❌ | ❌ |
| Verify Domain | ✅ | ❌ | ❌ |
| Delete Org Domain | ✅ | ❌ | ❌ |
| Assign to Project | ✅ | ✅ | ❌ |
| Update Subdomains | ✅ | ✅ | ❌ |
| Remove from Project | ✅ | ✅ | ❌ |
| Map Service URL | ✅ | ✅ | ✅ |
| Update Mapping | ✅ | ✅ | ✅ |
| Delete Mapping | ✅ | ✅ | ✅ |

## Best Practices

### 1. Use Specific Subdomain Lists

```typescript
// ✅ Good: Explicit list
allowedSubdomains: ['api', 'www', 'admin', 'staging']

// ⚠️ Caution: Wildcard allows any subdomain
allowedSubdomains: ['*']

// ✅ Good: Root domain only
allowedSubdomains: []
```

### 2. Plan URL Structure

```typescript
// ✅ Good: Clear versioned API paths
api.example.com/v1
api.example.com/v2

// ❌ Bad: Confusing structure
v1.api.example.com
v2.api.example.com
```

### 3. Set Primary URLs

```typescript
// Each service should have exactly one primary URL
// This is used for redirects, canonical URLs, etc.
await serviceMappingRepository.create({
  serviceId,
  isPrimary: true,  // Mark as primary
  ...
});
```

### 4. Handle Domain Transfer

```typescript
// When transferring domain to another organization:
// 1. Delete all service mappings
// 2. Delete all project domains
// 3. Delete organization domain
// 4. Re-register with new organization
// 5. Re-verify

// Note: This is a breaking change that will disrupt services!
```
