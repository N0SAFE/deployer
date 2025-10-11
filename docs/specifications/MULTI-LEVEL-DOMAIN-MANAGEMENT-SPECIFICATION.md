# Multi-Level Domain Management System Specification

## Overview

This specification defines a three-level domain management system:
1. **Organization Level**: Domain ownership and DNS verification
2. **Project Level**: Domain selection and subdomain allocation
3. **Service Level**: Domain usage with subdomain and path configuration

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   ORGANIZATION                          │
│                                                         │
│  Domains (Verified):                                   │
│  ├─ example.com          ✓ Verified                    │
│  ├─ myapp.io             ✓ Verified                    │
│  └─ staging.dev          ⏳ Pending Verification       │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Selects domains
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      PROJECT                            │
│                                                         │
│  Selected Domains:                                      │
│  ├─ example.com (Primary)                              │
│  │  └─ Allowed Subdomains: [api, web, admin, *]       │
│  └─ myapp.io                                           │
│     └─ Allowed Subdomains: [staging, preview]          │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Maps to services
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     SERVICES                            │
│                                                         │
│  API Service:                                           │
│  ├─ api.example.com          (Primary)                 │
│  └─ api.myapp.io                                       │
│                                                         │
│  Web Service:                                           │
│  ├─ example.com/             (Root domain)             │
│  └─ www.example.com                                    │
│                                                         │
│  Admin Service:                                         │
│  └─ admin.example.com/v1     (With base path)          │
└─────────────────────────────────────────────────────────┘
```

## Database Schema

### 1. Organization Domains Table

**Purpose**: Registry of all domains owned by the organization with verification status.

```typescript
interface OrganizationDomain {
  id: string; // UUID
  organizationId: string; // FK to organizations
  domain: string; // e.g., "example.com" (unique per organization)
  
  // Verification
  verificationStatus: 'pending' | 'verified' | 'failed';
  verificationMethod: 'txt_record' | 'cname_record';
  verificationToken: string; // Random token for DNS verification
  dnsRecordChecked: boolean;
  lastVerificationAttempt: Date | null;
  verifiedAt: Date | null;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    registrar?: string;
    expiresAt?: Date;
    autoRenew?: boolean;
    [key: string]: any;
  };
}
```

**Constraints**:
- `UNIQUE(organization_id, domain)` - Each domain unique per organization
- `INDEX ON verification_status` - For querying pending verifications

**Drizzle Schema**:
```typescript
export const organizationDomains = pgTable('organization_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 255 }).notNull(),
  
  verificationStatus: verificationStatusEnum('verification_status').notNull().default('pending'),
  verificationMethod: verificationMethodEnum('verification_method').notNull().default('txt_record'),
  verificationToken: varchar('verification_token', { length: 255 }).notNull(),
  dnsRecordChecked: boolean('dns_record_checked').notNull().default(false),
  lastVerificationAttempt: timestamp('last_verification_attempt'),
  verifiedAt: timestamp('verified_at'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  uniqueDomainPerOrg: unique().on(table.organizationId, table.domain),
  verificationStatusIdx: index('verification_status_idx').on(table.verificationStatus),
}));

export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'failed']);
export const verificationMethodEnum = pgEnum('verification_method', ['txt_record', 'cname_record']);
```

### 2. Project Domains Table

**Purpose**: Project's selected domains from organization with subdomain allocations.

```typescript
interface ProjectDomain {
  id: string; // UUID
  projectId: string; // FK to projects
  organizationDomainId: string; // FK to organization_domains
  
  // Subdomain management
  allowedSubdomains: string[]; // e.g., ["api", "web", "admin", "*"]
  // "*" means any subdomain is allowed
  // Empty array means only root domain allowed
  
