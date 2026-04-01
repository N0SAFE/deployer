# Domain Module Architecture

> **Last Updated**: 2025-11-30

## System Overview

The Domain module follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          DomainModule                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    CONTROLLER LAYER                          │   │
│  │  OrganizationDomainController | ProjectDomainController      │   │
│  │                 ServiceDomainController                       │   │
│  │  (ORPC endpoints for all domain operations)                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │   Domain    │     │   Domain    │     │Organization │           │
│  │Verification │     │  Conflict   │     │   Domain    │           │
│  │   Service   │     │   Service   │     │   Service   │           │
│  └─────────────┘     └─────────────┘     └─────────────┘           │
│         │                    │                    │                 │
│         │                    ▼                    │                 │
│         │           ┌─────────────┐               │                 │
│         │           │   Service   │               │                 │
│         │           │   Domain    │               │                 │
│         │           │  Mapping    │               │                 │
│         │           │   Service   │               │                 │
│         │           └─────────────┘               │                 │
│         │                    │                    │                 │
│         └────────────────────┼────────────────────┘                 │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    ADAPTER LAYER                             │   │
│  │                     DomainAdapter                            │   │
│  │  (Entity-to-Contract transformations)                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    REPOSITORY LAYER                          │   │
│  │  OrganizationDomainRepository | ProjectDomainRepository      │   │
│  │               ServiceDomainMappingRepository                  │   │
│  │  (All database operations go through this layer)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DATABASE LAYER                            │   │
│  │              PostgreSQL via Drizzle ORM                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. Controllers (ORPC Handlers)

#### OrganizationDomainController

**Role**: Handles organization-level domain operations.

```typescript
@Controller()
export class OrganizationDomainController {
  // Domain Registration
  addOrganizationDomain()        // Register new domain
  listOrganizationDomains()      // List all org domains
  getOrganizationDomain()        // Get domain details
  
  // Verification
  verifyOrganizationDomain()     // Trigger DNS verification
  
  // Lifecycle
  deleteOrganizationDomain()     // Remove domain (cascades)
}
```

#### ProjectDomainController

**Role**: Handles project-level domain assignment.

```typescript
@Controller()
export class ProjectDomainController {
  // Domain Assignment
  addProjectDomain()             // Assign domain to project
  listProjectDomains()           // List project's domains
  getAvailableDomains()          // Get unassigned verified domains
  
  // Configuration
  updateProjectDomain()          // Update allowed subdomains
  
  // Removal
  removeProjectDomain()          // Unassign from project
}
```

#### ServiceDomainController

**Role**: Handles service URL mapping.

```typescript
@Controller()
export class ServiceDomainController {
  // Availability Check
  checkSubdomainAvailability()   // Check if subdomain+path free
  
  // Mapping Operations
  listServiceDomains()           // List service URLs
  addServiceDomain()             // Create URL mapping
  updateServiceDomain()          // Update mapping
  setPrimaryServiceDomain()      // Set primary URL
  removeServiceDomain()          // Delete mapping
}
```

### 2. Services

#### DomainVerificationService

**Role**: DNS-based domain ownership verification.

```typescript
@Injectable()
export class DomainVerificationService {
  // Token Generation
  generateVerificationToken()    // Create unique verification token
  
  // Instructions
  getVerificationInstructions()  // Get DNS record instructions
  
  // Verification
  verifyDomain()                 // Check DNS records
  verifyTxtRecord()              // Check TXT record
  verifyCnameRecord()            // Check CNAME record
  
  // Auto-verification
  autoVerifyPendingDomains()     // Cron job for pending domains
  retryVerification()            // Retry failed verification
  
  // Stats
  getPendingDomainsCount()       // Count pending verifications
}
```

#### DomainConflictService

**Role**: Subdomain and path conflict detection.

```typescript
@Injectable()
export class DomainConflictService {
  // Availability
  checkSubdomainAvailability()   // Check subdomain+path conflicts
  
  // Suggestions
  generateAvailableBasePaths()   // Suggest available paths
  
  // Validation
  validateSubdomain()            // DNS subdomain format
  validateBasePath()             // URL path format
  
  // Display
  computePlaceholderUrl()        // Generate display URL
}
```

#### OrganizationDomainService

**Role**: Organization domain business logic (thin layer).

