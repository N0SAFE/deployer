# API Reference

> **Last Updated**: 2025-11-30

## Overview

This document provides a complete reference for all domain module APIs, including ORPC contract endpoints, service methods, and repository operations.

## ORPC Endpoints

All endpoints are defined in `@repo/api-contracts` and implemented in the domain controllers.

---

## Organization Domain Operations

### addOrganizationDomain

Register a new domain for an organization.

**Contract**: `domainContract.addOrganizationDomain`

**Input**:
```typescript
{
  organizationId: string;        // Organization UUID
  domain: string;                // Domain name (e.g., "example.com")
  verificationMethod: 'txt_record' | 'cname_record';
}
```

**Output**:
```typescript
{
  organizationDomain: {
    id: string;
    organizationId: string;
    domain: string;
    verificationStatus: 'pending' | 'verified' | 'failed';
    verificationMethod: 'txt_record' | 'cname_record';
    verificationToken: string;
    dnsRecordChecked: boolean;
    lastVerificationAttempt: Date | null;
    verifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    metadata?: Record<string, unknown>;
  };
  verificationInstructions: {
    method: 'txt_record' | 'cname_record';
    recordName: string;          // "_deployer-verify.example.com"
    recordValue: string;         // Token or CNAME target
    instructions: string;        // Human-readable instructions
  };
}
```

**Errors**:
- `Domain {domain} is already registered` - Domain exists in system

---

### listOrganizationDomains

List all domains for an organization.

**Contract**: `domainContract.listOrganizationDomains`

**Input**:
```typescript
{
  organizationId: string;
  verificationStatus?: 'pending' | 'verified' | 'failed';  // Optional filter
}
```

**Output**:
```typescript
OrganizationDomain[]  // Array of organization domains
```

---

### getOrganizationDomain

Get a single organization domain by ID.

**Contract**: `domainContract.getOrganizationDomain`

**Input**:
```typescript
{
  domainId: string;
}
```

**Output**:
```typescript
OrganizationDomain
```

**Errors**:
- `Organization domain {domainId} not found`

---

### verifyOrganizationDomain

Trigger DNS verification for a domain.

**Contract**: `domainContract.verifyOrganizationDomain`

**Input**:
```typescript
{
  domainId: string;
}
```