  isPrimary: boolean; // Is this the primary domain for the project?
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    notes?: string;
    [key: string]: any;
  };
}
```

**Constraints**:
- `UNIQUE(project_id, organization_domain_id)` - No duplicate domain selections
- `CHECK: Only one isPrimary=true per project_id`

**Drizzle Schema**:
```typescript
export const projectDomains = pgTable('project_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  organizationDomainId: uuid('organization_domain_id').notNull().references(() => organizationDomains.id, { onDelete: 'cascade' }),
  
  allowedSubdomains: varchar('allowed_subdomains', { length: 100 }).array().notNull().default([]),
  isPrimary: boolean('is_primary').notNull().default(false),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  uniqueProjectDomain: unique().on(table.projectId, table.organizationDomainId),
  projectIdIdx: index('project_domains_project_id_idx').on(table.projectId),
}));
```

### 3. Service Domain Mappings Table

**Purpose**: Service's actual domain usage with subdomain and base path.

```typescript
interface ServiceDomainMapping {
  id: string; // UUID
  serviceId: string; // FK to services
  projectDomainId: string; // FK to project_domains
  
  // URL configuration
  subdomain: string | null; // e.g., "api", null for root domain
  basePath: string | null; // e.g., "/v1", "/api", null for root path
  
  // Priority and SSL
  isPrimary: boolean; // Is this the primary domain for the service?
  sslEnabled: boolean;
  sslProvider: 'letsencrypt' | 'custom' | 'none';
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    healthCheckPath?: string;
    [key: string]: any;
  };
}
```

**Computed Properties**:
```typescript
// Full URL computation
function getFullUrl(mapping: ServiceDomainMapping, projectDomain: ProjectDomain, orgDomain: OrganizationDomain): string {
  const protocol = mapping.sslEnabled ? 'https' : 'http';
  const subdomain = mapping.subdomain ? `${mapping.subdomain}.` : '';
  const basePath = mapping.basePath || '';
  return `${protocol}://${subdomain}${orgDomain.domain}${basePath}`;
}

// Examples:
// subdomain="api", domain="example.com", basePath=null → https://api.example.com
// subdomain=null, domain="example.com", basePath="/api" → https://example.com/api
// subdomain="admin", domain="example.com", basePath="/v1" → https://admin.example.com/v1
```

**Constraints**:
- `UNIQUE(project_domain_id, subdomain, base_path)` - Prevent exact URL duplicates
- `CHECK: Only one isPrimary=true per service_id`

**Drizzle Schema**:
```typescript
export const serviceDomainMappings = pgTable('service_domain_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  projectDomainId: uuid('project_domain_id').notNull().references(() => projectDomains.id, { onDelete: 'cascade' }),
  
  subdomain: varchar('subdomain', { length: 63 }), // DNS subdomain max length
  basePath: varchar('base_path', { length: 255 }),
  
  isPrimary: boolean('is_primary').notNull().default(false),
  sslEnabled: boolean('ssl_enabled').notNull().default(true),
  sslProvider: sslProviderEnum('ssl_provider').notNull().default('letsencrypt'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  uniqueUrl: unique().on(table.projectDomainId, table.subdomain, table.basePath),
  serviceIdIdx: index('service_domain_mappings_service_id_idx').on(table.serviceId),
}));

export const sslProviderEnum = pgEnum('ssl_provider', ['letsencrypt', 'custom', 'none']);
```

## DNS Verification Workflow

### Step 1: Add Domain to Organization

```typescript
interface AddDomainRequest {
  domain: string; // e.g., "example.com"
  verificationMethod: 'txt_record' | 'cname_record';
}

interface AddDomainResponse {
  organizationDomain: OrganizationDomain;
  verificationInstructions: {
    method: 'txt_record' | 'cname_record';
    recordName: string; // e.g., "_deployer-verify.example.com"
    recordValue: string; // e.g., "deployer-verify-abc123xyz"
    instructions: string;
  };
}
```

**Process**:
1. User submits domain name
2. System generates unique verification token
3. System creates `organization_domains` record with status `pending`
4. System returns DNS instructions for verification

**DNS Instructions**:

**TXT Record Method**:
```
Record Type: TXT
Name: _deployer-verify.example.com
Value: deployer-verify-abc123xyz
TTL: 3600
```

**CNAME Record Method**:
```
Record Type: CNAME
Name: _deployer-verify.example.com
Value: verify-{token}.deployer.io
TTL: 3600
```

### Step 2: Verify Domain

```typescript
interface VerifyDomainRequest {
  organizationDomainId: string;
}