```typescript
@Injectable()
export class OrganizationDomainService {
  create()                       // Create org domain
  findById()                     // Get by ID
  findByOrganizationId()         // Get org's domains
  findByDomain()                 // Get by domain name
  domainExists()                 // Check existence
  update()                       // Update domain
  updateVerificationStatus()     // Update verification
  findPendingDomains()           // Get pending domains
  findVerifiedByOrganizationId() // Get verified domains
  delete()                       // Delete domain
  countByOrganizationId()        // Count domains
}
```

#### ServiceDomainMappingService

**Role**: Service-to-domain URL mapping.

```typescript
@Injectable()
export class ServiceDomainMappingService {
  create()                       // Create mapping
  findById()                     // Get by ID
  findByServiceId()              // Get service's mappings
  findByServiceIdWithUrls()      // With computed URLs
  findByProjectDomainId()        // Get project domain's mappings
  findByProjectDomainAndPath()   // Find by subdomain+path
  findByExactMatch()             // Find exact match
  update()                       // Update mapping
  delete()                       // Delete mapping
  deleteByServiceId()            // Delete all for service
  countByProjectDomainId()       // Count mappings
}
```

### 3. Adapter

#### DomainAdapter

**Role**: Static methods for entity-to-contract transformation.

```typescript
export class DomainAdapter {
  // Entity → Contract Transformations
  static toOrganizationDomainContract()   // Org domain entity → API
  static toAddDomainResponse()            // With verification instructions
  static toVerifyDomainResponse()         // Verification result → API
  static toProjectDomainContract()        // Project domain entity → API
  static toAvailableDomainsResponse()     // Available domains → API
  static toServiceDomainMappingContract() // Mapping entity → API
  static toServiceDomainMappingWithUrl()  // With computed full URL
  static toConflictCheckResult()          // Conflict check → API
}
```

### 4. Interfaces

The `interfaces/` directory organizes all TypeScript types and interfaces used across the module:

```
interfaces/
├── index.ts                       # Barrel export for all interfaces
├── verification.interfaces.ts     # Verification types
├── conflict.interfaces.ts         # Conflict detection types
├── service-mapping.interfaces.ts  # Service mapping types
├── organization-domain.interfaces.ts # Organization domain types
└── project-domain.interfaces.ts   # Project domain types
```

**Key Interface Categories:**

- **Verification Types**: `VerificationMethod`, `VerificationInstructions`, `VerifyDomainResult`
- **Conflict Types**: `SubdomainConflict`, `SubdomainAvailabilityResult`, `SubdomainValidationResult`, `BasePathValidationResult`
- **Service Mapping Types**: `ServiceDomainMapping`, `ServiceDomainMappingWithUrls`, `SSLProvider`, `SSLConfig`
- **Organization Domain Types**: `OrganizationDomain`, `RegisterDomainInput`, `RegisterDomainResponse`, `ListDomainsOptions`
- **Project Domain Types**: `ProjectDomain`, `AssignDomainInput`, `AssignDomainResponse`, `AvailableDomain`, `GranularityCheckResult`

### 5. Error Classes

The `errors/` directory contains domain-specific error classes following a hierarchical structure:

```
errors/
├── index.ts                       # Barrel export
├── domain-error.base.ts           # Base DomainError class
├── organization-domain.errors.ts  # Organization domain errors
├── project-domain.errors.ts       # Project domain errors
├── service-mapping.errors.ts      # Service mapping errors
├── verification.errors.ts         # Verification errors
└── conflict.errors.ts             # Conflict detection errors
```

**Error Hierarchy:**

```typescript
DomainError (base)
├── DomainNotFoundError
├── DomainExistsError
├── ProjectDomainNotFoundError
├── ProjectDomainExistsError
├── ServiceMappingNotFoundError
├── ServiceMappingExistsError
├── DomainNotVerifiedError
├── VerificationFailedError
├── SubdomainConflictError
├── BasePathConflictError
├── InvalidSubdomainError
├── InvalidBasePathError
└── ... (19 error types total)
```

All errors include:
- HTTP status code
- Error code for client identification
- Descriptive message
- Optional context metadata

### 6. Repositories

#### OrganizationDomainRepository

```typescript
@Injectable()
export class OrganizationDomainRepository {
  create()                       // Insert new domain
  findById()                     // SELECT by ID
  findByOrganizationId()         // SELECT by org ID
  findByDomain()                 // SELECT by domain name
  domainExists()                 // Check existence
  update()                       // UPDATE domain
  updateVerificationStatus()     // UPDATE verification fields
  findPendingDomains()           // SELECT pending status
  findVerifiedByOrganizationId() // SELECT verified domains
  delete()                       // DELETE domain
  countByOrganizationId()        // COUNT by org
}
```

