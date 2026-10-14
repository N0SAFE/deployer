# Error Handling

> Domain-specific error classes for the Domain module

## Implementation Status: ✅ COMPLETE

The Domain module has a comprehensive set of domain-specific error classes following the Traefik module pattern.

## Error Naming Convention (CRITICAL)

**All error messages and logs MUST use `ErrorClass.name`** (the class name) for consistency across the codebase.

This convention applies to:
- Error messages in throw statements
- Log messages
- API error responses
- Debug output

```typescript
// ✅ CORRECT: Use this.name (which equals the class name)
export class OrganizationDomainNotFoundError extends DomainError {
  constructor(domainId: string) {
    super(
      `[${OrganizationDomainNotFoundError.name}] Organization domain ${domainId} not found`,
      'ORGANIZATION_DOMAIN_NOT_FOUND',
      { domainId }
    );
    this.name = OrganizationDomainNotFoundError.name;
  }
}

// ❌ WRONG: Hardcoded string
this.name = 'OrganizationDomainNotFoundError';  // Don't hardcode

// ✅ CORRECT: In logging
this.logger.error(`[${error.name}] ${error.message}`);

// ❌ WRONG: Generic error type
this.logger.error(`Error: ${error.message}`);  // Missing error class name
```

## Error File Structure

```
errors/
├── index.ts                        # Barrel export with documentation
├── domain-error.ts                 # Base DomainError class
├── organization-domain-errors.ts   # Organization domain errors (6)
├── project-domain-errors.ts        # Project domain errors (4)
├── service-domain-mapping-errors.ts # Service mapping errors (9)
└── verification-errors.ts          # Verification errors (5)
```

## Error Hierarchy (24 Total)

```
DomainError (base)
├── OrganizationDomainNotFoundError
├── DomainAlreadyExistsError
├── InvalidDomainFormatError
├── DomainNotVerifiedError
├── DomainDeletionError
├── GranularityViolationError
├── DomainVerificationError (base for verification errors)
│   ├── DnsLookupError
│   ├── VerificationTokenMismatchError
│   ├── VerificationRecordNotFoundError
│   └── VerificationAttemptError
├── ProjectDomainNotFoundError
├── ProjectDomainAlreadyExistsError
├── ProjectDomainUpdateError
├── ProjectDomainDeletionError
├── ServiceDomainMappingNotFoundError
├── ServiceMappingMismatchError
├── SubdomainConflictError
├── SubdomainNotAllowedError
├── InvalidSubdomainFormatError
├── InvalidBasePathFormatError
├── ServiceDomainMappingUpdateError
├── ServiceDomainMappingDeletionError
└── SetPrimaryDomainError
```

### Organization Domain Errors

```typescript
// errors/organization-domain-errors.ts
import { DomainError } from './domain-error';

export class OrganizationDomainNotFoundError extends DomainError {
  constructor(domainId: string) {
    super(
      `[${OrganizationDomainNotFoundError.name}] Organization domain ${domainId} not found`,
      'ORGANIZATION_DOMAIN_NOT_FOUND',
      { domainId }
    );
    this.name = OrganizationDomainNotFoundError.name;
  }
}

export class DomainAlreadyExistsError extends DomainError {
  constructor(domain: string, existingOrgId?: string) {
    super(
      `[${DomainAlreadyExistsError.name}] Domain ${domain} is already registered`,
      'DOMAIN_ALREADY_EXISTS',
      { domain, existingOrgId }
    );
    this.name = DomainAlreadyExistsError.name;
  }
}

export class InvalidDomainFormatError extends DomainError {
  constructor(domain: string, reason?: string) {
    super(
      `[${InvalidDomainFormatError.name}] Invalid domain format: ${domain}${reason ? ` (${reason})` : ''}`,
      'INVALID_DOMAIN_FORMAT',
      { domain, reason }
    );
    this.name = InvalidDomainFormatError.name;
  }
}

export class DomainNotVerifiedError extends DomainError {
  constructor(domain: string, domainId: string) {
    super(
      `[${DomainNotVerifiedError.name}] Domain ${domain} is not verified. Please verify the domain first.`,
      'DOMAIN_NOT_VERIFIED',
      { domain, domainId }
    );
    this.name = DomainNotVerifiedError.name;
  }
}

export class DomainDeletionError extends DomainError {
  constructor(domainId: string, reason?: string) {
    super(
      `[${DomainDeletionError.name}] Failed to delete domain ${domainId}${reason ? `: ${reason}` : ''}`,
      'DOMAIN_DELETION_FAILED',
      { domainId, reason }
    );
    this.name = DomainDeletionError.name;
  }
}

export class GranularityViolationError extends DomainError {
  constructor(requestedDomain: string, registeredDomain: string) {
    super(
      `[${GranularityViolationError.name}] Cannot use ${requestedDomain} - it is above the registered domain level ${registeredDomain}`,
      'GRANULARITY_VIOLATION',
      { requestedDomain, registeredDomain }
    );
    this.name = GranularityViolationError.name;
  }
}
```