interface VerifyDomainResponse {
  success: boolean;
  status: 'verified' | 'failed';
  message: string;
  verifiedAt?: Date;
  error?: {
    code: string;
    details: string;
  };
}
```

**Verification Process**:
```typescript
async function verifyDomain(domainId: string): Promise<VerifyDomainResponse> {
  const orgDomain = await getOrganizationDomain(domainId);
  
  // Query DNS for verification record
  const recordName = `_deployer-verify.${orgDomain.domain}`;
  const dnsRecords = await queryDNS(recordName, orgDomain.verificationMethod);
  
  // Check if token matches
  const verified = dnsRecords.some(record => 
    record.value === orgDomain.verificationToken
  );
  
  // Update status
  if (verified) {
    await updateDomain(domainId, {
      verificationStatus: 'verified',
      verifiedAt: new Date(),
      dnsRecordChecked: true,
    });
    return { success: true, status: 'verified', message: 'Domain verified successfully' };
  } else {
    await updateDomain(domainId, {
      verificationStatus: 'failed',
      lastVerificationAttempt: new Date(),
      dnsRecordChecked: true,
    });
    return { 
      success: false, 
      status: 'failed', 
      message: 'DNS record not found or token mismatch',
      error: {
        code: 'DNS_VERIFICATION_FAILED',
        details: 'Please check your DNS configuration and try again'
      }
    };
  }
}
```

### Step 3: Auto-Verification (Cron Job)

```typescript
// Run every hour
@Cron('0 * * * *')
async function autoVerifyPendingDomains() {
  const pendingDomains = await getPendingDomains();
  
  for (const domain of pendingDomains) {
    try {
      await verifyDomain(domain.id);
    } catch (error) {
      logger.error(`Auto-verification failed for ${domain.domain}`, error);
    }
  }
}
```

## Project Domain Selection Workflow

### Step 1: Get Available Domains

```typescript
interface GetAvailableDomainsRequest {
  projectId: string;
  organizationId: string;
}

interface GetAvailableDomainsResponse {
  availableDomains: Array<{
    id: string;
    domain: string;
    verificationStatus: 'verified';
    verifiedAt: Date;
    alreadySelected: boolean; // Is this domain already selected by the project?
  }>;
}

// API: GET /api/organizations/:orgId/domains?projectId=:projectId&verified=true
```

**Implementation**:
```typescript
async function getAvailableDomains(orgId: string, projectId: string) {
  // Get all verified domains for organization
  const verifiedDomains = await db
    .select()
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.organizationId, orgId),
        eq(organizationDomains.verificationStatus, 'verified')
      )
    );
  
  // Get project's already selected domains
  const selectedDomains = await db
    .select()
    .from(projectDomains)
    .where(eq(projectDomains.projectId, projectId));
  
  const selectedDomainIds = new Set(selectedDomains.map(pd => pd.organizationDomainId));
  
  return verifiedDomains.map(domain => ({
    id: domain.id,
    domain: domain.domain,
    verificationStatus: domain.verificationStatus,
    verifiedAt: domain.verifiedAt!,
    alreadySelected: selectedDomainIds.has(domain.id),
  }));
}
```

### Step 2: Add Domain to Project

```typescript
interface AddDomainToProjectRequest {
  projectId: string;
  organizationDomainId: string;
  allowedSubdomains: string[]; // e.g., ["api", "web", "*"]
  isPrimary: boolean;
}

interface AddDomainToProjectResponse {
  projectDomain: ProjectDomain;
  suggestions: {
    commonSubdomains: string[]; // e.g., ["api", "web", "admin", "staging"]
    wildcardOption: string; // "*" for any subdomain
  };
}

// API: POST /api/projects/:projectId/domains
```

**Validation**:
- Organization domain must be verified
- Organization domain must belong to project's organization
- If isPrimary=true, unset other primary domains for this project

## Service Domain Mapping Workflow

### Step 1: Get Available Project Domains

```typescript
interface GetProjectDomainsRequest {
  projectId: string;
  serviceId: string; // For checking existing mappings
}