#### ProjectDomainRepository

```typescript
@Injectable()
export class ProjectDomainRepository {
  create()                       // Insert project domain
  findById()                     // SELECT by ID
  findByProjectId()              // SELECT by project
  findByProjectAndOrgDomain()    // SELECT by project+org domain
  hasProjectDomainMapping()      // Check mapping exists
  getAvailableDomainsForProject() // SELECT available domains
  update()                       // UPDATE project domain
  updateAllowedSubdomains()      // UPDATE subdomains array
  delete()                       // DELETE project domain
  countByProjectId()             // COUNT by project
  countByOrganizationDomainId()  // COUNT by org domain
}
```

#### ServiceDomainMappingRepository

```typescript
@Injectable()
export class ServiceDomainMappingRepository {
  create()                       // Insert mapping
  findById()                     // SELECT by ID
  findByServiceId()              // SELECT by service
  findByProjectDomainId()        // SELECT by project domain
  findByServiceAndProjectDomain() // SELECT by both
  isCombinationAvailable()       // Check subdomain+path availability
  getFullUrl()                   // Compute full URL with joins
  findByServiceIdWithUrls()      // With computed URLs
  update()                       // UPDATE mapping
  delete()                       // DELETE mapping
  countByServiceId()             // COUNT by service
  countByProjectDomainId()       // COUNT by project domain
  findBySubdomain()              // SELECT by subdomain
  findByProjectDomainAndPathWithServiceNames() // With service names
}
```

## Data Flow

### Domain Registration Flow

```
1. Client calls addOrganizationDomain()
   │
2. Controller validates input
   │
3. OrganizationDomainRepository.findByDomain() - check not exists
   │
4. DomainVerificationService.generateVerificationToken()
   │
5. DomainVerificationService.getVerificationInstructions()
   │
6. OrganizationDomainRepository.create() - saves to database
   │
7. DomainAdapter.toAddDomainResponse() - format response
   │
8. Return domain + verification instructions to client
```

### Domain Verification Flow

```
1. Client calls verifyOrganizationDomain()
   │
2. Controller fetches domain from repository
   │
3. DomainVerificationService.verifyDomain()
   │
   ├── (TXT) dns.resolveTxt() - query DNS
   │   └── Compare with expected token
   │
   └── (CNAME) dns.resolveCname() - query DNS
       └── Compare with expected value
   │
4. OrganizationDomainRepository.updateVerificationStatus()
   │
5. DomainAdapter.toVerifyDomainResponse()
   │
6. Return verification result to client
```

### Service Domain Mapping Flow

```
1. Client calls addServiceDomain()
   │
2. Controller validates project domain exists
   │
3. DomainConflictService.checkSubdomainAvailability()
   │   └── Returns conflicts and suggestions
   │
4. If conflicts exist → throw error with suggestions
   │
5. ServiceDomainMappingRepository.create()
   │
6. ServiceDomainMappingRepository.getFullUrl()
   │
7. Check for shared subdomain warning
   │
8. DomainAdapter.toServiceDomainMappingWithUrl()
   │
9. Return mapping with full URL to client
```

### URL Resolution Flow

```
Incoming Request: https://api.example.com/v1/users
                            │
                            ▼
                  ┌─────────────────┐
                  │  Traefik Proxy  │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     Route by Host header      Route by PathPrefix
     (api.example.com)         (/v1)
              │                         │
              └────────────┬────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Service Domain Mapping │
              │  subdomain: "api"       │
              │  basePath: "/v1"        │
              │  serviceId: "svc_123"   │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │     Target Service     │
              │  http://service:3000   │
              └────────────────────────┘
```

## Database Schema

### organization_domains

```sql
CREATE TABLE organization_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  domain VARCHAR(255) NOT NULL,
  
  -- Verification
  verification_status verification_status NOT NULL DEFAULT 'pending',
  verification_method verification_method NOT NULL DEFAULT 'txt_record',
  verification_token VARCHAR(255) NOT NULL,
  dns_record_checked BOOLEAN NOT NULL DEFAULT false,
  last_verification_attempt TIMESTAMP,
  verified_at TIMESTAMP,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  
  UNIQUE(organization_id, domain)
);

CREATE INDEX org_domains_verification_status_idx ON organization_domains(verification_status);
CREATE INDEX org_domains_organization_id_idx ON organization_domains(organization_id);
```

### project_domains