### Verification Errors

```typescript
// errors/verification-errors.ts
import { DomainError } from './domain-error';

export class DomainVerificationError extends DomainError {
  constructor(domain: string, code: string, details: string) {
    super(
      `[${DomainVerificationError.name}] DNS verification failed for ${domain}: ${details}`,
      code,
      { domain, details }
    );
    this.name = DomainVerificationError.name;
  }
}

export class DnsLookupError extends DomainError {
  constructor(domain: string, recordType: 'TXT' | 'CNAME', error: string) {
    super(
      `[${DnsLookupError.name}] DNS lookup failed for ${domain} (${recordType}): ${error}`,
      'DNS_LOOKUP_FAILED',
      { domain, recordType, error }
    );
    this.name = DnsLookupError.name;
  }
}

export class VerificationTokenMismatchError extends DomainError {
  constructor(domain: string, expected: string, found: string | null) {
    super(
      `[${VerificationTokenMismatchError.name}] Verification token mismatch for ${domain}`,
      'VERIFICATION_TOKEN_MISMATCH',
      { domain, expected, found }
    );
    this.name = VerificationTokenMismatchError.name;
  }
}

export class VerificationRecordNotFoundError extends DomainError {
  constructor(domain: string, recordName: string, method: string) {
    super(
      `[${VerificationRecordNotFoundError.name}] Verification record not found: ${recordName}`,
      'VERIFICATION_RECORD_NOT_FOUND',
      { domain, recordName, method }
    );
    this.name = VerificationRecordNotFoundError.name;
  }
}
```

### Project Domain Errors

```typescript
// errors/project-domain-errors.ts
import { DomainError } from './domain-error';

export class ProjectDomainNotFoundError extends DomainError {
  constructor(projectDomainId: string) {
    super(
      `[${ProjectDomainNotFoundError.name}] Project domain ${projectDomainId} not found`,
      'PROJECT_DOMAIN_NOT_FOUND',
      { projectDomainId }
    );
    this.name = ProjectDomainNotFoundError.name;
  }
}

export class ProjectDomainAlreadyExistsError extends DomainError {
  constructor(projectId: string, domain: string) {
    super(
      `[${ProjectDomainAlreadyExistsError.name}] Project already uses domain ${domain}`,
      'PROJECT_DOMAIN_ALREADY_EXISTS',
      { projectId, domain }
    );
    this.name = ProjectDomainAlreadyExistsError.name;
  }
}

export class ProjectDomainUpdateError extends DomainError {
  constructor(projectDomainId: string, reason?: string) {
    super(
      `[${ProjectDomainUpdateError.name}] Failed to update project domain ${projectDomainId}${reason ? `: ${reason}` : ''}`,
      'PROJECT_DOMAIN_UPDATE_FAILED',
      { projectDomainId, reason }
    );
    this.name = ProjectDomainUpdateError.name;
  }
}

export class ProjectDomainDeletionError extends DomainError {
  constructor(projectDomainId: string, reason?: string) {
    super(
      `[${ProjectDomainDeletionError.name}] Failed to delete project domain ${projectDomainId}${reason ? `: ${reason}` : ''}`,
      'PROJECT_DOMAIN_DELETION_FAILED',
      { projectDomainId, reason }
    );
    this.name = ProjectDomainDeletionError.name;
  }
}
```

### Service Domain Mapping Errors