interface GetProjectDomainsResponse {
  domains: Array<{
    projectDomainId: string;
    domain: string; // Base domain (e.g., "example.com")
    allowedSubdomains: string[];
    isPrimary: boolean;
    existingMappings: Array<{
      serviceId: string;
      serviceName: string;
      subdomain: string | null;
      basePath: string | null;
      fullUrl: string;
    }>;
  }>;
}

// API: GET /api/projects/:projectId/domains/available?serviceId=:serviceId
```

### Step 2: Check Subdomain Availability

```typescript
interface CheckSubdomainRequest {
  projectDomainId: string;
  subdomain: string | null;
  basePath: string | null;
  excludeServiceId?: string; // Exclude current service when editing
}

interface CheckSubdomainResponse {
  available: boolean;
  conflicts: Array<{
    serviceId: string;
    serviceName: string;
    subdomain: string | null;
    basePath: string | null;
    fullUrl: string;
  }>;
  suggestions: {
    availableBasePaths: string[]; // e.g., ["/v1", "/v2", "/api"]
    message: string;
  };
}

// API: POST /api/project-domains/:id/check-subdomain
```

**Conflict Detection Logic**:
```typescript
async function checkSubdomainAvailability(
  projectDomainId: string,
  subdomain: string | null,
  basePath: string | null,
  excludeServiceId?: string
): Promise<CheckSubdomainResponse> {
  // Find all mappings for this project domain with same subdomain
  const existingMappings = await db
    .select({
      serviceId: serviceDomainMappings.serviceId,
      serviceName: services.name,
      subdomain: serviceDomainMappings.subdomain,
      basePath: serviceDomainMappings.basePath,
    })
    .from(serviceDomainMappings)
    .innerJoin(services, eq(services.id, serviceDomainMappings.serviceId))
    .where(
      and(
        eq(serviceDomainMappings.projectDomainId, projectDomainId),
        eq(serviceDomainMappings.subdomain, subdomain),
        excludeServiceId ? ne(serviceDomainMappings.serviceId, excludeServiceId) : undefined
      )
    );
  
  // Check for exact match (same subdomain + same basePath)
  const exactMatch = existingMappings.find(m => m.basePath === basePath);
  
  if (exactMatch) {
    return {
      available: false,
      conflicts: existingMappings,
      suggestions: {
        availableBasePaths: [],
        message: 'This exact URL is already in use. Please choose a different subdomain or base path.',
      },
    };
  }
  
  // Check for root path conflict (same subdomain + no basePath)
  if (!basePath && existingMappings.some(m => !m.basePath)) {
    return {
      available: false,
      conflicts: existingMappings,
      suggestions: {
        availableBasePaths: ['/v1', '/v2', '/api', '/app'],
        message: 'This subdomain is already used without a base path. Add a base path to differentiate your service.',
      },
    };
  }
  
  // If there are mappings but different basePaths, it's available
  if (existingMappings.length > 0) {
    const usedBasePaths = existingMappings.map(m => m.basePath).filter(Boolean);
    return {
      available: true,
      conflicts: existingMappings,
      suggestions: {
        availableBasePaths: generateAvailableBasePaths(usedBasePaths),
        message: `This subdomain is shared with ${existingMappings.length} other service(s) using different base paths.`,
      },
    };
  }
  
  // No conflicts
  return {
    available: true,
    conflicts: [],
    suggestions: {
      availableBasePaths: [],
      message: 'This subdomain is available.',
    },
  };
}

function generateAvailableBasePaths(usedPaths: (string | null)[]): string[] {
  const common = ['/v1', '/v2', '/v3', '/api', '/app', '/web', '/admin'];
  return common.filter(path => !usedPaths.includes(path));
}
```

### Step 3: Add Domain Mapping to Service

```typescript
interface AddServiceDomainRequest {
  serviceId: string;
  projectDomainId: string;
  subdomain: string | null;
  basePath: string | null;
  isPrimary: boolean;
  sslEnabled: boolean;
  sslProvider: 'letsencrypt' | 'custom' | 'none';
}