**Output**:
```typescript
{
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

**Errors**:
- `Domain {domainId} not found`

---

### deleteOrganizationDomain

Delete an organization domain (cascades to all child records).

**Contract**: `domainContract.deleteOrganizationDomain`

**Input**:
```typescript
{
  domainId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  message: string;
}
```

**Errors**:
- `Domain {domainId} not found`
- `Failed to delete domain {domainId}`

---

## Project Domain Operations

### addProjectDomain

Assign a verified organization domain to a project.

**Contract**: `domainContract.addProjectDomain`

**Input**:
```typescript
{
  projectId: string;
  organizationDomainId: string;
  allowedSubdomains?: string[];  // Default: []
  isPrimary?: boolean;           // Default: false
}
```

**Output**:
```typescript
{
  projectDomain: {
    id: string;
    projectId: string;
    organizationDomainId: string;
    allowedSubdomains: string[];
    isPrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
    metadata?: Record<string, unknown>;
    organizationDomain: OrganizationDomain;  // Included
  };
  suggestions: {
    commonSubdomains: string[];  // ["api", "www", "app", "admin", "staging"]
    wildcardOption: string;      // "*"
  };
}
```

**Errors**:
- `Organization domain {id} not found`
- `Domain {domain} is not verified. Please verify the domain first.`
- `Project already uses domain {domain}`

---

### listProjectDomains

List all domains assigned to a project.

**Contract**: `domainContract.listProjectDomains`

**Input**:
```typescript
{
  projectId: string;
}
```

**Output**:
```typescript
Array<ProjectDomain & { organizationDomain: OrganizationDomain }>
```

---

### getAvailableDomains

Get verified organization domains available for a project.

**Contract**: `domainContract.getAvailableDomains`

**Input**:
```typescript
{
  projectId: string;
}
```

**Output**:
```typescript
Array<{
  id: string;
  domain: string;
  verificationStatus: 'verified';
  verifiedAt: Date;
  alreadySelected: boolean;  // Whether already assigned to this project
}>
```

---

### updateProjectDomain

Update project domain configuration.

**Contract**: `domainContract.updateProjectDomain`

**Input**:
```typescript
{
  domainId: string;
  allowedSubdomains?: string[];
  isPrimary?: boolean;
}
```

**Output**:
```typescript
ProjectDomain & { organizationDomain: OrganizationDomain }
```

**Errors**:
- `Project domain {domainId} not found`
- `Failed to update project domain {domainId}`

---

### removeProjectDomain

Remove a domain from a project (cascades to service mappings).

**Contract**: `domainContract.removeProjectDomain`

**Input**:
```typescript
{
  domainId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  message: string;
  affectedServices: number;  // Count of deleted service mappings
}
```

**Errors**:
- `Project domain {domainId} not found`
- `Failed to delete project domain {domainId}`

---

## Service Domain Operations

### checkSubdomainAvailability

Check if a subdomain+path combination is available.

**Contract**: `domainContract.checkSubdomainAvailability`

**Input**:
```typescript
{
  projectDomainId: string;
  subdomain: string | null;    // Can be multi-level like "staging.api"
  basePath?: string | null;    // Default: null (root path)
  excludeServiceId?: string;   // Exclude when updating
}
```

**Output**:
```typescript
{
  available: boolean;
  conflicts: Array<{
    subdomain: string | null;
    basePath: string | null;
    serviceId: string;
  }>;
  suggestions: {
    availableBasePaths: string[];
    message: string;
  };
}
```

---

### listServiceDomains

List all domain mappings for a service.

**Contract**: `domainContract.listServiceDomains`

**Input**:
```typescript
{
  serviceId: string;
}
```

**Output**:
```typescript
Array<ServiceDomainMapping & {
  fullUrl: string;
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: 'verified';
  };
}>
```

---

### addServiceDomain

Create a new service domain mapping.

**Contract**: `domainContract.addServiceDomain`

**Input**:
```typescript
{
  serviceId: string;
  projectDomainId: string;
  subdomain?: string | null;    // Can be multi-level like "v2.staging.api"
  basePath?: string | null;     // Default: null
  isPrimary?: boolean;          // Default: false
  sslEnabled?: boolean;         // Default: true
  sslProvider?: 'letsencrypt' | 'custom' | 'none';  // Default: 'letsencrypt'
}
```

**Output**:
```typescript
{
  mapping: ServiceDomainMapping & {
    fullUrl: string;
    organizationDomain: {
      id: string;
      domain: string;
      verificationStatus: 'verified';
    };
  };
  fullUrl: string;
  warning?: {
    message: string;
    sharedWith: Array<{
      serviceName: string;
      fullUrl: string;
    }>;
  };
}
```

**Errors**:
- `Project domain {id} not found`
- `Subdomain+path combination already in use. Available base paths: ...`

---

### updateServiceDomain

Update a service domain mapping.

**Contract**: `domainContract.updateServiceDomain`

**Input**:
```typescript
{
  mappingId: string;
  subdomain?: string | null;
  basePath?: string | null;
  isPrimary?: boolean;
  sslEnabled?: boolean;
  sslProvider?: 'letsencrypt' | 'custom' | 'none';
}
```

**Output**:
```typescript
ServiceDomainMapping & {
  fullUrl: string;
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: 'verified';
  };
}
```

**Errors**:
- `Service domain mapping {mappingId} not found`
- `Subdomain+path combination already in use. Available base paths: ...`
- `Failed to update service domain mapping {mappingId}`

---

### setPrimaryServiceDomain

Set the primary URL for a service.

**Contract**: `domainContract.setPrimaryServiceDomain`

**Input**:
```typescript
{
  serviceId: string;
  mappingId: string;
}
```

**Output**:
```typescript
ServiceDomainMapping & {
  fullUrl: string;
  organizationDomain: {
    id: string;
    domain: string;
    verificationStatus: 'verified';
  };
}
```

**Errors**:
- `Service domain mapping {mappingId} not found`
- `Mapping {mappingId} does not belong to service {serviceId}`
- `Failed to set primary domain`

---

### removeServiceDomain

Remove a service domain mapping.

**Contract**: `domainContract.removeServiceDomain`

**Input**:
```typescript
{
  serviceId: string;
  mappingId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
  message: string;
}
```

**Errors**:
- `Service domain mapping {mappingId} not found`
- `Mapping {mappingId} does not belong to service {serviceId}`
- `Failed to delete service domain mapping {mappingId}`

---

## Service Methods

### DomainVerificationService

```typescript
class DomainVerificationService {
  // Generate cryptographically secure verification token
  generateVerificationToken(): string;
  