```typescript
// errors/service-domain-mapping-errors.ts
import { DomainError } from './domain-error';

export class ServiceDomainMappingNotFoundError extends DomainError {
  constructor(mappingId: string) {
    super(
      `[${ServiceDomainMappingNotFoundError.name}] Service domain mapping ${mappingId} not found`,
      'SERVICE_DOMAIN_MAPPING_NOT_FOUND',
      { mappingId }
    );
    this.name = ServiceDomainMappingNotFoundError.name;
  }
}

export class ServiceMappingMismatchError extends DomainError {
  constructor(mappingId: string, serviceId: string, actualServiceId: string) {
    super(
      `[${ServiceMappingMismatchError.name}] Mapping ${mappingId} does not belong to service ${serviceId}`,
      'SERVICE_MAPPING_MISMATCH',
      { mappingId, serviceId, actualServiceId }
    );
    this.name = ServiceMappingMismatchError.name;
  }
}

export class SubdomainConflictError extends DomainError {
  constructor(
    subdomain: string | null,
    basePath: string | null,
    conflictingServiceId: string,
    suggestions: string[]
  ) {
    const url = subdomain ? `${subdomain} + ${basePath || '/'}` : basePath || '/';
    super(
      `[${SubdomainConflictError.name}] Subdomain+path combination ${url} already in use. Available base paths: ${suggestions.join(', ')}`,
      'SUBDOMAIN_CONFLICT',
      { subdomain, basePath, conflictingServiceId, suggestions }
    );
    this.name = SubdomainConflictError.name;
  }
}

export class SubdomainNotAllowedError extends DomainError {
  constructor(subdomain: string, allowedSubdomains: string[], domain: string) {
    super(
      `[${SubdomainNotAllowedError.name}] Subdomain "${subdomain}" is not allowed for domain ${domain}. Allowed: ${allowedSubdomains.join(', ')}`,
      'SUBDOMAIN_NOT_ALLOWED',
      { subdomain, allowedSubdomains, domain }
    );
    this.name = SubdomainNotAllowedError.name;
  }
}

export class InvalidSubdomainFormatError extends DomainError {
  constructor(subdomain: string, reason: string) {
    super(
      `[${InvalidSubdomainFormatError.name}] Invalid subdomain format: "${subdomain}" - ${reason}`,
      'INVALID_SUBDOMAIN_FORMAT',
      { subdomain, reason }
    );
    this.name = InvalidSubdomainFormatError.name;
  }
}

export class InvalidBasePathFormatError extends DomainError {
  constructor(basePath: string, reason: string) {
    super(
      `[${InvalidBasePathFormatError.name}] Invalid base path format: "${basePath}" - ${reason}`,
      'INVALID_BASE_PATH_FORMAT',
      { basePath, reason }
    );
    this.name = InvalidBasePathFormatError.name;
  }
}

export class ServiceDomainMappingUpdateError extends DomainError {
  constructor(mappingId: string, reason?: string) {
    super(
      `[${ServiceDomainMappingUpdateError.name}] Failed to update service domain mapping ${mappingId}${reason ? `: ${reason}` : ''}`,
      'SERVICE_DOMAIN_MAPPING_UPDATE_FAILED',
      { mappingId, reason }
    );
    this.name = ServiceDomainMappingUpdateError.name;
  }
}

export class ServiceDomainMappingDeletionError extends DomainError {
  constructor(mappingId: string, reason?: string) {
    super(
      `[${ServiceDomainMappingDeletionError.name}] Failed to delete service domain mapping ${mappingId}${reason ? `: ${reason}` : ''}`,
      'SERVICE_DOMAIN_MAPPING_DELETION_FAILED',
      { mappingId, reason }
    );
    this.name = ServiceDomainMappingDeletionError.name;
  }
}

export class SetPrimaryDomainError extends DomainError {
  constructor(mappingId: string, serviceId: string, reason?: string) {
    super(
      `[${SetPrimaryDomainError.name}] Failed to set primary domain for service ${serviceId}${reason ? `: ${reason}` : ''}`,
      'SET_PRIMARY_DOMAIN_FAILED',
      { mappingId, serviceId, reason }
    );
    this.name = SetPrimaryDomainError.name;
  }
}
```