interface AddServiceDomainResponse {
  mapping: ServiceDomainMapping;
  fullUrl: string;
  warning?: {
    message: string;
    sharedWith: Array<{
      serviceName: string;
      fullUrl: string;
    }>;
  };
}

// API: POST /api/services/:serviceId/domains
```

**Validation**:
```typescript
async function addServiceDomain(request: AddServiceDomainRequest) {
  // 1. Verify project domain belongs to service's project
  const projectDomain = await getProjectDomain(request.projectDomainId);
  const service = await getService(request.serviceId);
  
  if (projectDomain.projectId !== service.projectId) {
    throw new Error('Project domain does not belong to service\'s project');
  }
  
  // 2. Verify subdomain is allowed
  if (request.subdomain && !projectDomain.allowedSubdomains.includes('*')) {
    if (!projectDomain.allowedSubdomains.includes(request.subdomain)) {
      throw new Error(`Subdomain '${request.subdomain}' is not allowed for this domain`);
    }
  }
  
  // 3. Check for conflicts
  const availability = await checkSubdomainAvailability(
    request.projectDomainId,
    request.subdomain,
    request.basePath,
    request.serviceId
  );
  
  if (!availability.available) {
    throw new Error(availability.suggestions.message);
  }
  
  // 4. Create mapping
  const mapping = await createServiceDomainMapping(request);
  
  // 5. Get full URL
  const orgDomain = await getOrganizationDomain(projectDomain.organizationDomainId);
  const fullUrl = computeFullUrl(mapping, orgDomain);
  
  // 6. Return with warnings if sharing subdomain
  return {
    mapping,
    fullUrl,
    warning: availability.conflicts.length > 0 ? {
      message: `This subdomain is shared with ${availability.conflicts.length} other service(s)`,
      sharedWith: availability.conflicts.map(c => ({
        serviceName: c.serviceName,
        fullUrl: computeFullUrl({ ...c }, orgDomain),
      })),
    } : undefined,
  };
}
```

## URL Computation

```typescript
function computeFullUrl(
  mapping: ServiceDomainMapping,
  orgDomain: OrganizationDomain
): string {
  const protocol = mapping.sslEnabled ? 'https' : 'http';
  const subdomain = mapping.subdomain ? `${mapping.subdomain}.` : '';
  const basePath = mapping.basePath || '';
  
  return `${protocol}://${subdomain}${orgDomain.domain}${basePath}`;
}

// Examples:
// { subdomain: "api", domain: "example.com", basePath: null, ssl: true }
//   → https://api.example.com

// { subdomain: null, domain: "example.com", basePath: "/api", ssl: true }
//   → https://example.com/api

// { subdomain: "admin", domain: "example.com", basePath: "/v1", ssl: true }
//   → https://admin.example.com/v1

// { subdomain: null, domain: "example.com", basePath: null, ssl: false }
//   → http://example.com
```

## Updated ServiceContext Types

```typescript
interface ServiceContext {
  // ... existing fields ...
  
  // UPDATED: domains field
  domains: ServiceDomainMapping[];
  
  // Helper methods
  getPrimaryDomain(): ServiceDomainMapping | undefined;
  getAllUrls(): string[];
  getDomainByUrl(url: string): ServiceDomainMapping | undefined;
}

interface ServiceDomainMapping {
  id: string;
  projectDomainId: string;
  subdomain: string | null;
  basePath: string | null;
  isPrimary: boolean;
  sslEnabled: boolean;
  sslProvider: 'letsencrypt' | 'custom' | 'none';
  