```sql
CREATE TABLE project_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_domain_id UUID NOT NULL REFERENCES organization_domains(id) ON DELETE CASCADE,
  
  -- Subdomain Management
  allowed_subdomains VARCHAR(100)[] NOT NULL DEFAULT '{}',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  
  UNIQUE(project_id, organization_domain_id)
);

CREATE INDEX project_domains_project_id_idx ON project_domains(project_id);
CREATE INDEX project_domains_org_domain_id_idx ON project_domains(organization_domain_id);
```

### service_domain_mappings

```sql
CREATE TABLE service_domain_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  project_domain_id UUID NOT NULL REFERENCES project_domains(id) ON DELETE CASCADE,
  
  -- URL Configuration
  subdomain VARCHAR(63),  -- DNS subdomain max length
  base_path VARCHAR(255),
  
  -- Priority and SSL
  is_primary BOOLEAN NOT NULL DEFAULT false,
  ssl_enabled BOOLEAN NOT NULL DEFAULT true,
  ssl_provider ssl_provider NOT NULL DEFAULT 'letsencrypt',
  
  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  
  UNIQUE(project_domain_id, subdomain, base_path)
);

CREATE INDEX service_domain_mappings_service_id_idx ON service_domain_mappings(service_id);
CREATE INDEX service_domain_mappings_project_domain_id_idx ON service_domain_mappings(project_domain_id);
```

### Enums

```sql
CREATE TYPE verification_status AS ENUM ('pending', 'verified', 'failed');
CREATE TYPE verification_method AS ENUM ('txt_record', 'cname_record');
CREATE TYPE ssl_provider AS ENUM ('letsencrypt', 'custom', 'none');
```

## Dependency Graph

```
                    DomainModule
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    DatabaseModule  AuthModule    DeploymentModule
          │                             │
          ▼                             ▼
       GlobalDatabaseService              projects / services
          │                          tables
          ▼
    Drizzle ORM → PostgreSQL
```

### Service Dependencies

```
OrganizationDomainController
├── OrganizationDomainRepository ✓
└── DomainVerificationService ✓

ProjectDomainController
├── ProjectDomainRepository ✓
├── OrganizationDomainRepository ✓
└── ServiceDomainMappingRepository ✓

ServiceDomainController
├── ServiceDomainMappingRepository ✓
├── ProjectDomainRepository ✓
├── OrganizationDomainRepository ✓
└── DomainConflictService ✓

DomainVerificationService
└── OrganizationDomainService ✓

DomainConflictService
└── ServiceDomainMappingService ✓

OrganizationDomainService
└── OrganizationDomainRepository ✓

ServiceDomainMappingService
└── ServiceDomainMappingRepository ✓
```

### No Circular Dependencies ✓

All service dependencies flow in one direction without cycles.

## Cross-Module Integration

### With Traefik Module

When a service domain mapping is created/updated, Traefik configurations need to be updated:

```typescript
// Future integration point
@Injectable()
export class ServiceDomainMappingService {
  constructor(
    private readonly traefikService: TraefikService, // Future
  ) {}

  async create(data: CreateMapping) {
    const mapping = await this.repository.create(data);
    
    // Trigger Traefik config update
    await this.traefikService.updateServiceRoute(mapping.serviceId, {
      domain: fullDomain,
      subdomain: mapping.subdomain,
      basePath: mapping.basePath,
      sslEnabled: mapping.sslEnabled,
    });
    
    return mapping;
  }
}
```

### With Deployment Module

Services reference the deployment module's `services` table:

```typescript
// service_domain_mappings.serviceId → services.id
const mapping = await repository.create({
  serviceId: deployedService.id,  // From deployment module
  projectDomainId: projectDomain.id,
  subdomain: 'api',
});
```

## Security Considerations

1. **Domain Ownership Verification**
   - DNS-based verification prevents domain hijacking
   - Tokens are cryptographically random (16 bytes hex)
   - Verification status prevents use of unverified domains

2. **Access Control**
   - Organization domains scoped to organization
   - Project domains scoped to project
   - Service mappings scoped to service

3. **SSL by Default**
   - `sslEnabled: true` is the default
   - Let's Encrypt auto-provisioning

4. **Input Validation**
   - Subdomain format validation (DNS rules)
   - Base path format validation
   - Domain format validation

## Performance Considerations

1. **Database Indexes**
   - All foreign keys indexed
   - Verification status indexed for cron queries
   - Unique constraints prevent duplicates

2. **Caching Opportunity**
   - Domain verification status (changes infrequently)
   - Full URL computation (expensive joins)

3. **Efficient Queries**
   - Single query for availability check
   - Batch operations for multiple mappings