---

## Error Code Reference

| Error Code | Error Class | HTTP Status | Description |
|------------|-------------|-------------|-------------|
| `ORGANIZATION_DOMAIN_NOT_FOUND` | `OrganizationDomainNotFoundError` | 404 | Domain ID doesn't exist |
| `DOMAIN_ALREADY_EXISTS` | `DomainAlreadyExistsError` | 409 | Domain registered by another org |
| `INVALID_DOMAIN_FORMAT` | `InvalidDomainFormatError` | 400 | Domain string is malformed |
| `DOMAIN_NOT_VERIFIED` | `DomainNotVerifiedError` | 400 | Trying to use unverified domain |
| `DOMAIN_DELETION_FAILED` | `DomainDeletionError` | 500 | Database deletion failed |
| `GRANULARITY_VIOLATION` | `GranularityViolationError` | 400 | Trying to use parent domain of registered |
| `DNS_LOOKUP_FAILED` | `DnsLookupError` | 502 | DNS query error |
| `VERIFICATION_TOKEN_MISMATCH` | `VerificationTokenMismatchError` | 400 | DNS record has wrong value |
| `VERIFICATION_RECORD_NOT_FOUND` | `VerificationRecordNotFoundError` | 400 | DNS record doesn't exist |
| `PROJECT_DOMAIN_NOT_FOUND` | `ProjectDomainNotFoundError` | 404 | Project domain assignment missing |
| `PROJECT_DOMAIN_ALREADY_EXISTS` | `ProjectDomainAlreadyExistsError` | 409 | Domain already assigned to project |
| `PROJECT_DOMAIN_UPDATE_FAILED` | `ProjectDomainUpdateError` | 500 | Database update failed |
| `PROJECT_DOMAIN_DELETION_FAILED` | `ProjectDomainDeletionError` | 500 | Database deletion failed |
| `SERVICE_DOMAIN_MAPPING_NOT_FOUND` | `ServiceDomainMappingNotFoundError` | 404 | Mapping ID doesn't exist |
| `SERVICE_MAPPING_MISMATCH` | `ServiceMappingMismatchError` | 403 | Mapping belongs to different service |
| `SUBDOMAIN_CONFLICT` | `SubdomainConflictError` | 409 | URL already in use |
| `SUBDOMAIN_NOT_ALLOWED` | `SubdomainNotAllowedError` | 400 | Subdomain not in allowed list |
| `INVALID_SUBDOMAIN_FORMAT` | `InvalidSubdomainFormatError` | 400 | Subdomain string is malformed |
| `INVALID_BASE_PATH_FORMAT` | `InvalidBasePathFormatError` | 400 | Base path string is malformed |
| `SERVICE_DOMAIN_MAPPING_UPDATE_FAILED` | `ServiceDomainMappingUpdateError` | 500 | Database update failed |
| `SERVICE_DOMAIN_MAPPING_DELETION_FAILED` | `ServiceDomainMappingDeletionError` | 500 | Database deletion failed |
| `SET_PRIMARY_DOMAIN_FAILED` | `SetPrimaryDomainError` | 500 | Failed to set primary |

---

## Usage Examples

### Before (Generic Errors)

```typescript
// ❌ Current approach - no error class name, generic messages
if (!domain) {
  throw new Error(`Domain ${domainId} not found`);
}

if (existingDomain) {
  throw new Error(`Domain ${domain} is already registered`);
}

if (!verified) {
  throw new Error(`DNS verification failed`);
}

// ❌ Wrong logging - missing error class name
this.logger.error(`Error: ${error.message}`);
```

### After (Domain-Specific Errors with ErrorClass.name)