  // Computed (from joins)
  fullUrl: string;
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: 'verified';
  };
}
```

## API Endpoints Summary

### Organization Domains
- `POST /api/organizations/:orgId/domains` - Add domain
- `GET /api/organizations/:orgId/domains` - List domains
- `POST /api/organizations/:orgId/domains/:id/verify` - Verify domain
- `DELETE /api/organizations/:orgId/domains/:id` - Remove domain

### Project Domains
- `GET /api/organizations/:orgId/domains/available?projectId=:id` - Get available domains
- `POST /api/projects/:projectId/domains` - Add domain to project
- `GET /api/projects/:projectId/domains` - List project domains
- `PUT /api/projects/:projectId/domains/:id` - Update allowed subdomains
- `DELETE /api/projects/:projectId/domains/:id` - Remove domain from project

### Service Domain Mappings
- `GET /api/projects/:projectId/domains/available?serviceId=:id` - Get available for service
- `POST /api/project-domains/:id/check-subdomain` - Check availability
- `POST /api/services/:serviceId/domains` - Add domain mapping
- `GET /api/services/:serviceId/domains` - List service domains
- `PUT /api/services/:serviceId/domains/:id` - Update mapping
- `DELETE /api/services/:serviceId/domains/:id` - Remove mapping
- `PUT /api/services/:serviceId/domains/:id/primary` - Set as primary

## Migration Strategy

### Phase 1: Schema Migration
1. Create new tables (organization_domains, project_domains, service_domain_mappings)
2. Migrate existing auto-generated domains to organization_domains (mark as verified)
3. Create project_domains entries for each project's base domain
4. Migrate service domains to service_domain_mappings

### Phase 2: API Implementation
1. Implement organization domain management endpoints
2. Implement DNS verification service
3. Implement project domain selection endpoints
4. Implement service domain mapping endpoints with conflict detection

### Phase 3: Frontend Implementation
1. Organization settings: Domain management UI
2. Project settings: Domain selection UI
3. Service settings: Domain mapping UI with conflict warnings
4. Dashboard: Domain overview and verification status

### Phase 4: Deployment
1. Run schema migration
2. Run data migration
3. Deploy new API
4. Deploy new frontend
5. Update documentation

## Benefits

1. **Organization-Level Control**: Centralized domain management
2. **DNS Verification**: Ensures domain ownership before use
3. **Project Flexibility**: Projects choose which domains to use
4. **Service Precision**: Services map to exact URLs with conflict detection
5. **Multi-Domain Support**: Services can use multiple domains/subdomains
6. **Path-Based Routing**: Multiple services can share a subdomain via different paths
7. **Type Safety**: Fully typed schema and contexts
8. **User-Friendly**: Clear warnings and suggestions for conflicts

## Examples

### Example 1: Simple Setup
```
Organization: Acme Corp
  └─ Domains:
      └─ acme.com (verified)

Project: API Platform
  └─ Selected Domains:
      └─ acme.com
          └─ Allowed Subdomains: [api, staging]

Services:
  ├─ API Service
  │   └─ api.acme.com (primary)
  └─ Staging API Service
      └─ staging.acme.com
```

### Example 2: Multi-Domain with Conflicts
```
Organization: Startup Inc
  └─ Domains:
      ├─ startup.io (verified)
      └─ startup.com (verified)

Project: Main App
  └─ Selected Domains:
      ├─ startup.io
      │   └─ Allowed Subdomains: [api, *]
      └─ startup.com
          └─ Allowed Subdomains: [www]

Services:
  ├─ API V1
  │   ├─ api.startup.io/v1
  │   └─ api.startup.com/v1
  ├─ API V2
  │   └─ api.startup.io/v2  ⚠️ Sharing 'api' subdomain with V1
  └─ Web App
      ├─ www.startup.com (primary)
      └─ startup.io
```

### Example 3: Complex Routing
```
Organization: Enterprise Co
  └─ Domains:
      └─ enterprise.app (verified)

Project: SaaS Platform
  └─ Selected Domains:
      └─ enterprise.app
          └─ Allowed Subdomains: [*, app, admin]

Services:
  ├─ Public Website
  │   └─ enterprise.app (root domain)
  ├─ Customer Portal
  │   └─ app.enterprise.app
  ├─ Admin Panel V1
  │   └─ admin.enterprise.app/v1
  ├─ Admin Panel V2
  │   └─ admin.enterprise.app/v2  ⚠️ Sharing 'admin' subdomain
  └─ Analytics Dashboard
      └─ analytics.enterprise.app
```