  // Get DNS record instructions for domain verification
  getVerificationInstructions(
    domain: string,
    token: string,
    method: 'txt_record' | 'cname_record'
  ): VerificationInstructions;
  
  // Verify domain ownership via DNS
  verifyDomain(domainId: string): Promise<VerifyDomainResult>;
  
  // Auto-verify all pending domains (cron job)
  autoVerifyPendingDomains(): Promise<void>;
  
  // Get count of pending verifications
  getPendingDomainsCount(organizationId: string): Promise<number>;
  
  // Retry a failed verification
  retryVerification(domainId: string): Promise<VerifyDomainResult>;
}
```

### DomainConflictService

```typescript
class DomainConflictService {
  // Check if subdomain+path combination is available
  checkSubdomainAvailability(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string | null,
    excludeServiceId?: string
  ): Promise<SubdomainAvailabilityResult>;
  
  // Validate subdomain format (supports multi-level)
  validateSubdomain(subdomain: string): { valid: boolean; error?: string };
  
  // Validate base path format
  validateBasePath(basePath: string): { valid: boolean; error?: string };
}
```

### OrganizationDomainService

```typescript
class OrganizationDomainService {
  create(data: InsertOrganizationDomain): Promise<OrganizationDomain>;
  findById(id: string): Promise<OrganizationDomain | null>;
  findByOrganizationId(organizationId: string): Promise<OrganizationDomain[]>;
  findByDomain(domain: string): Promise<OrganizationDomain | null>;
  domainExists(domain: string, excludeId?: string): Promise<boolean>;
  update(id: string, data: Partial<OrganizationDomain>): Promise<OrganizationDomain | null>;
  updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    method?: VerificationMethod,
    verifiedAt?: Date
  ): Promise<OrganizationDomain | null>;
  findPendingDomains(): Promise<OrganizationDomain[]>;
  findVerifiedByOrganizationId(organizationId: string): Promise<OrganizationDomain[]>;
  delete(id: string): Promise<boolean>;
  countByOrganizationId(organizationId: string): Promise<number>;
}
```

### ServiceDomainMappingService

```typescript
class ServiceDomainMappingService {
  create(data: InsertServiceDomainMapping): Promise<ServiceDomainMapping>;
  findById(id: string): Promise<ServiceDomainMapping | null>;
  findByServiceId(serviceId: string): Promise<ServiceDomainMapping[]>;
  findByServiceIdWithUrls(serviceId: string): Promise<ServiceDomainMappingWithUrls[]>;
  findByProjectDomainId(projectDomainId: string): Promise<ServiceDomainMapping[]>;
  findByProjectDomainAndPath(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<ServiceDomainMapping[]>;
  findByExactMatch(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string | null
  ): Promise<ServiceDomainMapping | null>;
  update(id: string, data: Partial<ServiceDomainMapping>): Promise<ServiceDomainMapping | null>;
  delete(id: string): Promise<boolean>;
  deleteByServiceId(serviceId: string): Promise<number>;
  countByProjectDomainId(projectDomainId: string): Promise<number>;
  findByProjectDomainAndPathWithServiceNames(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<Array<{
    serviceId: string;
    serviceName: string;
    subdomain: string | null;
    basePath: string | null;
  }>>;
}
```

---

## Repository Methods

### OrganizationDomainRepository

```typescript
class OrganizationDomainRepository {
  create(data: InsertOrganizationDomain): Promise<OrganizationDomain>;
  findById(id: string): Promise<OrganizationDomain | null>;
  findByOrganizationId(organizationId: string): Promise<OrganizationDomain[]>;
  findByDomain(domain: string): Promise<OrganizationDomain | null>;
  domainExists(domain: string, excludeId?: string): Promise<boolean>;
  update(id: string, data: Partial<OrganizationDomain>): Promise<OrganizationDomain | null>;
  updateVerificationStatus(
    id: string,
    status: VerificationStatus,
    method?: VerificationMethod,
    verifiedAt?: Date
  ): Promise<OrganizationDomain | null>;
  findPendingDomains(): Promise<OrganizationDomain[]>;
  findVerifiedByOrganizationId(organizationId: string): Promise<OrganizationDomain[]>;
  delete(id: string): Promise<boolean>;
  countByOrganizationId(organizationId: string): Promise<number>;
}
```

### ProjectDomainRepository

```typescript
class ProjectDomainRepository {
  create(data: InsertProjectDomain): Promise<ProjectDomain>;
  findById(id: string): Promise<ProjectDomain | null>;
  findByProjectId(projectId: string): Promise<ProjectDomain[]>;
  findByProjectAndOrgDomain(projectId: string, organizationDomainId: string): Promise<ProjectDomain | null>;
  hasProjectDomainMapping(projectId: string, organizationDomainId: string, excludeId?: string): Promise<boolean>;
  getAvailableDomainsForProject(projectId: string): Promise<Array<{
    organizationDomainId: string;
    domain: string;
    organizationId: string;
  }>>;
  update(id: string, data: Partial<ProjectDomain>): Promise<ProjectDomain | null>;
  updateAllowedSubdomains(id: string, allowedSubdomains: string[]): Promise<ProjectDomain | null>;
  delete(id: string): Promise<boolean>;
  countByProjectId(projectId: string): Promise<number>;
  countByOrganizationDomainId(organizationDomainId: string): Promise<number>;
}
```

### ServiceDomainMappingRepository

```typescript
class ServiceDomainMappingRepository {
  create(data: InsertServiceDomainMapping): Promise<ServiceDomainMapping>;
  findById(id: string): Promise<ServiceDomainMapping | null>;
  findByServiceId(serviceId: string): Promise<ServiceDomainMapping[]>;
  findByProjectDomainId(projectDomainId: string): Promise<ServiceDomainMapping[]>;
  findByServiceAndProjectDomain(serviceId: string, projectDomainId: string): Promise<ServiceDomainMapping | null>;
  isCombinationAvailable(
    projectDomainId: string,
    subdomain: string | null,
    basePath: string,
    excludeId?: string
  ): Promise<boolean>;
  getFullUrl(mappingId: string): Promise<string | null>;
  findByServiceIdWithUrls(serviceId: string): Promise<Array<ServiceDomainMapping & { fullUrl: string }>>;
  update(id: string, data: Partial<ServiceDomainMapping>): Promise<ServiceDomainMapping | null>;
  delete(id: string): Promise<boolean>;
  countByServiceId(serviceId: string): Promise<number>;
  countByProjectDomainId(projectDomainId: string): Promise<number>;
  findBySubdomain(projectDomainId: string, subdomain: string | null): Promise<ServiceDomainMapping[]>;
  findByProjectDomainAndPathWithServiceNames(
    projectDomainId: string,
    subdomain: string | null,
    basePath?: string | null,
    excludeServiceId?: string
  ): Promise<Array<{
    serviceId: string;
    serviceName: string;
    subdomain: string | null;
    basePath: string | null;
  }>>;
}
```

---

## Adapter Methods

### DomainAdapter

All methods are static:

```typescript
class DomainAdapter {
  static toOrganizationDomainContract(entity: OrganizationDomain): OrganizationDomainContract;
  static toAddDomainResponse(entity: OrganizationDomain, instructions: VerificationInstructions): AddDomainResponse;
  static toVerifyDomainResponse(result: VerifyResult): VerifyDomainResponse;
  static toProjectDomainContract(entity: ProjectDomain): ProjectDomainContract;
  static toAvailableDomainsResponse(domains: AvailableDomain[]): AvailableDomainResponse[];
  static toServiceDomainMappingContract(entity: ServiceDomainMapping): ServiceDomainMappingContract;
  static toServiceDomainMappingWithUrl(entity: ServiceDomainMapping, fullUrl: string): ServiceDomainMappingWithUrl;
  static toConflictCheckResult(result: ConflictCheck): ConflictCheckResult;
}
```

---

## Type Definitions

### Enums

```typescript
type VerificationStatus = 'pending' | 'verified' | 'failed';
type VerificationMethod = 'txt_record' | 'cname_record';
type SSLProvider = 'letsencrypt' | 'custom' | 'none';
```

### Interfaces

```typescript
interface VerificationInstructions {
  method: VerificationMethod;
  recordName: string;
  recordValue: string;
  instructions: string;
}

interface VerifyDomainResult {
  success: boolean;
  status: 'verified' | 'failed';
  message: string;
  verifiedAt?: Date;
  error?: {
    code: string;
    details: string;
  };
}

interface SubdomainAvailabilityResult {
  available: boolean;
  conflicts: SubdomainConflict[];
  suggestions: {
    availableBasePaths: string[];
    message: string;
  };
}

interface SubdomainConflict {
  serviceId: string;
  serviceName: string;
  subdomain: string | null;
  basePath: string | null;
  fullUrl: string;
}

interface ServiceDomainMappingWithUrls extends ServiceDomainMapping {
  fullUrl: string;
  internalUrl?: string;
}
```