```typescript
// ✅ Recommended approach - uses ErrorClass.name in messages
import {
  OrganizationDomainNotFoundError,
  DomainAlreadyExistsError,
  DomainVerificationError,
  GranularityViolationError,
} from './errors';

if (!domain) {
  throw new OrganizationDomainNotFoundError(domainId);
  // Message: "[OrganizationDomainNotFoundError] Organization domain dom_123 not found"
}

if (existingDomain) {
  throw new DomainAlreadyExistsError(domain, existingDomain.organizationId);
  // Message: "[DomainAlreadyExistsError] Domain example.com is already registered"
}

// Granularity violation check
if (!isSubdomainOfRegistered(requestedDomain, registeredDomain)) {
  throw new GranularityViolationError(requestedDomain, registeredDomain);
  // Message: "[GranularityViolationError] Cannot use example.com - it is above the registered domain level api.example.com"
}

// ✅ Correct logging - includes error class name
this.logger.error(`[${error.name}] ${error.message}`, error.stack);

if (!verified) {
  throw new DomainVerificationError(
    domain,
    'DNS_VERIFICATION_FAILED',
    `Expected TXT record with token ${token}, found: ${actualValue || 'nothing'}`
  );
}
```

### Controller Error Handling

```typescript
// organization-domain.controller.ts
import { OrganizationDomainNotFoundError, DomainAlreadyExistsError } from './errors';

@Implement(domainContract.addOrganizationDomain)
async addOrganizationDomain(input: AddOrganizationDomainInput) {
  try {
    const result = await this.organizationDomainService.create(input);
    return DomainAdapter.toAddDomainResponse(result);
  } catch (error) {
    if (error instanceof DomainAlreadyExistsError) {
      // Error context available for logging
      this.logger.warn('Domain registration failed', {
        domain: error.context?.domain,
        existingOrgId: error.context?.existingOrgId,
      });
    }
    throw error;
  }
}
```

### Service Error Handling

```typescript
// domain-verification.service.ts
import { 
  DnsLookupError,
  VerificationTokenMismatchError,
  VerificationRecordNotFoundError,
} from './errors';

async verifyDomain(domainId: string): Promise<VerifyDomainResult> {
  const domain = await this.organizationDomainRepository.findById(domainId);
  if (!domain) {
    throw new OrganizationDomainNotFoundError(domainId);
  }

  const recordName = `_deployer-verify.${domain.domain}`;
  
  try {
    const records = await dns.resolveTxt(recordName);
    const txtRecord = records.flat().find(r => r.startsWith('deployer-verification='));
    
    if (!txtRecord) {
      throw new VerificationRecordNotFoundError(
        domain.domain,
        recordName,
        'txt_record'
      );
    }
    
    const foundToken = txtRecord.replace('deployer-verification=', '');
    if (foundToken !== domain.verificationToken) {
      throw new VerificationTokenMismatchError(
        domain.domain,
        domain.verificationToken,
        foundToken
      );
    }
    
    // Success
    return { success: true, status: 'verified', verifiedAt: new Date() };
    
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    // DNS resolution error
    throw new DnsLookupError(
      domain.domain,
      'TXT',
      error instanceof Error ? error.message : 'Unknown DNS error'
    );
  }
}
```

---

## Error Response Format

All domain errors follow a consistent response format when serialized:

```typescript
{
  "error": {
    "name": "SubdomainConflictError",
    "code": "SUBDOMAIN_CONFLICT",
    "message": "Subdomain+path combination api + /v1 already in use. Available base paths: /v2, /v3",
    "context": {
      "subdomain": "api",
      "basePath": "/v1",
      "conflictingServiceId": "svc_123",
      "suggestions": ["/v2", "/v3"]
    }
  }
}
```

---

## Migration Status: ✅ COMPLETE

Error classes have been implemented in:

### Implemented Error Files
- [x] `errors/domain-error.ts` - Base DomainError class
- [x] `errors/organization-domain-errors.ts` (6 error classes)
- [x] `errors/project-domain-errors.ts` (4 error classes)
- [x] `errors/service-domain-mapping-errors.ts` (9 error classes)
- [x] `errors/verification-errors.ts` (5 error classes)
- [x] `errors/index.ts` - Barrel export with documentation

### Integration Status
Controllers and services can now import specific error classes:

```typescript
import { 
  OrganizationDomainNotFoundError,
  DomainAlreadyExistsError,
  SubdomainConflictError,
} from '../errors';
```

**Total: 24 domain-specific error classes implemented**

---

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Module architecture overview
- [API-REFERENCE.md](./API-REFERENCE.md) - Complete API documentation
- [../../traefik/docs/ERROR-HANDLING.md](../../traefik/docs/ERROR-HANDLING.md) - Traefik error patterns
